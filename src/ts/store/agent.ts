import { observable, action, makeObservable, runInAction } from 'mobx';
import * as I from 'Interface';
import Storage from 'Lib/storage';
import * as Session from 'Lib/agentSession';

/** Chats from before sessions were stored in the space (one per account and space, text only). */
const LEGACY_STORAGE_KEY = 'agentChats';
/** The session each space showed last, so reopening the panel continues it. */
const LAST_SESSION_KEY = 'agentLastSession';
const LOCAL_KEY_NAME = 'Loom Agent';

export type AgentToolStatus = 'running' | 'approval' | 'done' | 'error';

export type AgentPart =
	{ type: 'text'; text: string } |
	{ type: 'tool'; callId: string; name: string; label: string; args: any; readOnly: boolean; status: AgentToolStatus; result: string };

/** An object referenced with @, at [from, to) in the message text. */
export interface AgentMention {
	id: string;
	name: string;
	from: number;
	to: number;
	type?: string;
};

export interface AgentChatMessage {
	id: string;
	role: 'user' | 'assistant';
	parts: AgentPart[];
	mentions?: AgentMention[];
};

export interface AgentChat {
	spaceId: string;
	/** The session object in the space, empty until the chat is first saved. */
	objectId: string;
	messages: AgentChatMessage[];
	status: 'idle' | 'running';
	/** True while a stored session is being read. */
	loading: boolean;
	/** Translation key suffix of the last failure, empty when none. */
	error: string;
	errorDetail: string;
};

export interface AgentConfig {
	provider: 'anthropic' | 'custom';
	model: string;
	baseUrl: string;
	tier: 'auto' | 'large' | 'small';
	confirm: boolean;
};

export interface AgentStatus {
	config: AgentConfig;
	hasProviderKey: boolean;
	hasLocalKey: boolean;
};

/** Plain text of a message, used for history reseeding and storage. */
export const messageText = (message: AgentChatMessage): string => message.parts.map(it => (it.type == 'text' ? it.text : '')).join('');

/**
 * Chats of the AI agent sidebar. Each space shows one chat at a time; every chat is saved as an
 * "AI Chat" object in its space (Lib/agentSession), so past sessions can be reopened. The model
 * loop runs in the Electron main process; this store renders its event stream.
 */
class AgentStore {

	/** Chats loaded in this window, by local chat id (also the main process session key). */
	public chats: Map<string, AgentChat> = new Map();
	/** The chat each space shows, by space id. */
	public active: Map<string, string> = new Map();
	/** Saved sessions of the current space, for the history view. */
	public sessions: Session.AgentSessionMeta[] = [];
	public sessionsLoading = false;
	public status: AgentStatus | null = null;
	public unsupported = false;

	private runChats: Map<string, string> = new Map();
	private saving: Map<string, Promise<void>> = new Map();
	private restored: Set<string> = new Set();
	private seq = 0;
	private keyStale = false;

	constructor () {
		makeObservable(this, {
			chats: observable,
			active: observable,
			sessions: observable,
			sessionsLoading: observable,
			status: observable,
			unsupported: observable,
			setStatus: action,
			pushMessage: action,
			newChat: action,
		});
	};

	/** Starts listening to the main process. Called once at app start. */
	init () {
		// One listener for both: Renderer.on replaces earlier listeners of the event, so Lo (chat
		// members) cannot register its own without cutting the panel off from its runs
		Renderer.on('agentEvent', (e: any, ev: any) => {
			this.onEvent(ev);
			S.Lo.onEvent(ev);
		});
		Renderer.on('agentAppToolCall', (e: any, call: any) => this.onAppToolCall(call));
	};

	/** Id of the chat the space shows, starting an empty one when there is none. */
	chatId (spaceId: string): string {
		const id = this.active.get(spaceId);
		return (id && this.chats.has(id)) ? id : this.newChat(spaceId);
	};

	getChat (chatId: string): AgentChat {
		return this.chats.get(chatId) || this.addChat(S.Common.space, '');
	};

