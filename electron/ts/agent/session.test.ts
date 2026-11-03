import { describe, expect, test } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { AgentSession } from './session';
import { AGENT_DEFAULT_CONFIG, type AgentUiEvent } from './types';

const ctx = { spaceId: 's1', spaceName: 'Work', objectId: 'o1', objectName: 'Plan', objectType: 'Page', apiAddr: '127.0.0.1:1', accountId: 'a' };

const textTool = (name: string, calls: string[], text = 'ok') => ({
	name,
	label: name,
	description: name,
	parameters: { type: 'object', properties: { object: { type: 'string' } } },
	execute: async (_id: string, params: any) => {
		calls.push(`${name}:${JSON.stringify(params)}`);
		return { content: [ { type: 'text' as const, text } ], details: undefined };
	},
});

const setup = (confirm: boolean) => {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);

	const calls: string[] = [];
	const events: AgentUiEvent[] = [];
	const tools = [ textTool('find', calls, 'Q3 plan'), textTool('set_properties', calls) ];

	const session = new AgentSession({
		config: { ...AGENT_DEFAULT_CONFIG, confirm },
		resolved: { model: faux.getModel(), streamFn: models.streamSimple.bind(models), providerId: 'faux' },
		toolbox: { tools: tools as any, readOnly: new Map([ [ 'find', true ], [ 'set_properties', false ] ]), instructions: '' },
		appTools: [],
		getApiKey: () => 'k',
		emit: e => events.push(e),
	});

	return { faux, session, calls, events };
};

const run = (session: AgentSession, text = 'go') => session.run({ chatId: 'c', runId: 'r1', text, context: ctx });
const types = (events: AgentUiEvent[]) => events.map(e => e.type);

describe('AgentSession', () => {
	test('streams text and ends with the stop reason', async () => {
		const { faux, session, events } = setup(true);
		faux.setResponses([ fauxAssistantMessage([ fauxText('Hello there') ]) ]);

		await run(session);

		expect(types(events)[0]).toBe('start');
		expect(events.filter(e => e.type == 'text').map((e: any) => e.delta).join('')).toBe('Hello there');
		expect(events[events.length - 1]).toMatchObject({ type: 'end', stopReason: 'stop' });
	});

	test('a read-only tool runs without asking', async () => {
		const { faux, session, calls, events } = setup(true);
		faux.setResponses([
			fauxAssistantMessage([ fauxToolCall('find', { object: 'q3' }) ], { stopReason: 'toolUse' }),
			fauxAssistantMessage([ fauxText('Found it') ]),
		]);

		await run(session);

		expect(calls).toEqual([ 'find:{"object":"q3"}' ]);
		expect(types(events)).not.toContain('approval');
		expect(events.find(e => e.type == 'toolStart')).toMatchObject({ name: 'find', readOnly: true });
		expect(events.find(e => e.type == 'toolEnd')).toMatchObject({ isError: false, text: 'Q3 plan' });
	});

	test('a change waits for approval and runs once allowed', async () => {
		const { faux, session, calls, events } = setup(true);
		faux.setResponses([
			fauxAssistantMessage([ fauxToolCall('set_properties', { object: 'o1' }) ], { stopReason: 'toolUse' }),
			fauxAssistantMessage([ fauxText('Done') ]),
		]);

		const done = run(session);
		await waitFor(() => events.some(e => e.type == 'approval'));

		expect(calls).toEqual([]);
		const approval: any = events.find(e => e.type == 'approval');
		session.approve(approval.callId, true);
		await done;

		expect(calls).toEqual([ 'set_properties:{"object":"o1"}' ]);
		expect(events[events.length - 1]).toMatchObject({ type: 'end', stopReason: 'stop' });
	});

	test('a denied change is blocked and reported to the model as an error', async () => {
		const { faux, session, calls, events } = setup(true);
		faux.setResponses([
			fauxAssistantMessage([ fauxToolCall('set_properties', { object: 'o1' }) ], { stopReason: 'toolUse' }),
			fauxAssistantMessage([ fauxText('Okay, I left it alone') ]),
		]);

		const done = run(session);
		await waitFor(() => events.some(e => e.type == 'approval'));
		session.approve((events.find(e => e.type == 'approval') as any).callId, false);
		await done;

		expect(calls).toEqual([]);
		expect(events.find(e => e.type == 'toolEnd')).toMatchObject({ isError: true });
		expect((events.find(e => e.type == 'toolEnd') as any).text).toContain('declined');
	});

	test('with confirmation off a change runs straight away', async () => {
		const { faux, session, calls, events } = setup(false);
		faux.setResponses([
			fauxAssistantMessage([ fauxToolCall('set_properties', { object: 'o1' }) ], { stopReason: 'toolUse' }),
			fauxAssistantMessage([ fauxText('Done') ]),
		]);

		await run(session);

		expect(calls).toEqual([ 'set_properties:{"object":"o1"}' ]);
		expect(types(events)).not.toContain('approval');
	});

	test('stop while waiting for approval declines it and ends the run', async () => {
		const { faux, session, calls, events } = setup(true);
		faux.setResponses([
			fauxAssistantMessage([ fauxToolCall('set_properties', { object: 'o1' }) ], { stopReason: 'toolUse' }),
			fauxAssistantMessage([ fauxText('unused') ]),
		]);

		const done = run(session);
		await waitFor(() => events.some(e => e.type == 'approval'));
		session.stop();
		await done;

		expect(calls).toEqual([]);
		expect(events[events.length - 1].type).toBe('end');
	});
});

const waitFor = async (check: () => boolean, ms = 3000) => {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > ms) {
			throw new Error('timed out');
		};
		await new Promise(r => setTimeout(r, 5));
	};
};
