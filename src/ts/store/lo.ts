import * as I from 'Interface';
import * as LoLib from 'Lib/lo';

const EDIT_DELAY = 800;
const RUN_ERRORS = [ 'unsupported', 'providerKey', 'model', 'baseUrl', 'localApiOff', 'localKey' ];

interface LoRun {
	chatId: string;
	subId: string;
	messageId: string;
	replyTo: string;
	runId: string;
	text: string;
	sentText: string;
	timer: number;
	editing: Promise<void>;
	stopped: boolean;
	done: () => void;
};

/**
 * Lo as a member of Chat objects. Watches live messages of the user's own account; one that
 * mentions Lo or replies to a Lo message gets an answer, written into the chat as a message that
 * carries the Lo marker (see Lib/lo) and filled in as the model streams. The model runs in the main
 * process under its own session key per chat, so the side panel chat is untouched.
 */
class LoStore {

	private answered: Set<string> = new Set();
	private runs: Map<string, LoRun> = new Map();
	private queues: Map<string, Promise<void>> = new Map();

	/** Starts listening to the main process. Called once at app start. */
	init () {
		Renderer.on('agentEvent', (e: any, ev: any) => this.onEvent(ev));
	};

	/** Whether Lo is writing this message right now. */
	isRunning (messageId: string): boolean {
		for (const run of this.runs.values()) {
			if (run.messageId == messageId) {
				return true;
			};
		};
		return false;
	};

	stop (messageId: string) {
		for (const run of this.runs.values()) {
			if (run.messageId == messageId) {
				run.stopped = true;
				Renderer.send('agentStop', this.key(run.chatId));
			};
		};
	};

	private key (chatId: string): string {
		return `lo:${chatId}`;
	};

	private notify () {
		U.Dom.eventDispatch(window, 'loRunsUpdate', {});
	};

	/** A live chat message arrived. Called by the dispatcher for ChatAdd. */
	async onChatAdd (spaceId: string, chatId: string, message: I.ChatMessage, subIds: string[]) {
		const accountId = S.Auth.account?.id || '';

		// Cheap checks first: most messages are neither the user's nor addressed to Lo
		if (!message || (message.creator != accountId) || LoLib.isLoMessage(message) || this.answered.has(message.id)) {
			return;
		};
		if (!message.replyToMessageId && !(message.content?.marks || []).some(it => it.type == I.MarkType.Mention)) {
			return;
		};

		if (!S.Agent.status) {
			await S.Agent.loadStatus();
		};

		const subId = subIds[0];
		const loId = await LoLib.ensureLoObject(spaceId).catch(() => '');
		const getMessage = (id: string) => S.Chat.getMessageById(subId, id) || S.Chat.getReply(subId, id) || null;
		const list: I.ChatMessage[] = subId ? S.Chat.getList(subId) : [];

		// A reply that already exists means an earlier session answered it
		list.forEach(it => {
			if (it.replyToMessageId && LoLib.isLoMessage(it)) {
				this.answered.add(it.replyToMessageId);
			};
		});

		const ok = LoLib.shouldLoReply(message, {
			loId,
			accountId,
			configured: S.Agent.isConfigured,
			getMessage,
			answered: this.answered,
		});

		if (!ok) {
			return;
		};

		this.answered.add(message.id);
		this.enqueue(chatId, () => this.answer(spaceId, chatId, subId, message, loId));
	};

	/** One answer at a time per chat: a second request would only steer the running one. */
	private enqueue (chatId: string, fn: () => Promise<void>) {
		const previous = this.queues.get(chatId) || Promise.resolve();
		const next = previous.then(fn).catch(e => console.error('[Lo]', e));

		this.queues.set(chatId, next);
	};

	private request<T = any> (fn: (cb: (message: any) => void) => void): Promise<T> {
		return new Promise((resolve, reject) => {
			fn((message: any) => {
				if (message.error?.code) {
					reject(new Error(message.error.description || 'request failed'));
				} else {
					resolve(message);
				};
			});
		});
	};

