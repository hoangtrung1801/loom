import * as I from 'Interface';

/**
 * Lo is the AI agent, and a virtual member of chats. The middleware signs every chat message with
 * the account that sent it and has no field for extra data, so Lo's messages are posted by the
 * user's account and end with an invisible marker; Loom shows marked messages as Lo.
 */
export const AGENT_NAME = 'Lo';
export const TYPE_KEY = 'ot-loomAgent';
export const LO_MARKER = '⁣​⁣';
export const HISTORY_LIMIT = 30;

export interface LoMessageLike {
	id: string;
	creator: string;
	replyToMessageId?: string;
	content?: { text?: string; marks?: { type: number; param?: string }[] };
};

export const isLoText = (text: string): boolean => String(text || '').endsWith(LO_MARKER);

export const isLoMessage = (message: Pick<LoMessageLike, 'content'>): boolean => isLoText(message?.content?.text || '');

export const stripLoMarker = (text: string): string => isLoText(text) ? String(text).slice(0, -LO_MARKER.length) : String(text || '');

export const withLoMarker = (text: string): string => stripLoMarker(text) + LO_MARKER;

/** True when the message has a mention of the Lo object. */
export const mentionsLo = (message: Pick<LoMessageLike, 'content'>, loId: string): boolean => {
	if (!loId) {
		return false;
	};
	return (message?.content?.marks || []).some(it => (it.type == I.MarkType.Mention) && (it.param == loId));
};

export interface ReplyContext {
	loId: string;
	accountId: string;
	configured: boolean;
	/** Looks a message up by id, for replies. */
	getMessage: (id: string) => LoMessageLike | null;
	/** Ids of messages that already have a Lo reply, or are being answered right now. */
	answered: Set<string>;
};

/** Whether Lo should answer a message that has just arrived. */
export const shouldLoReply = (message: LoMessageLike, ctx: ReplyContext): boolean => {
	if (!ctx.configured || !ctx.loId || !ctx.accountId) {
		return false;
	};
	if (isLoMessage(message) || (message.creator != ctx.accountId)) {
		return false;
	};
	if (ctx.answered.has(message.id)) {
		return false;
	};

	if (mentionsLo(message, ctx.loId)) {
		return true;
	};

	const target = message.replyToMessageId ? ctx.getMessage(message.replyToMessageId) : null;
	return !!target && isLoMessage(target);
};

/** The user's text for the agent: Lo's own mention is removed. A message that is only the mention stays as it is. */
export const textForLo = (message: LoMessageLike, loId: string): string => {
	const text = String(message?.content?.text || '');
	const mark = (message?.content?.marks || []).find(it => (it.type == I.MarkType.Mention) && (it.param == loId)) as any;
	const range = mark?.range;

	if (!range) {
		return text.trim();
	};

	const out = (text.slice(0, range.from) + text.slice(range.to)).replace(/[ \t]{2,}/g, ' ').trim();
	return out || text.trim();
};

export interface HistoryItem {
	role: 'user' | 'assistant';
	text: string;
};

/**
 * Earlier messages of the chat for the agent: Lo's become assistant turns, the others user turns
 * prefixed with the author. The message being answered is not part of it.
 */
export const buildChatHistory = (
	messages: (LoMessageLike & { content?: { text?: string } })[],
	currentId: string,
	getAuthor: (creator: string) => string,
	limit = HISTORY_LIMIT,
): HistoryItem[] => {
	const items: HistoryItem[] = [];

	for (const m of messages) {
		if (m.id == currentId) {
			break;
		};

		const raw = String(m.content?.text || '');
		const text = stripLoMarker(raw).trim();

		if (!text) {
			continue;
		};

		if (isLoText(raw)) {
			items.push({ role: 'assistant', text });
		} else {
			const author = getAuthor(m.creator);
			items.push({ role: 'user', text: author ? `${author}: ${text}` : text });
		};
	};

	return items.slice(-limit);
};

