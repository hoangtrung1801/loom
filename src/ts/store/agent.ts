import { observable, action, makeObservable, runInAction } from 'mobx';
import * as I from 'Interface';
import Storage from 'Lib/storage';

const STORAGE_KEY = 'agentChats';
const STORAGE_MAX_MESSAGES = 60;
const LOCAL_KEY_NAME = 'Loom Agent';

export type AgentToolStatus = 'running' | 'approval' | 'done' | 'error';

export type AgentPart =
	{ type: 'text'; text: string } |
	{ type: 'tool'; callId: string; name: string; label: string; args: any; readOnly: boolean; status: AgentToolStatus; result: string };

export interface AgentChatMessage {
	id: string;
	role: 'user' | 'assistant';
	parts: AgentPart[];
};

export interface AgentChat {
	messages: AgentChatMessage[];
	status: 'idle' | 'running';
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
 * Chats of the AI agent sidebar, one per account and space. The model loop runs in the Electron
 * main process; this store renders its event stream and holds what the panel shows.
 */
class AgentStore {

	public chats: Map<string, AgentChat> = new Map();
	public status: AgentStatus | null = null;
	public unsupported = false;

	private runChats: Map<string, string> = new Map();
	private seq = 0;
	private keyStale = false;
	private loaded = false;

	constructor () {
		makeObservable(this, {
			chats: observable,
			status: observable,
			unsupported: observable,
			setStatus: action,
			pushMessage: action,
			clear: action,
		});
	};

	/** Starts listening to the main process. Called once at app start. */
	init () {
		Renderer.on('agentEvent', (e: any, ev: any) => this.onEvent(ev));
		Renderer.on('agentAppToolCall', (e: any, call: any) => this.onAppToolCall(call));
	};

	chatId (spaceId: string): string {
		return [ S.Auth.account?.id || '', spaceId ].join(':');
	};

	getChat (chatId: string): AgentChat {
		this.load();

		if (!this.chats.has(chatId)) {
			this.chats.set(chatId, observable({ messages: [], status: 'idle', error: '', errorDetail: '' }));
		};
		return this.chats.get(chatId);
	};

	async loadStatus (): Promise<AgentStatus | null> {
		const status = await Renderer.send('agentStatus', S.Auth.account?.id || '');

		runInAction(() => {
			this.unsupported = !status || !status.config;
			this.setStatus(this.unsupported ? null : status);
		});
		return this.status;
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
	private ensureLocalKey (): Promise<boolean> {
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

	async send (text: string): Promise<void> {
		text = String(text || '').trim();
		if (!text) {
			return;
		};

		const context = this.getContext();
		const chatId = this.chatId(context.spaceId);
		const chat = this.getChat(chatId);
		const running = chat.status == 'running';

		this.pushMessage(chatId, { id: this.nextId(), role: 'user', parts: [ { type: 'text', text } ] });

		// A message sent while the agent works steers the current run
		if (running) {
			Renderer.send('agentSteer', chatId, text);
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

		const res = await Renderer.send('agentRun', S.Common.tabId, { chatId, runId, text, context, history });
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

	async reset () {
		const chatId = this.chatId(S.Common.space);

		await Renderer.send('agentReset', chatId);
		this.clear(chatId);
		this.save();
	};

	clear (chatId: string) {
		this.chats.delete(chatId);
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

	private markTool (chatId: string, callId: string, patch: Partial<Extract<AgentPart, { type: 'tool' }>>) {
		runInAction(() => {
			for (const message of this.getChat(chatId).messages) {
				const part = message.parts.find(it => (it.type == 'tool') && (it.callId == callId)) as any;
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
			this.save();
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

	private openObject (id: string): Promise<any> {
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

	private load () {
		if (this.loaded) {
			return;
		};
		this.loaded = true;

		const stored = Storage.get(STORAGE_KEY, true) || {};

		for (const chatId of Object.keys(stored)) {
			const messages = (stored[chatId] || []).map((it: any) => ({
				id: this.nextId(), role: it.role, parts: [ { type: 'text', text: String(it.text || '') } ],
			}));
			this.chats.set(chatId, observable({ messages, status: 'idle', error: '', errorDetail: '' }));
		};
	};

	/** Keeps the text of the latest messages; tool rows are not stored. */
	private save () {
		const out: Record<string, { role: string; text: string }[]> = {};

		this.chats.forEach((chat, chatId) => {
			const items = chat.messages.map(it => ({ role: it.role, text: messageText(it) })).filter(it => it.text);
			if (items.length) {
				out[chatId] = items.slice(-STORAGE_MAX_MESSAGES);
			};
		});

		Storage.set(STORAGE_KEY, out, true);
	};

};

export const Agent: AgentStore = new AgentStore();
