/**
 * Slash commands of the AI agent composer, typed as `/name` at the start of the input.
 * Actions run at once; prompts fill the input with a prompt about the open object that the
 * user can edit before sending.
 */
export type AgentCommandId = 'new' | 'history' | 'settings' | 'stop' | 'summarize' | 'tasks' | 'explain' | 'translate';

export interface AgentCommand {
	id: AgentCommandId;
	kind: 'action' | 'prompt';
	/** Translation keys of the menu row and, for prompts, of the text put into the input. */
	nameKey: string;
	promptKey?: string;
};

export const AGENT_COMMANDS: AgentCommand[] = [
	{ id: 'summarize', kind: 'prompt', nameKey: 'agentCommandSummarize', promptKey: 'agentPromptSummarize' },
	{ id: 'tasks', kind: 'prompt', nameKey: 'agentCommandTasks', promptKey: 'agentPromptTasks' },
	{ id: 'explain', kind: 'prompt', nameKey: 'agentCommandExplain', promptKey: 'agentPromptExplain' },
	{ id: 'translate', kind: 'prompt', nameKey: 'agentCommandTranslate', promptKey: 'agentPromptTranslate' },
	{ id: 'new', kind: 'action', nameKey: 'agentCommandNew' },
	{ id: 'history', kind: 'action', nameKey: 'agentCommandHistory' },
	{ id: 'settings', kind: 'action', nameKey: 'agentCommandSettings' },
	{ id: 'stop', kind: 'action', nameKey: 'agentCommandStop' },
];

/** Commands whose `/id` starts with the typed filter, e.g. "su" → summarize. */
export const matchCommands = (filter: string, commands: AgentCommand[] = AGENT_COMMANDS): AgentCommand[] => {
	const query = String(filter || '').trim().toLowerCase().replace(/^\//, '');
	return query ? commands.filter(it => it.id.startsWith(query)) : commands;
};

/**
 * The filter typed after a leading "/", or null when the text before the caret is not a command
 * being typed. Commands only open at the very start of the input, so paths and URLs never do.
 */
export const commandQuery = (value: string, caret: number): string | null => {
	const before = String(value || '').slice(0, caret);
	const match = before.match(/^\/([a-z]*)$/i);

	return match ? match[1] : null;
};