const request = <T>(fn: (cb: (message: any) => void) => void): Promise<T> => new Promise((resolve, reject) => {
	fn((message: any) => {
		if (message.error?.code) {
			reject(new Error(message.error.description || 'request failed'));
		} else {
			resolve(message);
		};
	});
});

const loIds: Map<string, Promise<string>> = new Map();

const findLo = (spaceId: string): Promise<string> => new Promise(resolve => {
	U.Subscription.search({
		spaceId,
		filters: [
			{ relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: TYPE_KEY },
			{ relationKey: 'isArchived', condition: I.FilterCondition.Equal, value: false },
		],
		sorts: [ { relationKey: 'createdDate', type: I.SortType.Asc } ],
		keys: [ 'id', 'name' ],
		limit: 1,
	}, (message: any) => {
		resolve((message.records || []).find(it => !it._empty_)?.id || '');
	});
});

/**
 * Id of the Lo object of the space, created with its type on first use. Mentions need an object
 * to point at, and this is it.
 */
export const ensureLoObject = (spaceId: string): Promise<string> => {
	if (!loIds.has(spaceId)) {
		const ready = (async () => {
			const found = await findLo(spaceId);
			if (found) {
				return found;
			};

			if (!S.Record.getTypeByKey(TYPE_KEY)) {
				await request(cb => C.ObjectCreateObjectType({
					uniqueKey: TYPE_KEY,
					name: translate('loType'),
					pluralName: translate('loTypePlural'),
					iconName: 'chatbubble',
					recommendedLayout: I.ObjectLayout.Page,
				}, [], spaceId, cb)).catch(e => {
					if (!/exist/i.test(e.message)) {
						throw e;
					};
				});
			};

			const message: any = await request(cb => C.ObjectCreate({ name: AGENT_NAME }, [], '', TYPE_KEY, spaceId, cb));
			return String(message.objectId || '');
		})();

		// A failure is not cached: the next call tries again
		ready.catch(() => loIds.delete(spaceId));
		loIds.set(spaceId, ready);
	};

	return loIds.get(spaceId);
};

/** Inline markdown Lo's answers use: fences (left for U.Chat.fenceToCodeMarks), code, bold, italic, strike, links, headings. */
const INLINE_MD = /```[\s\S]*?(?:```|(?![\s\S]))|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|~~([^~\n]+)~~|\[([^\]\n]+)\]\(([^)\s]+)\)|^#{1,6} +([^\n]+)$/gm;

/**
 * Turns the inline markdown of a model answer into chat marks, so Lo's messages render formatted
 * instead of showing asterisks. Code fences are kept as they are, for U.Chat.fenceToCodeMarks.
 */
export const formatLoInline = (value: string): { text: string; marks: I.Mark[] } => {
	const source = String(value || '');
	const marks: I.Mark[] = [];

	let text = '';
	let last = 0;
	let match: RegExpExecArray | null;

	INLINE_MD.lastIndex = 0;
	while ((match = INLINE_MD.exec(source)) !== null) {
		if (!match[0].length) {
			INLINE_MD.lastIndex++;
			continue;
		};

		text += source.slice(last, match.index);
		last = match.index + match[0].length;

		const [ all, code, bold, italic, strike, linkText, linkUrl, heading ] = match;
		const add = (inner: string, type: I.MarkType, param = '') => {
			marks.push({ type, param, range: { from: text.length, to: text.length + inner.length } });
			text += inner;
		};

		if (code) {
			add(code, I.MarkType.Code);
		} else
		if (bold || heading) {
			add(bold || heading, I.MarkType.Bold);
		} else
		if (italic) {
			add(italic, I.MarkType.Italic);
		} else
		if (strike) {
			add(strike, I.MarkType.Strike);
		} else
		if (linkText) {
			add(linkText, I.MarkType.Link, linkUrl);
		} else {
			text += all;
		};
	};

	text += source.slice(last);
	return { text, marks };
};
