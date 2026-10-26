import type { Store } from '../store.js';

export type Provider = 'anthropic' | 'openai';
export interface AiConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
  /** Whether a key is stored. The key itself never leaves the main process. */
  hasKey: boolean;
}
export interface AiSettings extends Omit<AiConfig, 'hasKey'> {
  apiKey: string;
}

const DEFAULTS: Record<Provider, { model: string; baseUrl: string }> = {
  anthropic: { model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com' },
  openai: { model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' },
};

export function loadSettings(store: Store): AiSettings {
  const provider: Provider = store.getMeta('ai_provider') === 'openai' ? 'openai' : 'anthropic';
  return {
    provider,
    model: store.getMeta('ai_model') || DEFAULTS[provider].model,
    baseUrl: store.getMeta('ai_base_url') || DEFAULTS[provider].baseUrl,
    apiKey: store.getMeta('ai_key') ?? '',
  };
}

export function publicConfig(store: Store): AiConfig {
  const s = loadSettings(store);
  return { provider: s.provider, model: s.model, baseUrl: s.baseUrl, hasKey: !!s.apiKey };
}

export function saveSettings(store: Store, input: { provider: string; model: string; baseUrl: string; apiKey?: string }): AiConfig {
  if (input.provider !== 'anthropic' && input.provider !== 'openai') throw new Error('Provider must be anthropic or openai.');
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL must start with http:// or https://');
  const model = input.model.trim();
  if (model.length > 120) throw new Error('Model name is too long.');
  store.setMeta('ai_provider', input.provider);
  store.setMeta('ai_model', model);
  store.setMeta('ai_base_url', baseUrl);
  if (input.apiKey !== undefined) {
    if (input.apiKey.length > 500) throw new Error('That does not look like an API key.');
    store.setMeta('ai_key', input.apiKey.trim());
  }
  return publicConfig(store);
}
