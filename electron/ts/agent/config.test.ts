import { describe, expect, test } from 'vitest';
import { configError, loadConfig, normalizeConfig, saveConfig } from './config';
import { AGENT_DEFAULT_CONFIG } from './types';

const memory = () => {
	const data: Record<string, any> = {};
	return { get: (k: string) => data[k], set: (k: string, v: any) => { data[k] = v; } };
};

describe('agent config', () => {
	test('defaults to Anthropic with confirmation on', () => {
		expect(loadConfig(memory())).toEqual(AGENT_DEFAULT_CONFIG);
		expect(AGENT_DEFAULT_CONFIG.confirm).toBe(true);
	});

	test('drops invalid values and trims the base URL', () => {
		const out = normalizeConfig({ provider: 'nope', tier: 'huge', baseUrl: ' http://localhost:11434/v1/ ', confirm: 0 });
		expect(out.provider).toBe('anthropic');
		expect(out.tier).toBe('auto');
		expect(out.baseUrl).toBe('http://localhost:11434/v1');
		expect(out.confirm).toBe(true);
	});

	test('only an explicit false turns confirmation off', () => {
		expect(normalizeConfig({ confirm: false }).confirm).toBe(false);
	});

	test('a custom provider has no default model', () => {
		expect(normalizeConfig({ provider: 'custom' }).model).toBe('');
	});

	test('saveConfig merges a patch and persists it', () => {
		const store = memory();
		saveConfig(store, { provider: 'custom', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' });
		const out = saveConfig(store, { confirm: false });
		expect(out).toMatchObject({ provider: 'custom', model: 'llama3.1', confirm: false });
		expect(loadConfig(store)).toEqual(out);
	});

	test('configError names what is missing', () => {
		const base = AGENT_DEFAULT_CONFIG;
		expect(configError(base, false)).toBe('providerKey');
		expect(configError(base, true)).toBe('');
		expect(configError({ ...base, model: '' }, true)).toBe('model');
		expect(configError({ ...base, provider: 'custom', model: 'm', baseUrl: '' }, false)).toBe('baseUrl');
		expect(configError({ ...base, provider: 'custom', model: 'm', baseUrl: 'http://localhost:1234/v1' }, false)).toBe('');
	});
});
