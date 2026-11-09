import { AppToolBridge, createAppTools } from './appTools';
import { createFileTools } from './fileTools';
import { PROVIDER_KEY, configError, loadConfig, localKeyName, saveConfig, type ConfigStore, type SecretStore } from './config';
import { McpToolbox } from './mcp';
import { resolveModel } from './models';
import { resolveTier } from './policy';
import { AgentSession } from './session';
import type { AgentConfig, AgentRunParams, AgentStatus, AgentUiEvent } from './types';

export interface AgentServiceDeps {
	store: ConfigStore;
	secrets: SecretStore;
	/** Delivers an event or app-tool request to one renderer tab. */
	sendToTab: (tabId: string, channel: string, payload: any) => void;
};

interface Entry {
	session: AgentSession;
	toolbox: McpToolbox;
	signature: string;
	tabId: string;
};

/**
 * Owns the chats of the agent sidebar: one pi session per chat, created on the first message and
 * rebuilt when the provider, model or local API connection changes.
 */
export class AgentService {

	private entries: Map<string, Entry> = new Map();
	private bridge: AppToolBridge;

	constructor (private deps: AgentServiceDeps) {
		this.bridge = new AppToolBridge({
			send: (tabId, payload) => deps.sendToTab(tabId, 'agentAppToolCall', payload),
		});
	};

	async status (accountId = ''): Promise<AgentStatus> {
		return {
			config: loadConfig(this.deps.store),
			hasProviderKey: !!(await this.deps.secrets.get(PROVIDER_KEY)),
			hasLocalKey: accountId ? !!(await this.deps.secrets.get(localKeyName(accountId))) : false,
		};
	};

	async setConfig (patch: Partial<AgentConfig>): Promise<AgentStatus> {
		saveConfig(this.deps.store, patch);
		return this.status();
	};

	/** An empty key removes the stored one. */
	async setProviderKey (key: string): Promise<AgentStatus> {
		if (key) {
			await this.deps.secrets.set(PROVIDER_KEY, key);
		} else {
			await this.deps.secrets.delete(PROVIDER_KEY);
		};
		return this.status();
	};

	async setLocalKey (accountId: string, key: string): Promise<void> {
		if (accountId && key) {
			await this.deps.secrets.set(localKeyName(accountId), key);
		};
	};

	async run (tabId: string, params: AgentRunParams): Promise<{ error?: string }> {
		const { chatId, runId, context } = params;
		const emit = (event: AgentUiEvent) => this.deps.sendToTab(this.entries.get(chatId)?.tabId || tabId, 'agentEvent', event);

		const config = loadConfig(this.deps.store);
		const providerKey = await this.deps.secrets.get(PROVIDER_KEY);
		const localKey = await this.deps.secrets.get(localKeyName(context.accountId));

		const problem = configError(config, !!providerKey);
		if (problem) {
			return { error: problem };
		};
		if (!context.apiAddr) {
			return { error: 'localApiOff' };
		};
		if (!localKey) {
			return { error: 'localKey' };
		};

		const tier = resolveTier(config);
		const signature = JSON.stringify([ config.provider, config.model, config.baseUrl, tier, context.apiAddr, localKey, providerKey ]);

		let entry = this.entries.get(chatId);
		if (entry && (entry.signature !== signature)) {
			await this.dispose(chatId);
			entry = undefined;
		};

		if (!entry) {
			const toolbox = new McpToolbox({ addr: context.apiAddr, tier, key: localKey });

			try {
				await toolbox.connect();
			} catch (e: any) {
				await toolbox.close();
				return { error: `mcp: ${String(e?.message || e)}` };
			};

			const created: Entry = { toolbox, signature, tabId, session: null as any };
			const resolved = resolveModel(config);

			created.session = new AgentSession({
				config,
				resolved,
				toolbox,
				appTools: [
					...createAppTools(this.bridge, () => created.tabId),
					...createFileTools({
						addr: context.apiAddr,
						key: localKey,
						bridge: this.bridge,
						getTabId: () => created.tabId,
						canSeeImages: !!resolved.model.input?.includes('image'),
					}),
				],
				// A keyless local server still needs a non-empty bearer for OpenAI-style clients
				getApiKey: () => providerKey || ((config.provider == 'custom') ? 'none' : undefined),
				emit,
			});
			this.entries.set(chatId, created);
			entry = created;
		};

		entry.tabId = tabId;
		entry.session.updateConfig(config);

		if (entry.session.isRunning) {
			entry.session.steer(params.text);
			return {};
		};

		// The run streams events; the call itself returns once it has started
		entry.session.run(params).catch(() => {});
		return {};
	};

	stop (chatId: string): void {
		this.entries.get(chatId)?.session.stop();
	};

	steer (chatId: string, text: string): void {
		this.entries.get(chatId)?.session.steer(text);
	};

	approve (chatId: string, callId: string, allow: boolean): void {
		this.entries.get(chatId)?.session.approve(callId, allow);
	};

	appToolResult (id: string, result: any): void {
		this.bridge.resolve(id, result);
	};

	async dispose (chatId: string): Promise<void> {
		const entry = this.entries.get(chatId);

		this.entries.delete(chatId);
		if (entry) {
			entry.session.stop();
			await entry.toolbox.close();
		};
	};

	async disposeAll (): Promise<void> {
		await Promise.all([ ...this.entries.keys() ].map(id => this.dispose(id)));
	};

};
