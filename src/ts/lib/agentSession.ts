import * as I from 'Interface';
import type { AgentChatMessage, AgentPart } from 'Store/agent';

/**
 * AI agent chat sessions are stored as objects in the space, so they sync to the user's other
 * devices and show up in search. Every space gets the same schema, created on first save:
 * - type "AI Chat" (TYPE_KEY), one object per session; its name is the session title
 * - a hidden long-text relation (RELATION_KEY) holding the messages as JSON
 */
export const TYPE_KEY = 'ot-loomAgentChat';
export const RELATION_KEY = 'loomAgentMessages';

const FORMAT_VERSION = 1;
const MAX_MESSAGES = 200;
const MAX_TOOL_TEXT = 2000;
const MAX_TITLE = 60;

export interface AgentSessionMeta {
	id: string;
	name: string;
	lastModifiedDate: number;
};

const clip = (s: string, max: number): string => (s.length > max) ? `${s.slice(0, max)}…` : s;

/** The session title: the first user message, on one line. */
export const sessionTitle = (messages: AgentChatMessage[]): string => {
	const first = messages.find(it => it.role == 'user');
	const text = first ? first.parts.map(it => (it.type == 'text' ? it.text : '')).join(' ') : '';

	return clip(text.replace(/\s+/g, ' ').trim(), MAX_TITLE);
};

/** Messages as stored: the latest MAX_MESSAGES, with long tool arguments and results cut short. */
export const serializeMessages = (messages: AgentChatMessage[]): string => {
	const out = messages.slice(-MAX_MESSAGES).map(message => ({
		role: message.role,
		mentions: message.mentions?.length ? message.mentions : undefined,
		parts: message.parts.map(part => {
			if (part.type == 'text') {
				return part;
			};

			const args = JSON.stringify(part.args ?? {});
			return {
				...part,
				args: (args.length > MAX_TOOL_TEXT) ? { truncated: clip(args, MAX_TOOL_TEXT) } : part.args,
				result: clip(String(part.result || ''), MAX_TOOL_TEXT),
			};
		}),
	}));

	return JSON.stringify({ v: FORMAT_VERSION, messages: out });
};

/**
 * Reads stored messages back, dropping anything malformed. A tool that was still running or
 * waiting for approval when the session was saved can never finish, so it comes back as failed.
 */
export const parseMessages = (json: string, nextId: () => string): AgentChatMessage[] => {
	let data: any = null;

	try {
		data = JSON.parse(String(json || ''));
	} catch (e) {
		return [];
	};

	const list = Array.isArray(data?.messages) ? data.messages : [];
	const messages: AgentChatMessage[] = [];

	for (const it of list) {
		if (![ 'user', 'assistant' ].includes(it?.role) || !Array.isArray(it.parts)) {
			continue;
		};

		const parts: AgentPart[] = [];

		for (const part of it.parts) {
			if ((part?.type == 'text') && (typeof part.text == 'string')) {
				parts.push({ type: 'text', text: part.text });
			} else
			if ((part?.type == 'tool') && part.callId) {
				const stale = [ 'running', 'approval' ].includes(part.status);

				parts.push({
					type: 'tool',
					callId: String(part.callId),
					name: String(part.name || ''),
					label: String(part.label || part.name || ''),
					args: part.args ?? {},
					readOnly: !!part.readOnly,
					status: stale ? 'error' : ((part.status == 'error') ? 'error' : 'done'),
					result: String(part.result || ''),
				});
			};
		};

		const mentions = Array.isArray(it.mentions) ? it.mentions.filter((m: any) => m && m.id && Number.isFinite(m.from) && Number.isFinite(m.to)) : [];

		if (parts.length) {
			messages.push({ id: nextId(), role: it.role, parts, mentions });
		};
	};

	return messages;
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

const schemaReady: Map<string, Promise<void>> = new Map();

/** Creates the AI Chat type and the messages relation in the space if they are not there yet. */
const ensureSchema = (spaceId: string): Promise<void> => {
	if (!schemaReady.has(spaceId)) {
		const ready = (async () => {
			if (!S.Record.getRelationByKey(RELATION_KEY)) {
				await request(cb => C.ObjectCreateRelation({
					relationKey: RELATION_KEY,
					name: translate('agentSessionRelation'),
					relationFormat: I.RelationType.LongText,
					isHidden: true,
				}, spaceId, cb)).catch(e => {
					// Created meanwhile from another device: the key is fixed, so that copy is ours
					if (!/exist/i.test(e.message)) {
						throw e;
					};
				});
			};

			if (!S.Record.getTypeByKey(TYPE_KEY)) {
				await request(cb => C.ObjectCreateObjectType({
					uniqueKey: TYPE_KEY,
					name: translate('agentSessionType'),
					pluralName: translate('agentSessionTypePlural'),
					iconName: 'chatbubble',
					recommendedLayout: I.ObjectLayout.Page,
				}, [], spaceId, cb)).catch(e => {
					if (!/exist/i.test(e.message)) {
						throw e;
					};
				});
			};
		})();

		// A failure is not cached: the next save tries again
		ready.catch(() => schemaReady.delete(spaceId));
		schemaReady.set(spaceId, ready);
	};

	return schemaReady.get(spaceId);
};

/** Creates the session object and returns its id. */
export const createSession = async (spaceId: string, name: string, messages: string): Promise<string> => {
	await ensureSchema(spaceId);

	const message: any = await request(cb => C.ObjectCreate({ name, [RELATION_KEY]: messages }, [], '', TYPE_KEY, spaceId, cb));
	return message.objectId;
};

export const updateSession = (objectId: string, name: string, messages: string): Promise<void> => {
	return request(cb => C.ObjectListSetDetails([ objectId ], [
		{ key: 'name', value: name },
		{ key: RELATION_KEY, value: messages },
	], cb));
};

/** The space's sessions, most recently changed first. */
export const listSessions = (spaceId: string, limit = 100): Promise<AgentSessionMeta[]> => new Promise(resolve => {
	U.Subscription.search({
		spaceId,
		filters: [ { relationKey: 'type.uniqueKey', condition: I.FilterCondition.Equal, value: TYPE_KEY } ],
		sorts: [ { relationKey: 'lastModifiedDate', type: I.SortType.Desc } ],
		keys: [ 'id', 'name', 'lastModifiedDate' ],
		limit,
	}, (message: any) => {
		resolve((message.records || []).filter(it => !it._empty_).map(it => ({
			id: it.id,
			name: String(it.name || ''),
			lastModifiedDate: Number(it.lastModifiedDate) || 0,
		})));
	});
});

/** The stored messages JSON of a session, empty when it no longer exists. */
export const loadSession = (spaceId: string, objectId: string): Promise<{ name: string; messages: string } | null> => new Promise(resolve => {
	U.Subscription.search({
		spaceId,
		filters: [ { relationKey: 'id', condition: I.FilterCondition.Equal, value: objectId } ],
		keys: [ 'id', 'name', RELATION_KEY ],
		limit: 1,
	}, (message: any) => {
		const record = (message.records || []).find(it => !it._empty_);
		resolve(record ? { name: String(record.name || ''), messages: String(record[RELATION_KEY] || '') } : null);
	});
});

/** Moves the session to the bin, where it can still be restored. */
export const deleteSession = (objectId: string): Promise<void> => {
	return request(cb => C.ObjectListSetIsArchived([ objectId ], true, false, cb));
};
