export type AgentProviderId = 'anthropic' | 'custom';
export type AgentTier = 'auto' | 'large' | 'small';

/** User-editable agent settings. Secrets (provider key) are never part of this object. */
export interface AgentConfig {
	provider: AgentProviderId;
	model: string;
	/** OpenAI-compatible endpoint, used when provider is "custom" (e.g. http://localhost:11434/v1). */
	baseUrl: string;
	tier: AgentTier;
	/** Ask before every tool that changes data. */
	confirm: boolean;
};

/** What the renderer is looking at when a message is sent. */
export interface AgentContext {
	spaceId: string;
	spaceName: string;
	objectId: string;
	objectName: string;
	objectType: string;
	/** Host:port of the local API, e.g. 127.0.0.1:31009. */
	apiAddr: string;
	/** Account the local API key belongs to. */
	accountId: string;
	/** Objects the user referenced with @ in this message. */
	mentions?: AgentMention[];
	/** Text of the open object, when the question comes from its discussion. */
	objectText?: string;
	/** The question was asked in the open object's discussion. */
	discussion?: boolean;
};

export interface AgentMention {
	id: string;
	name: string;
	type?: string;
};

export interface AgentRunParams {
	chatId: string;
	runId: string;
	text: string;
	context: AgentContext;
	/** Earlier turns, used only to reseed a chat the main process no longer remembers. */
	/** Chat runs have nobody to approve a change, so tools that change data are refused. */
	readOnly?: boolean;
	history?: { role: 'user' | 'assistant'; text: string }[];
};

/** Events streamed to the renderer tab that started the run. */
export type AgentUiEvent =
	{ runId: string; type: 'start' } |
	{ runId: string; type: 'text'; delta: string } |
	{ runId: string; type: 'toolStart'; callId: string; name: string; label: string; args: any; readOnly: boolean } |
	{ runId: string; type: 'toolEnd'; callId: string; isError: boolean; text: string } |
	{ runId: string; type: 'approval'; callId: string; name: string; label: string; args: any } |
	{ runId: string; type: 'end'; stopReason: string; error?: string };

export interface AgentStatus {
	config: AgentConfig;
	hasProviderKey: boolean;
	hasLocalKey: boolean;
};

export const AGENT_DEFAULT_CONFIG: AgentConfig = {
	provider: 'anthropic',
	model: 'claude-sonnet-5-5',
	baseUrl: '',
	tier: 'auto',
	confirm: true,
};