	/** Shows an empty chat in the space. The chat it replaces stays saved and keeps running if it was. */
	newChat (spaceId: string): string {
		const current = this.chats.get(this.active.get(spaceId));

		if (current && !current.messages.length && !current.objectId && !current.loading) {
			return this.active.get(spaceId);
		};

		const chatId = this.nextId();

		this.addChat(spaceId, '', chatId);
		this.active.set(spaceId, chatId);
		return chatId;
	};

	private addChat (spaceId: string, objectId: string, chatId?: string): AgentChat {
		const chat: AgentChat = observable({ spaceId, objectId, messages: [], status: 'idle', loading: false, error: '', errorDetail: '' });

		runInAction(() => this.chats.set(chatId || this.nextId(), chat));
		return chat;
	};

	/**
	 * Called when the panel opens in a space: continues the session the space showed last, or
	 * moves a chat kept by an older version into a session object.
	 */
	async restore (spaceId: string) {
		if (!spaceId || this.restored.has(spaceId)) {
			return;
		};
		this.restored.add(spaceId);

		const legacy = this.takeLegacyChat(spaceId);
		if (legacy.length) {
			const chatId = this.newChat(spaceId);

			runInAction(() => {
				this.chats.get(chatId).messages = legacy;
			});
			this.save(chatId);
			return;
		};

		const last = (Storage.get(LAST_SESSION_KEY, true) || {})[spaceId];
		const current = this.chats.get(this.active.get(spaceId));

		if (last && (!current || !current.messages.length)) {
			await this.openSession(spaceId, last);
		};
	};

	private takeLegacyChat (spaceId: string): AgentChatMessage[] {
		const stored = Storage.get(LEGACY_STORAGE_KEY, true) || {};
		const key = [ S.Auth.account?.id || '', spaceId ].join(':');
		const items = Array.isArray(stored[key]) ? stored[key] : [];

		if (!items.length) {
			return [];
		};

		delete stored[key];
		Storage.set(LEGACY_STORAGE_KEY, stored, true);

		return items
			.filter((it: any) => [ 'user', 'assistant' ].includes(it?.role) && it.text)
			.map((it: any) => ({ id: this.nextId(), role: it.role, parts: [ { type: 'text', text: String(it.text) } ] }));
	};

	private setLastSession (spaceId: string, objectId: string) {
		const map = Storage.get(LAST_SESSION_KEY, true) || {};

		if (objectId) {
			map[spaceId] = objectId;
		} else {
			delete map[spaceId];
		};
		Storage.set(LAST_SESSION_KEY, map, true);
	};

	/** Reads the saved sessions of the space for the history view. */
	async loadSessions (spaceId: string) {
		runInAction(() => this.sessionsLoading = true);

		const list = await Session.listSessions(spaceId).catch(() => []);

		runInAction(() => {
			this.sessions = list;
			this.sessionsLoading = false;
		});
	};

	/** Shows a saved session, reading it from the space unless it is already loaded. */
	async openSession (spaceId: string, objectId: string) {
		for (const [ chatId, chat ] of this.chats) {
			if (chat.objectId == objectId) {
				runInAction(() => this.active.set(spaceId, chatId));
				this.setLastSession(spaceId, objectId);
				return;
			};
		};

		const chatId = this.nextId();
		const chat = this.addChat(spaceId, objectId, chatId);

		runInAction(() => {
			chat.loading = true;
			this.active.set(spaceId, chatId);
		});

		const stored = await Session.loadSession(spaceId, objectId).catch(() => null);

		runInAction(() => {
			chat.loading = false;

			if (stored) {
				chat.messages = Session.parseMessages(stored.messages, () => this.nextId());
			} else {
				// Deleted elsewhere: start over instead of saving into a missing object
				chat.objectId = '';
			};
		});
		this.setLastSession(spaceId, stored ? objectId : '');
	};

