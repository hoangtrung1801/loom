import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai';

const state = vi.hoisted(() => ({ faux: null as any, connects: 0, closes: 0, fail: '' }));

vi.mock('./models', async () => {
	const ai = await import('@earendil-works/pi-ai');
	return {
		resolveModel: () => {
			const models = ai.createModels();
			models.setProvider(state.faux.provider);
			return { model: state.faux.getModel(), streamFn: models.streamSimple.bind(models), providerId: 'faux' };
		},
	};
});

vi.mock('./mcp', () => ({
	McpToolbox: class {
		tools: any[] = [];
		readOnly = new Map();
		instructions = '';
		constructor (public options: any) {};
		async connect () {
			state.connects++;
			if (state.fail) {
				throw new Error(state.fail);
			};
		};
		async close () { state.closes++; };
	},
}));

import { AgentService } from './index';
import { localKeyName, PROVIDER_KEY } from './config';

const ctx = { spaceId: 's1', spaceName: 'Work', objectId: '', objectName: '', objectType: '', apiAddr: '127.0.0.1:31009', accountId: 'acc' };

const make = (secrets: Record<string, string> = { [PROVIDER_KEY]: 'sk', [localKeyName('acc')]: 'local' }) => {
	const data: Record<string, any> = {};
	const sent: { tabId: string; channel: string; payload: any }[] = [];
	const service = new AgentService({
		store: { get: k => data[k], set: (k, v) => { data[k] = v; } },
		secrets: {
			get: async k => secrets[k] ?? null,
			set: async (k, v) => { secrets[k] = v; },
			delete: async k => { delete secrets[k]; },
		},
		sendToTab: (tabId, channel, payload) => sent.push({ tabId, channel, payload }),
	});
	return { service, sent, secrets };
};

const params = (text = 'hi', chatId = 'c1') => ({ chatId, runId: `run-${text}`, text, context: ctx });
const waitEnd = async (sent: any[], runId: string) => {
	const start = Date.now();
	while (!sent.some(s => (s.channel == 'agentEvent') && (s.payload.type == 'end') && (s.payload.runId == runId))) {
		if (Date.now() - start > 3000) {
			throw new Error('run did not end');
		};
		await new Promise(r => setTimeout(r, 5));
	};
};

describe('AgentService', () => {
	beforeEach(() => {
		state.faux = fauxProvider();
		state.connects = 0;
		state.closes = 0;
		state.fail = '';
	});

	test('reports what is configured without exposing any secret', async () => {
		const { service } = make();
		const status: any = await service.status('acc');

		expect(status).toMatchObject({ hasProviderKey: true, hasLocalKey: true });
		expect(JSON.stringify(status)).not.toContain('sk');
		expect(JSON.stringify(status)).not.toContain('local');
	});

	test('refuses to run without a provider key', async () => {
		const { service } = make({ [localKeyName('acc')]: 'local' });
		expect(await service.run('tab1', params())).toEqual({ error: 'providerKey' });
	});

	test('refuses to run when the local API is off or the agent has no local key', async () => {
		const { service } = make();
		expect(await service.run('tab1', { ...params(), context: { ...ctx, apiAddr: '' } })).toEqual({ error: 'localApiOff' });

		const noKey = make({ [PROVIDER_KEY]: 'sk' });
		expect(await noKey.service.run('tab1', params())).toEqual({ error: 'localKey' });
	});

	test('reports a tool endpoint it cannot reach', async () => {
		const { service } = make();
		state.fail = 'connect ECONNREFUSED';

		const res = await service.run('tab1', params());
		expect(res.error).toContain('mcp:');
		expect(res.error).toContain('ECONNREFUSED');
	});

	test('streams a run to the tab that started it', async () => {
		const { service, sent } = make();
		state.faux.setResponses([ fauxAssistantMessage([ fauxText('Hello') ]) ]);

		expect(await service.run('tabA', params('hi'))).toEqual({});
		await waitEnd(sent, 'run-hi');

		const events = sent.filter(s => s.channel == 'agentEvent');
		expect(events.every(s => s.tabId == 'tabA')).toBe(true);
		expect(events.map(s => s.payload.type)).toContain('text');
	});

	test('keeps one session per chat and rebuilds it when the connection changes', async () => {
		const { service, sent } = make();
		state.faux.setResponses([ fauxAssistantMessage([ fauxText('one') ]), fauxAssistantMessage([ fauxText('two') ]), fauxAssistantMessage([ fauxText('three') ]) ]);

		await service.run('tab1', params('a'));
		await waitEnd(sent, 'run-a');
		await service.run('tab1', params('b'));
		await waitEnd(sent, 'run-b');
		expect(state.connects).toBe(1);

		// A different local API address means a new MCP connection
		await service.run('tab1', { ...params('c'), context: { ...ctx, apiAddr: '127.0.0.1:40000' } });
		await waitEnd(sent, 'run-c');
		expect(state.connects).toBe(2);
		expect(state.closes).toBe(1);
	});

	test('setProviderKey stores and clears the key', async () => {
		const { service, secrets } = make({});
		await service.setProviderKey('new');
		expect(secrets[PROVIDER_KEY]).toBe('new');
		await service.setProviderKey('');
		expect(secrets[PROVIDER_KEY]).toBeUndefined();
	});

	test('setConfig persists a patch', async () => {
		const { service } = make();
		const status = await service.setConfig({ confirm: false, model: 'claude-opus-5-5' });
		expect(status.config).toMatchObject({ confirm: false, model: 'claude-opus-5-5' });
	});
});
