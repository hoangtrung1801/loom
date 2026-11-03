import { describe, expect, test } from 'vitest';
import { McpToolbox } from './mcp';

/** A stand-in for POST /mcp/{tier}: JSON-RPC in, one JSON response out, session id header. */
const fakeServer = () => {
	const log: { method: string; auth: string | null; session: string | null; url: string }[] = [];
	let sessions = 0;
	let live = '';

	const json = (body: any, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

	const fetchFn = (async (input: any, init: any = {}) => {
		const headers = new Headers(init.headers);
		const method = String(init.method || 'GET');

		if (method != 'POST') {
			return new Response('no stream', { status: 405 });
		};

		const msg = JSON.parse(init.body);
		const session = headers.get('Mcp-Session-Id');
		log.push({ method: msg.method, auth: headers.get('Authorization'), session, url: String(input) });

		if (msg.method == 'initialize') {
			live = `s${++sessions}`;
			return json({
				jsonrpc: '2.0', id: msg.id,
				result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'loom', version: '1' }, instructions: 'Use handles.' },
			}, { 'Mcp-Session-Id': live });
		};
		if (session !== live) {
			return new Response(JSON.stringify({ error: 'unknown or expired MCP session' }), { status: 404 });
		};
		if (msg.method == 'notifications/initialized') {
			return new Response(null, { status: 202 });
		};
		if (msg.method == 'tools/list') {
			return json({ jsonrpc: '2.0', id: msg.id, result: { tools: [
				{ name: 'find', description: 'search', inputSchema: { type: 'object', properties: { space: { type: 'string' } } }, annotations: { readOnlyHint: true } },
				{ name: 'create', description: 'create', inputSchema: { type: 'object' } },
			] } });
		};
		if (msg.method == 'tools/call') {
			if (msg.params.name == 'create') {
				return json({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [ { type: 'text', text: 'unknown type "Taks" — did you mean Task?' } ] } });
			};
			return json({ jsonrpc: '2.0', id: msg.id, result: { content: [ { type: 'text', text: `found in ${msg.params.arguments.space}` } ] } });
		};
		return json({ jsonrpc: '2.0', id: msg.id, result: {} });
	}) as typeof fetch;

	return { fetchFn, log, expire: () => { live = ''; } };
};

const connect = async () => {
	const server = fakeServer();
	const box = new McpToolbox({ addr: '127.0.0.1:31009', tier: 'large', key: 'secret', fetch: server.fetchFn });
	await box.connect();
	return { server, box };
};

describe('McpToolbox', () => {
	test('lists the server tools with their read-only hints and instructions', async () => {
		const { box } = await connect();

		expect(box.tools.map(t => t.name)).toEqual([ 'find', 'create' ]);
		expect(box.readOnly.get('find')).toBe(true);
		expect(box.readOnly.get('create')).toBe(false);
		expect(box.instructions).toBe('Use handles.');
		expect((box.tools[1].parameters as any).properties).toEqual({});
	});

	test('talks to /mcp/{tier} with the bearer key and keeps the session id', async () => {
		const { box, server } = await connect();
		await box.tools[0].execute('1', { space: 'Work' });

		expect(server.log.every(r => r.url == 'http://127.0.0.1:31009/mcp/large')).toBe(true);
		expect(server.log.every(r => r.auth == 'Bearer secret')).toBe(true);
		expect(server.log.find(r => r.method == 'tools/call').session).toBe('s1');
	});

	test('returns tool text to the model', async () => {
		const { box } = await connect();
		const out = await box.tools[0].execute('1', { space: 'Work' });
		expect(out.content).toEqual([ { type: 'text', text: 'found in Work' } ]);
	});

	test('a tool failure throws with the repair hint so the model can fix the call', async () => {
		const { box } = await connect();
		await expect(box.tools[1].execute('1', {})).rejects.toThrow('did you mean Task?');
	});

	test('reconnects once when the server forgot the session', async () => {
		const { box, server } = await connect();
		server.expire();

		const out = await box.tools[0].execute('1', { space: 'Work' });

		expect(out.content).toEqual([ { type: 'text', text: 'found in Work' } ]);
		expect(server.log.filter(r => r.method == 'initialize')).toHaveLength(2);
	});
});