	/** Moves a saved session to the bin. If the space was showing it, an empty chat takes its place. */
	async deleteSession (spaceId: string, objectId: string) {
		await Session.deleteSession(objectId).catch(e => console.error('[Agent] delete session:', e));

		for (const [ chatId, chat ] of this.chats) {
			if (chat.objectId != objectId) {
				continue;
			};

			Renderer.send('agentReset', chatId);
			runInAction(() => {
				if (this.active.get(spaceId) == chatId) {
					this.active.delete(spaceId);
				};
				this.chats.delete(chatId);
			});
		};

		runInAction(() => {
			this.sessions = this.sessions.filter(it => it.id != objectId);
		});

		if ((Storage.get(LAST_SESSION_KEY, true) || {})[spaceId] == objectId) {
			this.setLastSession(spaceId, '');
		};
	};

	/**
	 * Writes the chat to its session object, creating it on the first save. Saves of one chat run
	 * one after another, so the object is never created twice.
	 */
	save (chatId: string): Promise<void> {
		const previous = this.saving.get(chatId) || Promise.resolve();
		const next = previous.then(async () => {
			const chat = this.chats.get(chatId);
			if (!chat || chat.loading || !chat.messages.length) {
				return;
			};

			const name = Session.sessionTitle(chat.messages) || translate('agentUntitled');
			const messages = Session.serializeMessages(chat.messages);

			try {
				if (chat.objectId) {
					await Session.updateSession(chat.objectId, name, messages);
				} else {
					const objectId = await Session.createSession(chat.spaceId, name, messages);
					runInAction(() => chat.objectId = objectId);
				};

				if (this.active.get(chat.spaceId) == chatId) {
					this.setLastSession(chat.spaceId, chat.objectId);
				};
			} catch (e: any) {
				console.error('[Agent] save session:', e);
				runInAction(() => {
					if (!chat.error) {
						chat.error = 'save';
						chat.errorDetail = String(e?.message || e);
					};
				});
			};
		});

		this.saving.set(chatId, next);
		return next;
	};

	async loadStatus (): Promise<AgentStatus | null> {
		const status = await Renderer.send('agentStatus', S.Auth.account?.id || '');

		runInAction(() => {
			this.unsupported = !status || !status.config;
			this.setStatus(this.unsupported ? null : status);
		});
		return this.status;
	};

	/** True when a model is set up, so Lo can answer. Same rules as the main process. */
	get isConfigured (): boolean {
		const config = this.status?.config;

		if (!config || this.unsupported || !config.model) {
			return false;
		};
		if (config.provider == 'custom') {
			return /^https?:\/\//.test(config.baseUrl);
		};
		return !!this.status.hasProviderKey;
	};

	setStatus (status: AgentStatus | null) {
		this.status = status;
	};

	async setConfig (patch: Partial<AgentConfig>) {
		this.setStatus(await Renderer.send('agentSetConfig', patch));
	};

	async setProviderKey (key: string) {
		this.setStatus(await Renderer.send('agentSetProviderKey', key));
	};

	/** Context of what the user is looking at, sent with every message. */
	getContext () {
		const spaceId = S.Common.space;
		const rootId = keyboard.getRootId();
		const space = U.Space.getSpaceview(spaceId);
		const object = rootId ? S.Detail.get(rootId, rootId, [ 'name', 'type' ]) : null;
		const type = object?.type ? S.Record.getTypeById(object.type) : null;

		return {
			spaceId,
			spaceName: space?.name || '',
			objectId: object && !object._empty_ ? rootId : '',
			objectName: object?.name || '',
			objectType: type?.name || '',
			apiAddr: S.Auth.localApiAddr,
			accountId: S.Auth.account?.id || '',
		};
	};

