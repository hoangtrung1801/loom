import { describe, expect, test } from 'vitest';
import { AppToolBridge, createAppTools } from './appTools';

const setup = (timeoutMs?: number) => {
	const sent: any[] = [];
	const bridge = new AppToolBridge({ send: (tabId, payload) => sent.push({ tabId, ...payload }), timeoutMs });
	return { bridge, sent };
};

describe('AppToolBridge', () => {
	test('sends the request to the tab and resolves with its answer', async () => {
		const { bridge, sent } = setup();
		const pending = bridge.call('tab1', 'get_context', {});

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ tabId: 'tab1', name: 'get_context' });

		bridge.resolve(sent[0].id, { space: 'Work' });
		await expect(pending).resolves.toEqual({ space: 'Work' });
	});

	test('rejects when the app does not answer in time', async () => {
		const { bridge } = setup(20);
		await expect(bridge.call('tab1', 'open_object', {})).rejects.toThrow('did not answer');
	});

	test('rejects when the run is aborted', async () => {
		const { bridge } = setup();
		const controller = new AbortController();
		const pending = bridge.call('tab1', 'get_context', {}, controller.signal);

		controller.abort();
		await expect(pending).rejects.toThrow('aborted');
	});

	test('ignores an answer for an unknown request', () => {
		const { bridge } = setup();
		expect(() => bridge.resolve('nope', {})).not.toThrow();
	});
});

describe('createAppTools', () => {
	test('defines get_context and open_object under the loom_ prefix, both without required args except the object', () => {
		const { bridge } = setup();
		const tools = createAppTools(bridge, () => 'tab1');

		expect(tools.map(t => t.name)).toEqual([ 'loom_get_context', 'loom_open_object' ]);
		expect((tools[1].parameters as any).required).toEqual([ 'object' ]);
	});

	test('a tool call goes to the tab that owns the run and returns the app answer as text', async () => {
		const { bridge, sent } = setup();
		const tools = createAppTools(bridge, () => 'tab7');

		const pending = tools[1].execute('c1', { object: 'obj1' });
		expect(sent[0]).toMatchObject({ tabId: 'tab7', name: 'open_object', args: { object: 'obj1' } });

		bridge.resolve(sent[0].id, { opened: 'Plan' });
		const out = await pending;
		expect(out.content).toEqual([ { type: 'text', text: '{"opened":"Plan"}' } ]);
	});
});
