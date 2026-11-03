import { AgentConfig, AgentTier } from './types';

export const MAX_TURNS = 25;
export const MAX_RESULT_CHARS = 16000;
export const MAX_HISTORY_MESSAGES = 60;
export const APP_TOOL_PREFIX = 'loom_';

/** Which MCP tier to ask for: large models get every tool, local models the small set. */
export const resolveTier = (config: Pick<AgentConfig, 'provider' | 'tier'>): Exclude<AgentTier, 'auto'> => {
	if (config.tier !== 'auto') {
		return config.tier;
	};
	return config.provider === 'anthropic' ? 'large' : 'small';
};

/** Cuts a tool result so one huge read cannot flood the context window. */
export const truncateText = (text: string, max = MAX_RESULT_CHARS): string => {
	text = String(text || '');
	if (text.length <= max) {
		return text;
	};
	return `${text.slice(0, max)}\n…[truncated ${text.length - max} characters — use find/read with a narrower request]`;
};

/**
 * Keeps the newest messages. The window always starts on a user message, so a tool result is
 * never separated from the assistant message that called the tool.
 */
export const trimMessages = <T extends { role: string }>(messages: T[], max = MAX_HISTORY_MESSAGES): T[] => {
	if (messages.length <= max) {
		return messages;
	};

	// The leading system messages (prompt, tool declarations) always stay
	let head = 0;
	while ((head < messages.length) && (messages[head].role === 'system')) {
		head++;
	};

	const rest = messages.slice(head);
	if (rest.length <= max) {
		return messages;
	};

	let start = rest.length - max;
	while ((start < rest.length) && (rest[start].role !== 'user')) {
		start++;
	};
	if (start >= rest.length) {
		start = rest.length - max;
	};

	// A system message written just before the user message (app context) belongs with it
	while ((start > 0) && (rest[start - 1].role === 'system')) {
		start--;
	};

	return messages.slice(0, head).concat(rest.slice(start));
};

/** MCP tools declare readOnlyHint; anything that does not is treated as a change. */
export const isMutating = (readOnlyHint?: boolean): boolean => readOnlyHint !== true;

/** Folds earlier turns into one prompt section for a chat the main process no longer holds. */
export const historySection = (history: { role: string; text: string }[] = []): string => {
	const lines = history.filter(it => it.text).map(it => `${it.role}: ${it.text}`);
	return lines.length ? `<previous_conversation>\n${lines.join('\n')}\n</previous_conversation>` : '';
};

export const contextSection = (ctx: {
	spaceId?: string; spaceName?: string; objectId?: string; objectName?: string; objectType?: string;
	mentions?: { id: string; name: string; type?: string }[];
}): string => {
	const lines: string[] = [];

	if (ctx.spaceId) {
		lines.push(`Current space: ${ctx.spaceName || ''} (id: ${ctx.spaceId})`);
	};
	if (ctx.objectId) {
		lines.push(`Open object: ${ctx.objectName || 'Untitled'}${ctx.objectType ? ` [${ctx.objectType}]` : ''} (id: ${ctx.objectId})`);
	};

	const mentions = (ctx.mentions || []).filter(it => it && it.id).slice(0, 20);
	if (mentions.length) {
		lines.push('Objects the user referenced with @ in their message:');
		mentions.forEach(it => lines.push(`- ${it.name || 'Untitled'}${it.type ? ` [${it.type}]` : ''} (id: ${it.id})`));
	};
	return lines.length ? `<app_context>\n${lines.join('\n')}\n</app_context>` : '';
};

/** Told to the model when a run may only read, as in a chat where nobody can approve a change. */
export const READ_ONLY_NOTE = 'This conversation is in a shared chat, where you can only read. You cannot create or change anything here: if the user asks for a change, say so briefly and suggest they ask you in the Lo side panel.';

export const SYSTEM_PROMPT = [
	'You are Lo, the assistant built into Loom, a note-taking and knowledge app. You help the user read and change their own data (spaces, objects, properties, blocks).',
	'Use the provided tools to look things up before answering; never invent object contents. Prefer the current space and open object from <app_context> when the user says "this page" or "here".',
	'When the user writes @Name, they mean the referenced object of that name listed in <app_context>; read it by its id.',
	'When you pass an object id from <app_context> to a tool, also pass the current space id as `space`, since no find has set the working space yet.',
	'Make the smallest change that does what was asked and say what you changed. If a request is ambiguous or would affect many objects, ask first.',
	'Answer concisely in markdown.',
].join('\n');