	/** Creates the agent's own local API key on first use. It shows up in Settings → API keys. */
	ensureLocalKey (): Promise<boolean> {
		const accountId = S.Auth.account?.id || '';

		if (this.status?.hasLocalKey && !this.keyStale) {
			return Promise.resolve(true);
		};

		return new Promise(resolve => {
			const grant: I.LinkAppGrant = { spaceIds: [], allSpaces: true, perm: I.LocalApiPermission.ReadWrite };

			C.AccountLocalLinkCreateApp({ name: LOCAL_KEY_NAME, grant }, async (message: any) => {
				if (message.error?.code || !message.key) {
					resolve(false);
					return;
				};

				await Renderer.send('agentSetLocalKey', accountId, message.key);
				this.keyStale = false;
				await this.loadStatus();
				resolve(true);
			});
		});
	};

	/** Sends a message to the chat the current space shows. Mentions are objects referenced with @. */
	async send (text: string, mentions: AgentMention[] = []): Promise<void> {
		const trimmed = String(text || '').trim();
		if (!trimmed) {
			return;
		};

		// Mention ranges point into the text as typed, so they shift by what trimming removed
		const shift = String(text || '').length - String(text || '').trimStart().length;
		const kept = mentions
			.map(it => ({ ...it, from: it.from - shift, to: it.to - shift }))
			.filter(it => (it.from >= 0) && (it.to <= trimmed.length));

		const base = this.getContext();
		const context = { ...base, mentions: kept.map(it => ({ id: it.id, name: it.name, type: it.type })) };
		const chatId = this.chatId(context.spaceId);
		const chat = this.getChat(chatId);
		const running = chat.status == 'running';

		this.pushMessage(chatId, { id: this.nextId(), role: 'user', parts: [ { type: 'text', text: trimmed } ], mentions: kept });
		this.save(chatId);

		// A message sent while the agent works steers the current run
		if (running) {
			Renderer.send('agentSteer', chatId, trimmed);
			return;
		};

		runInAction(() => {
			chat.status = 'running';
			chat.error = '';
			chat.errorDetail = '';
		});

		if (!this.status) {
			await this.loadStatus();
		};
		if (this.unsupported) {
			this.fail(chatId, 'unsupported');
			return;
		};
		if (!context.apiAddr) {
			this.fail(chatId, 'localApiOff');
			return;
		};
		if (!(await this.ensureLocalKey())) {
			this.fail(chatId, 'localKey');
			return;
		};

		const runId = this.nextId();
		const history = chat.messages.slice(0, -1).map(it => ({ role: it.role, text: messageText(it) })).filter(it => it.text);

		this.runChats.set(runId, chatId);

		const res = await Renderer.send('agentRun', S.Common.tabId, { chatId, runId, text: trimmed, context, history });
		if (res?.error) {
			this.runChats.delete(runId);

			if (res.error.startsWith('mcp:')) {
				// The key may have been revoked in settings: make a new one on the next try
				this.keyStale = true;
				this.fail(chatId, 'mcp', res.error.slice(4).trim());
			} else {
				this.fail(chatId, res.error);
			};
		};
	};

	stop () {
		Renderer.send('agentStop', this.chatId(S.Common.space));
	};

	approve (callId: string, allow: boolean) {
		const chatId = this.chatId(S.Common.space);

		this.markTool(chatId, callId, { status: 'running' });
		Renderer.send('agentApprove', chatId, callId, allow);
	};

	pushMessage (chatId: string, message: AgentChatMessage) {
		this.getChat(chatId).messages.push(message);
	};

	private nextId (): string {
		return `${Date.now().toString(36)}-${++this.seq}`;
	};

	private fail (chatId: string, error: string, detail = '') {
		runInAction(() => {
			const chat = this.getChat(chatId);

			chat.status = 'idle';
			chat.error = error;
			chat.errorDetail = detail;
		});
	};

	private lastAssistant (chat: AgentChat): AgentChatMessage {
		const last = chat.messages[chat.messages.length - 1];
		return (last && (last.role == 'assistant')) ? last : null;
	};

