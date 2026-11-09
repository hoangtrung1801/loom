import * as I from 'Interface';
import * as LoLib from 'Lib/lo';

const EDIT_DELAY = 800;
const OBJECT_TEXT_LIMIT = 8000;
const RUN_ERRORS = [ 'unsupported', 'providerKey', 'model', 'baseUrl', 'localApiOff', 'localKey' ];

interface LoRun {
	chatId: string;
	subId: string;
	messageId: string;
	replyTo: string;
	/** A discussion comment, not a chat message: written as blocks. */
	discussion: boolean;
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

		// Messages synced in from another device are that device's to answer; a message sent here
		// arrives unsynced, so only one device ever replies
		if (message.isSynced) {
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

	/** The chat message for Lo's text: markdown becomes marks, fences code marks, then the marker. */
	private payload (text: string, replyTo: string) {
		const inline = LoLib.formatLoInline(LoLib.stripLoMarker(text));
		const coded = U.Chat.fenceToCodeMarks(inline.text, inline.marks);

		return {
			replyToMessageId: replyTo,
			content: { text: LoLib.withLoMarker(coded.text), style: I.TextStyle.Paragraph, marks: Mark.checkRanges(coded.text, coded.marks) },
			attachments: [],
			reactions: [],
			blocks: [],
		};
	};

	/** The message body for Lo's text: chat marks in a chat, blocks in a discussion. */
	private build (run: Pick<LoRun, 'discussion' | 'replyTo'>, text: string) {
		if (!run.discussion) {
			return this.payload(text, run.replyTo);
		};

		return {
			replyToMessageId: run.replyTo,
			content: { text: '', style: I.TextStyle.Paragraph, marks: [] },
			blocks: LoLib.markdownToBlocks(LoLib.stripLoMarker(text)),
			attachments: [],
			reactions: [],
		};
	};

	private edit (run: LoRun, text: string): Promise<void> {
		if (text == run.sentText) {
			return run.editing;
		};

		run.sentText = text;
		run.editing = run.editing
			.then(() => this.request(cb => C.ChatEditMessageContent(run.chatId, run.messageId, this.build(run, text), cb)))
			.then(() => {})
			.catch(e => console.error('[Lo] edit:', e));

		return run.editing;
	};

	/**
	 * A live discussion comment arrived. Called by the dispatcher for ChatAdd of a discussion, whose
	 * messages keep their text in blocks. A comment that mentions Lo, or replies to a Lo comment,
	 * gets an answer in the same thread, with the discussed object as context.
	 */
	async onDiscussionAdd (spaceId: string, discussionId: string, objectId: string, raw: any) {
		const accountId = S.Auth.account?.id || '';
		const parts: I.CommentContentPart[] = U.Comment.blocksToParts(raw?.blocks, raw?.content);

		if (!raw || raw.isDeleted || (raw.creator != accountId) || raw.isSynced || this.answered.has(raw.id) || LoLib.isLoParts(parts)) {
			return;
		};

		const subId = U.Comment.getSubId(I.CommentTargetType.Object, discussionId);
		const target = raw.replyToMessageId ? S.Comment.getById(subId, raw.replyToMessageId) : null;

		if (!raw.replyToMessageId && !parts.some(it => (it.marks || []).some(m => m.type == I.MarkType.Mention))) {
			return;
		};
		if (raw.replyToMessageId && !target && !parts.some(it => (it.marks || []).some(m => m.type == I.MarkType.Mention))) {
			return;
		};

		if (!S.Agent.status) {
			await S.Agent.loadStatus();
		};

		const loId = await LoLib.ensureLoObject(spaceId).catch(() => '');
		const repliesToLo = !!target && LoLib.isLoParts(target.content?.parts || []);

		if (!S.Agent.isConfigured || !loId || !(LoLib.partsMentionLo(parts, loId) || repliesToLo)) {
			return;
		};

		this.answered.add(raw.id);
		this.enqueue(discussionId, () => this.answerDiscussion(spaceId, discussionId, objectId, subId, raw, parts, loId));
	};

	private async answerDiscussion (spaceId: string, discussionId: string, objectId: string, subId: string, raw: any, parts: I.CommentContentPart[], loId: string): Promise<void> {
		const text = LoLib.partsToText(parts, loId) || LoLib.partsToText(parts);
		const history = this.getDiscussionHistory(spaceId, subId, raw);
		const context = this.getObjectContext(spaceId, objectId, parts, loId);

		await this.start(spaceId, discussionId, subId, raw.id, true, text, context, history);
	};

	/** Earlier comments of the thread the question sits in, or of the discussion for a new post. */
	private getDiscussionHistory (spaceId: string, subId: string, raw: any) {
		let list: I.CommentMessage[] = [];

		if (raw.replyToMessageId) {
			const rootId = S.Comment.getThreadRoot(subId, raw.id) || raw.replyToMessageId;
			const root = S.Comment.getById(subId, rootId);

			list = [ root, ...S.Comment.getReplies(rootId) ].filter(it => it);
		} else {
			list = S.Comment.getPosts(subId);
		};

		const items = list.filter(it => !it.isDeleted).map(it => {
			const body = LoLib.partsToText(it.content?.parts || []);
			const isLo = LoLib.isLoParts(it.content?.parts || []);

			return { id: it.id, creator: it.creator, content: { text: isLo ? LoLib.withLoMarker(body) : body } };
		});

		return LoLib.buildChatHistory(items, raw.id, creator => this.authorName(spaceId, creator));
	};

	/** The discussed object: its name, type and text, plus any other objects the comment mentions. */
	private getObjectContext (spaceId: string, objectId: string, parts: I.CommentContentPart[], loId: string) {
		const base = S.Agent.getContext();
		const object = S.Detail.get(objectId, objectId, [ 'name', 'type' ]);
		const type = object?.type ? S.Record.getTypeById(object.type) : null;
		const mentions: any[] = [];

		parts.forEach(part => (part.marks || []).forEach((it: any) => {
			if ((it.type == I.MarkType.Mention) && it.param && (it.param != loId) && !mentions.find(m => m.id == it.param)) {
				mentions.push({ id: it.param, name: String(part.text || '').slice(it.range.from, it.range.to) });
			};
		}));

		const objectText = S.Block.getBlocks(objectId, it => it.isText())
			.map(it => String(it.getText() || '').trim())
			.filter(it => it)
			.join('\n')
			.slice(0, OBJECT_TEXT_LIMIT);

		const attachments: any[] = [];

		S.Block.getBlocks(objectId, it => it.isFile()).forEach(it => {
			const targetId = it.getTargetObjectId();
			const file = targetId ? S.Detail.get(objectId, targetId, [ 'name', 'fileMimeType' ]) : null;

			if (file && !file._empty_ && !attachments.find(a => a.id == targetId)) {
				attachments.push({ id: targetId, name: file.name || '', type: file.fileMimeType || '' });
			};
		});

		return {
			...base,
			spaceId,
			objectId: object && !object._empty_ ? objectId : '',
			attachments,
			objectName: object?.name || '',
			objectType: type?.name || '',
			objectText,
			discussion: true,
			mentions,
		};
	};

	private async answer (spaceId: string, chatId: string, subId: string, message: I.ChatMessage, loId: string): Promise<void> {
		const context = this.getContext(message, loId);
		const list: I.ChatMessage[] = subId ? S.Chat.getList(subId) : [];
		const history = LoLib.buildChatHistory(list, message.id, creator => this.authorName(spaceId, creator));

		return this.start(spaceId, chatId, subId, message.id, false, LoLib.textForLo(message, loId), context, history);
	};

	/** Posts the placeholder, then runs the model and streams its answer into that message. */
	private async start (spaceId: string, chatId: string, subId: string, replyTo: string, discussion: boolean, text: string, context: any, history: any[]): Promise<void> {
		const placeholder = this.build({ discussion, replyTo }, translate('loThinking'));
		const added: any = await this.request(cb => C.ChatAddMessage(chatId, placeholder, cb));
		const messageId = String(added.messageId || '');

		if (!messageId) {
			return;
		};

		const runId = `lo-${Date.now().toString(36)}-${messageId}`;
		const key = this.key(chatId);

		const run: LoRun = {
			chatId, subId, messageId, runId, replyTo, discussion, text: '', sentText: LoLib.withLoMarker(translate('loThinking')),
			timer: 0, editing: Promise.resolve(), stopped: false, done: () => {},
		};
		const finished = new Promise<void>(resolve => run.done = resolve);

		this.runs.set(runId, run);
		this.notify();

		if (!(await S.Agent.ensureLocalKey())) {
			this.finish(run, translate('agentErrorLocalKey'));
			return finished;
		};

		const res = await Renderer.send('agentRun', S.Common.tabId, {
			chatId: key,
			runId,
			text,
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

	/** An agent event from the main process; S.Agent forwards them all, Lo keeps its own runs. */
	onEvent (ev: any) {
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
