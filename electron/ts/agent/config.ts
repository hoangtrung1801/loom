import { AGENT_DEFAULT_CONFIG, AgentConfig, AgentProviderId, AgentTier } from './types';

const STORE_KEY = 'agentConfig';

export interface ConfigStore {
	get: (key: string) => any;
	set: (key: string, value: any) => void;
};

export interface SecretStore {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string) => Promise<void> | void;
	delete: (key: string) => Promise<void> | void;
};

export const PROVIDER_KEY = 'agent-provider-key';
export const localKeyName = (accountId: string) => `agent-local-key-${accountId}`;

const PROVIDERS: AgentProviderId[] = [ 'anthropic', 'custom' ];
const TIERS: AgentTier[] = [ 'auto', 'large', 'small' ];

/** Coerces anything stored (or sent from the renderer) into a valid config. */
export const normalizeConfig = (raw: any): AgentConfig => {
	const d = AGENT_DEFAULT_CONFIG;
	const obj = raw && (typeof raw == 'object') ? raw : {};
	const provider = PROVIDERS.includes(obj.provider) ? obj.provider : d.provider;
	const model = String(obj.model || '').trim();

	return {
		provider,
		model: model || ((provider == d.provider) ? d.model : ''),
		baseUrl: String(obj.baseUrl || '').trim().replace(/\/+$/, ''),
		tier: TIERS.includes(obj.tier) ? obj.tier : d.tier,
		confirm: obj.confirm !== false,
	};
};

export const loadConfig = (store: ConfigStore): AgentConfig => normalizeConfig(store.get(STORE_KEY));

export const saveConfig = (store: ConfigStore, patch: Partial<AgentConfig>): AgentConfig => {
	const next = normalizeConfig({ ...loadConfig(store), ...patch });
	store.set(STORE_KEY, next);
	return next;
};

/** Returns an error message when the config cannot run, empty string otherwise. */
export const configError = (config: AgentConfig, hasProviderKey: boolean): string => {
	if (!config.model) {
		return 'model';
	};
	if (config.provider == 'custom') {
		return /^https?:\/\//.test(config.baseUrl) ? '' : 'baseUrl';
	};
	return hasProviderKey ? '' : 'providerKey';
};