	/**
	 * Updates a tool row by its call id. Some OpenAI-compatible servers number calls per turn
	 * (call_0, call_1...), so an id can repeat across turns: the latest row with it is the live one.
	 */
	private markTool (chatId: string, callId: string, patch: Partial<Extract<AgentPart, { type: 'tool' }>>) {
		runInAction(() => {
			const messages = this.getChat(chatId).messages;

			for (let i = messages.length - 1; i >= 0; i--) {
				const part = [ ...messages[i].parts ].reverse().find(it => (it.type == 'tool') && (it.callId == callId)) as any;
				if (part) {
					Object.assign(part, patch);
					return;
				};
			};
		});
	};

	private onEvent (ev: any) {
		const chatId = this.runChats.get(ev?.runId);
		if (!chatId) {
			return;
		};

		const chat = this.getChat(chatId);

		runInAction(() => {
			switch (ev.type) {
				case 'start': {
					chat.messages.push({ id: this.nextId(), role: 'assistant', parts: [] });
					break;
				};

				case 'text': {
					const message = this.lastAssistant(chat);
					const last = message?.parts[message.parts.length - 1];

					if (!message) {
						break;
					};
					if (last && (last.type == 'text')) {
						last.text += ev.delta;
					} else {
						message.parts.push({ type: 'text', text: ev.delta });
					};
					break;
				};

				case 'toolStart': {
					this.lastAssistant(chat)?.parts.push({
						type: 'tool', callId: ev.callId, name: ev.name, label: ev.label, args: ev.args,
						readOnly: !!ev.readOnly, status: 'running', result: '',
					});
					break;
				};

				case 'approval': {
					this.markTool(chatId, ev.callId, { status: 'approval' });
					break;
				};

				case 'toolEnd': {
					this.markTool(chatId, ev.callId, { status: ev.isError ? 'error' : 'done', result: ev.text });
					break;
				};

				case 'end': {
					this.runChats.delete(ev.runId);
					chat.status = 'idle';

					if (ev.error) {
						chat.error = 'run';
						chat.errorDetail = ev.error;
					};

					// A message that produced nothing (stopped at once) is not worth keeping
					const message = this.lastAssistant(chat);
					if (message && !message.parts.length) {
						chat.messages.pop();
					};
					break;
				};
			};
		});

		if (ev.type == 'end') {
			this.save(chatId);
		};
	};

	/** Answers requests that only the open window can serve (see electron/ts/agent/appTools.ts). */
	private async onAppToolCall (call: { id: string; name: string; args: any }) {
		let result: any = { error: 'unknown tool' };

		try {
			if (call.name == 'get_context') {
				result = this.getAppContext();
			} else
			if (call.name == 'open_object') {
				result = await this.openObject(String(call.args?.object || ''));
			};
		} catch (e: any) {
			result = { error: String(e?.message || e) };
		};

		Renderer.send('agentAppToolResult', call.id, result);
	};

	private getAppContext () {
		const ctx = this.getContext();
		const selection = S.Common.getRef('selectionProvider');
		const selected = (selection?.get(I.SelectType.Block) || []).slice(0, 20);
		const blocks = selected.map((id: string) => {
			const block = S.Block.getLeaf(ctx.objectId, id);
			return block ? { id, text: block.getText() } : null;
		}).filter(it => it && it.text);

		return {
			space: { id: ctx.spaceId, name: ctx.spaceName },
			object: ctx.objectId ? { id: ctx.objectId, name: ctx.objectName, type: ctx.objectType } : null,
			selectedBlocks: blocks,
		};
	};

	openObject (id: string): Promise<any> {
		return new Promise(resolve => {
			if (!id) {
				resolve({ error: 'object id is required' });
				return;
			};

			U.Object.getById(id, {}, (object: any) => {
				if (!object || object._empty_) {
					resolve({ error: `object ${id} not found` });
					return;
				};

				U.Object.openAuto(object);
				resolve({ opened: object.name || id });
			});

			// getById never calls back for an unknown id
			setTimeout(() => resolve({ error: `object ${id} not found` }), 5000);
		});
	};

};

export const Agent: AgentStore = new AgentStore();