	private payload (text: string, replyTo: string) {
		return {
			replyToMessageId: replyTo,
			content: { text: LoLib.withLoMarker(text), style: I.TextStyle.Paragraph, marks: [] },
			attachments: [],
			reactions: [],
			blocks: [],
		};
	};

	private edit (run: LoRun, text: string): Promise<void> {
		if (text == run.sentText) {
			return run.editing;
		};

		run.sentText = text;
		run.editing = run.editing
			.then(() => this.request(cb => C.ChatEditMessageContent(run.chatId, run.messageId, this.payload(text, run.replyTo), cb)))
			.then(() => {})
			.catch(e => console.error('[Lo] edit:', e));

		return run.editing;
	};

	private async answer (spaceId: string, chatId: string, subId: string, message: I.ChatMessage, loId: string): Promise<void> {
		const added: any = await this.request(cb => C.ChatAddMessage(chatId, this.payload(translate('loThinking'), message.id), cb));
		const messageId = String(added.messageId || '');

		if (!messageId) {
			return;
		};

		const runId = `lo-${Date.now().toString(36)}-${messageId}`;
		const key = this.key(chatId);

		const run: LoRun = {
			chatId, subId, messageId, runId, replyTo: message.id, text: '', sentText: LoLib.withLoMarker(translate('loThinking')),
			timer: 0, editing: Promise.resolve(), stopped: false, done: () => {},
		};
		const finished = new Promise<void>(resolve => run.done = resolve);

		this.runs.set(runId, run);
		this.notify();

		const context = this.getContext(message, loId);
		const list: I.ChatMessage[] = subId ? S.Chat.getList(subId) : [];
		const history = LoLib.buildChatHistory(list, message.id, creator => this.authorName(spaceId, creator));

		if (!(await S.Agent.ensureLocalKey())) {
			this.finish(run, translate('agentErrorLocalKey'));
			return finished;
		};

		const res = await Renderer.send('agentRun', S.Common.tabId, {
			chatId: key,
			runId,
			text: LoLib.textForLo(message, loId),
			context,
			history,
			readOnly: true,
		});

		if (res?.error) {
			this.finish(run, RUN_ERRORS.includes(String(res.error)) ? translate('loErrorNotReady') : translate('loErrorRun'));
		};

		return finished;
	};

	private authorName (spaceId: string, creator: string): string {
		const author = U.Space.getParticipant(U.Space.getParticipantId(spaceId, creator));
		return author ? String(author.name || '') : '';
	};

	/** What the model is told about the place: the chat, and any other objects mentioned. */
	private getContext (message: I.ChatMessage, loId: string) {
		const base = S.Agent.getContext();
		const text = String(message.content?.text || '');
		const mentions = (message.content?.marks || [])
			.filter((it: any) => (it.type == I.MarkType.Mention) && it.param && (it.param != loId))
			.map((it: any) => ({ id: it.param, name: text.slice(it.range.from, it.range.to) }));

		return { ...base, mentions };
	};

	private onEvent (ev: any) {
		const run = this.runs.get(ev?.runId);
		if (!run) {
			return;
		};

		if (ev.type == 'text') {
			run.text += ev.delta;
			this.schedule(run);
		} else
		if (ev.type == 'end') {
			let text = run.text.trim();

			if (ev.error) {
				text = [ text, translate('loErrorRun') ].filter(Boolean).join('\n\n');
			} else
			if (!text) {
				text = translate(run.stopped ? 'loStopped' : 'loErrorRun');
			};

			this.finish(run, text);
		};
	};

	private schedule (run: LoRun) {
		if (run.timer) {
			return;
		};

		run.timer = window.setTimeout(() => {
			run.timer = 0;
			this.edit(run, LoLib.withLoMarker(run.text));
		}, EDIT_DELAY);
	};

	private finish (run: LoRun, text: string) {
		window.clearTimeout(run.timer);
		run.timer = 0;

		this.runs.delete(run.runId);
		this.edit(run, LoLib.withLoMarker(text)).then(() => {
			this.notify();
			run.done();
		});
	};

};

export const Lo: LoStore = new LoStore();
