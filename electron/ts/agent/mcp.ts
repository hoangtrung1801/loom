import type { AgentTool } from '@earendil-works/pi-agent-core';
import { McpClient, McpSessionExpiredError, StreamableHttpTransport, toLlmContent } from '@earendil-works/pi-mcp';
import type { AgentTier } from './types';

export interface McpToolboxOptions {
	/** Local API host:port, e.g. 127.0.0.1:31009. */
	addr: string;
	tier: Exclude<AgentTier, 'auto'>;
	/** The agent's own local API key. The endpoint authenticates and grant-gates every call with it. */
	key: string;
	fetch?: typeof fetch;
};

/**
 * Loom's own MCP endpoint (POST /mcp/{tier} on the local API) as pi agent tools. Nothing is
 * defined here: the tool names, schemas and read-only hints all come from the server's tools/list.
 */
export class McpToolbox {

	tools: AgentTool<any>[] = [];
	readOnly: Map<string, boolean> = new Map();
	instructions = '';
	private client: McpClient | null = null;

	constructor (private options: McpToolboxOptions) {};

	static endpoint (addr: string, tier: string): string {
		return `http://${addr}/mcp/${tier}`;
	};

	async connect (): Promise<void> {
		await this.close();

		const { addr, tier, key } = this.options;
		const client = new McpClient({ name: 'loom-agent', version: '1.0.0', requestTimeoutMs: 60000 });
		const transport = new StreamableHttpTransport({
			url: McpToolbox.endpoint(addr, tier),
			headers: { Authorization: `Bearer ${key}` },
			// The endpoint pushes nothing, so there is no server-to-client stream to open
			openGetStream: false,
			fetch: this.options.fetch,
		});

		await client.connect(transport);
		this.client = client;
		this.instructions = client.instructions || '';

		const list = await client.listTools();

		this.readOnly = new Map(list.map(it => [ it.name, it.annotations?.readOnlyHint === true ]));
		this.tools = list.map(it => ({
			name: it.name,
			label: it.title || it.name,
			description: it.description || it.name,
			parameters: { ...it.inputSchema, type: 'object', properties: it.inputSchema?.properties ?? {} },
			execute: async (_id: string, params: any, signal?: AbortSignal) => {
				const result = await this.call(it.name, params, signal);
				const content = toLlmContent(result);

				if (result.isError) {
					// pi reports a thrown error to the model as a tool error, repair hint included
					throw new Error(content.map((c: any) => c.text || '').join('\n') || 'tool failed');
				};
				return { content, details: undefined };
			},
		}));
	};

	/** One retry after the server dropped the session (idle expiry, restart): handles are lost, the call is not. */
	private async call (name: string, args: Record<string, unknown>, signal?: AbortSignal) {
		try {
			return await this.client.callTool(name, args, { signal });
		} catch (e) {
			if (!(e instanceof McpSessionExpiredError)) {
				throw e;
			};
			await this.connect();
			return await this.client.callTool(name, args, { signal });
		};
	};

	async close (): Promise<void> {
		const client = this.client;

		this.client = null;
		if (client) {
			try { await client.close(); } catch (e) {};
		};
	};

};
