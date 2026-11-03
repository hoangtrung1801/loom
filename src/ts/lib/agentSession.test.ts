import { describe, expect, test } from 'vitest';
import { parseMessages, serializeMessages, sessionTitle } from './agentSession';

let n = 0;
const nextId = () => `m${++n}`;

const tool = (patch: any = {}) => ({
	type: 'tool' as const, callId: 'c1', name: 'find', label: 'Find', args: { q: 'x' }, readOnly: true, status: 'done' as const, result: 'ok', ...patch,
});

describe('sessionTitle', () => {
	test('is the first user message on one line', () => {
		const title = sessionTitle([
			{ id: '1', role: 'assistant', parts: [ { type: 'text', text: 'hello' } ] },
			{ id: '2', role: 'user', parts: [ { type: 'text', text: '  Plan\n the   week ' } ] },
		]);
		expect(title).toBe('Plan the week');
	});

	test('is cut to 60 characters and empty without a user message', () => {
		expect(sessionTitle([ { id: '1', role: 'user', parts: [ { type: 'text', text: 'a'.repeat(100) } ] } ])).toBe(`${'a'.repeat(60)}…`);
		expect(sessionTitle([])).toBe('');
	});
});

describe('serializeMessages / parseMessages', () => {
	test('round-trips text, tool calls and mentions', () => {
		const json = serializeMessages([
			{ id: '1', role: 'user', parts: [ { type: 'text', text: 'read Plan' } ], mentions: [ { id: 'o1', name: 'Plan', from: 5, to: 9 } ] },
			{ id: '2', role: 'assistant', parts: [ tool(), { type: 'text', text: 'done' } ] },
		]);
		const out = parseMessages(json, nextId);

		expect(out.map(it => it.role)).toEqual([ 'user', 'assistant' ]);
		expect(out[0].mentions).toEqual([ { id: 'o1', name: 'Plan', from: 5, to: 9 } ]);
		expect(out[1].parts[0]).toMatchObject({ type: 'tool', callId: 'c1', status: 'done', args: { q: 'x' }, result: 'ok' });
		expect(out[1].parts[1]).toEqual({ type: 'text', text: 'done' });
	});

	test('cuts long tool results and arguments', () => {
		const json = serializeMessages([ { id: '1', role: 'assistant', parts: [ tool({ args: { body: 'x'.repeat(5000) }, result: 'y'.repeat(5000) }) ] } ]);
		const part: any = parseMessages(json, nextId)[0].parts[0];

		expect(part.result.length).toBe(2001);
		expect(typeof part.args.truncated).toBe('string');
	});

	test('keeps only the latest 200 messages', () => {
		const many = Array.from({ length: 250 }, (_, i) => ({ id: String(i), role: 'user' as const, parts: [ { type: 'text' as const, text: `m${i}` } ] }));
		const out = parseMessages(serializeMessages(many), nextId);

		expect(out.length).toBe(200);
		expect((out[0].parts[0] as any).text).toBe('m50');
	});

	test('a tool that was running or awaiting approval comes back as failed', () => {
		const json = serializeMessages([ { id: '1', role: 'assistant', parts: [ tool({ status: 'running' }), tool({ callId: 'c2', status: 'approval' }) ] } ]);
		expect(parseMessages(json, nextId)[0].parts.map((it: any) => it.status)).toEqual([ 'error', 'error' ]);
	});

	test('drops malformed input instead of throwing', () => {
		expect(parseMessages('not json', nextId)).toEqual([]);
		expect(parseMessages('', nextId)).toEqual([]);
		expect(parseMessages(JSON.stringify({ messages: [ { role: 'system', parts: [] }, { role: 'user', parts: [ { type: 'text' } ] }, null ] }), nextId)).toEqual([]);
	});
});
