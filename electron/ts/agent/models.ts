import { createModels, createProvider, type Api, type Model } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { AgentConfig } from './types';

const CUSTOM_PROVIDER_ID = 'custom';

export interface ResolvedModel {
	model: Model<Api>;
	streamFn: (model: Model<Api>, context: any, options?: any) => any;
	/** Provider id to ask getApiKey for. */
	providerId: string;
};

/**
 * Builds the pi-ai model for the configured provider: the built-in Anthropic catalog, or one
 * OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, OpenRouter...) at a user-given base URL.
 */
export const resolveModel = (config: AgentConfig): ResolvedModel => {
	const models = createModels();

	if (config.provider == 'anthropic') {
		models.setProvider(anthropicProvider());

		const model = models.getModel('anthropic', config.model);
		if (!model) {
			throw new Error(`Unknown Anthropic model "${config.model}"`);
		};
		return { model, streamFn: models.streamSimple.bind(models), providerId: 'anthropic' };
	};

	const model: Model<'openai-completions'> = {
		id: config.model,
		name: config.model,
		api: 'openai-completions',
		provider: CUSTOM_PROVIDER_ID,
		baseUrl: config.baseUrl,
		reasoning: false,
		input: [ 'text' ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
		// Local servers such as Ollama and LM Studio reject the "developer" role and reasoning_effort
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
	};

	models.setProvider(createProvider({
		id: CUSTOM_PROVIDER_ID,
		name: 'Custom',
		baseUrl: config.baseUrl,
		// The key is passed per request through the agent's getApiKey; a keyless local server needs none
		auth: { apiKey: { name: 'Custom', resolve: async () => ({ auth: {} }) } },
		models: [ model ],
		api: openAICompletionsApi(),
	}));

	return { model, streamFn: models.streamSimple.bind(models), providerId: CUSTOM_PROVIDER_ID };
};
