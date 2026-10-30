import { createInterface } from 'node:readline';
import type { Backend, OperationInfo } from './backend.js';

/**
 * `loom mcp`: a Model Context Protocol server on stdio, so AI agents (Claude Code, Claude Desktop, Cursor, …)
 * can search, read, create, edit and delete everything in a Loom library. Every tool is one local-API
 * operation; Loom validates the input, so this file only speaks the protocol.
 *
 * Messages are newline-delimited JSON-RPC 2.0 on stdin/stdout. Nothing else may be written to stdout.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION = '0.1.0';

export const INSTRUCTIONS = `Loom is a local-first note-taking library: cards on infinite whiteboards, linked and tagged into databases.

Objects and their ids:
- Cards. Kinds: note, journal (one per day), task (status, priority, assignee, due, subtasks), link (saved web page), memo (quick capture), web (clipped page), highlight, and file kinds (pdf, image, video, audio, file). Bodies are markdown.
- Whiteboards hold objects: card placements, text, sections (titled areas that group what is inside), and shortcuts to sub-whiteboards; connections join two objects. Object ids differ from card ids.
- Tags group cards and work as databases: a tag can have typed properties (text, number, date, select, multiselect, checkbox, url) whose values live on each tagged card.
- Chats are earlier AI conversations.

How to work:
- Find things with searchAll (every type) or search (cards), then read with getObject, readCard, readWhiteboard or readTag. Lists: listCards, listTasks, listLinks, listTags, listWhiteboards, listChats, listTrash.
- Create with createCard (any text kind, with tags, task fields and properties; whiteboardId also places it), createTask, saveLink, addMemo, appendToJournal, createWhiteboard, addWhiteboardObject, createConnection, createMindMap, addTagProperty.
- Edit with updateCard (only the fields you pass change; markdown replaces the whole body, appendToCard adds to the end), setCardProperty, updateWhiteboard, updateWhiteboardObject, updateConnection, updateTag, renameTag, updateTagProperty.
- Delete with trashCard / trashWhiteboard (restorable), removeWhiteboardObjects, deleteConnection, deleteTag, removeTagProperty, deleteChat.
- Use the ids tools return; never invent them. Read a card before replacing its body so nothing is lost.`;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const title = (name: string): string => name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function toTool(o: OperationInfo): Tool {
  const { $schema: _schema, ...inputSchema } = o.input;
  return {
    name: o.name,
    title: title(o.name),
    description: o.description,
    inputSchema,
    annotations: {
      title: title(o.name),
      readOnlyHint: !o.write,
      destructiveHint: o.destructive,
      idempotentHint: !o.write || /^(update|set|remove|delete|trash|restore|rename)/.test(o.name),
      // Only saving a link reaches beyond the library (it fetches the page).
      openWorldHint: o.name === 'saveLink' || o.name === 'createCard',
    },
  };
}

export interface McpOptions {
  /** Offer only the operations that don't change anything. */
  readOnly?: boolean;
}

/** Handles one JSON-RPC message; returns the reply, or undefined for notifications. Exported for tests. */
export function createMcpHandler(backend: Backend, options: McpOptions = {}) {
  let tools: Map<string, OperationInfo> | undefined;
  const loadTools = async (): Promise<Map<string, OperationInfo>> => {
    if (!tools) {
      const ops = (await backend.operations()).filter((o) => !options.readOnly || !o.write);
      tools = new Map(ops.map((o) => [o.name, o]));
    }
    return tools;
  };

  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    initialize: async (params) => {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'loom', title: 'Loom', version: VERSION },
        instructions: INSTRUCTIONS + (options.readOnly ? '\n\nThis server is read-only: nothing can be created, changed or deleted.' : ''),
      };
    },
    ping: async () => ({}),
    'tools/list': async () => ({ tools: [...(await loadTools()).values()].map(toTool) }),
    'tools/call': async (params) => {
      const name = String(params.name ?? '');
      const known = await loadTools();
      if (!known.has(name)) throw new RpcError(-32602, `Unknown tool "${name}".`);
      try {
        const out = await backend.call(name, params.arguments ?? {});
        if (out.status >= 400) {
          const err = out.body as { error?: string; code?: string } | null;
          return { content: [{ type: 'text', text: `${err?.error ?? `Loom answered ${out.status}.`}${err?.code ? ` (${err.code})` : ''}` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(out.body ?? null, null, 2) }], isError: false };
      } catch (err) {
        // Loom unreachable and the like: the model should see it and can tell the user.
        return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
    // Not offered, but some clients ask anyway; empty lists are friendlier than errors.
    'resources/list': async () => ({ resources: [] }),
    'resources/templates/list': async () => ({ resourceTemplates: [] }),
    'prompts/list': async () => ({ prompts: [] }),
  };

  return async (msg: JsonRpcMessage): Promise<Record<string, unknown> | undefined> => {
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (typeof msg.method !== 'string') {
      // A response to something we never send, or garbage.
      return isRequest ? { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid request.' } } : undefined;
    }
    if (!isRequest) return undefined; // notifications/initialized, notifications/cancelled, …
    const handler = Object.hasOwn(handlers, msg.method) ? handlers[msg.method] : undefined;
    if (!handler) return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await handler(msg.params ?? {}) };
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32603;
      return { jsonrpc: '2.0', id: msg.id, error: { code, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

/** Serves MCP on stdin/stdout until stdin closes. */
export async function serveMcp(backend: Backend, options: McpOptions = {}): Promise<void> {
  const handle = createMcpHandler(backend, options);
  const write = (reply: unknown): void => void process.stdout.write(`${JSON.stringify(reply)}\n`);
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stderr.write(`loom mcp: serving ${backend.describe}${options.readOnly ? ' (read-only)' : ''}\n`);

  for await (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
      continue;
    }
    // Requests run concurrently (the API queues writes itself); replies go out as each finishes.
    const job = (async () => {
      if (Array.isArray(parsed)) {
        const replies = (await Promise.all(parsed.map((m) => handle(m as JsonRpcMessage)))).filter(Boolean);
        if (replies.length) write(replies);
      } else {
        const reply = await handle(parsed as JsonRpcMessage);
        if (reply) write(reply);
      }
    })();
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}
