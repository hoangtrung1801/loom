import { afterEach, describe, expect, it } from 'vitest';
import type { Backend } from '../src/cli/backend.js';
import { createMcpHandler } from '../src/cli/mcp.js';
import { createLocalApi, describeOperations } from '../src/core/local-api.js';
import { buildApp } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';

const open: Store[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

function api() {
  const store = new Store(':memory:');
  open.push(store);
  const call = createLocalApi(buildApp(store, { filesDir: null }));
  /** Runs an operation that must succeed and returns its body. */
  const ok = async <T = any>(name: string, input: unknown = {}): Promise<T> => {
    const out = await call(name, input);
    if (out.status !== 200) throw new Error(`${name} → ${out.status} ${JSON.stringify(out.body)}`);
    return out.body as T;
  };
  return { store, call, ok };
}

describe('local API: every object type', () => {
  it('creates cards of each text kind, edits them, and finds them', async () => {
    const { ok } = api();
    const note = await ok('createCard', { kind: 'note', title: 'Ownership', markdown: 'Borrowing rules', tags: ['rust'] });
    const task = await ok('createCard', { kind: 'task', title: 'Write the guide', priority: 'high', due: '2026-11-05', tags: ['docs'] });
    const memo = await ok('createCard', { kind: 'memo', markdown: 'remember the borrow checker' });
    const day = await ok('createCard', { kind: 'journal', date: '2026-10-01', markdown: 'Started learning' });
    expect(day.id).toBe('journal-2026-10-01');

    await ok('updateCard', { id: note.id, title: 'Ownership model', markdown: '# Rules\n\nOne owner', addTags: ['systems'], removeTags: ['rust'] });
    const read = await ok('readCard', { id: note.id });
    expect(read).toMatchObject({ title: 'Ownership model', tags: ['systems'] });
    expect(read.markdown).toContain('One owner');
    expect(read.markdown).not.toContain('Borrowing');

    await ok('updateCard', { id: task.id, status: 'done', assignee: 'me' });
    expect(await ok('readTask', { id: task.id })).toMatchObject({ status: 'done', assignee: 'me', priority: 'high' });

    await ok('updateCard', { id: memo.id, kind: 'task', status: 'in-progress' });
    expect(await ok('readCard', { id: memo.id })).toMatchObject({ kind: 'task', status: 'in-progress', title: 'remember the borrow checker' });

    const hits = await ok<{ type: string; id: string }[]>('searchAll', { query: 'owner' });
    expect(hits).toContainEqual(expect.objectContaining({ type: 'card', id: note.id }));
    expect(await ok('getObject', { id: note.id })).toMatchObject({ type: 'card', title: 'Ownership model' });
  });

  it('refuses fields that do not belong to a kind, and kinds it cannot make from text', async () => {
    const { ok, call } = api();
    const note = await ok('createCard', { title: 'Plain' });
    expect(await call('updateCard', { id: note.id, status: 'done' })).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
    expect(await call('createCard', { kind: 'pdf', title: 'x' })).toMatchObject({ status: 400 });
    expect(await call('updateCard', { id: 'missing', title: 'x' })).toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('treats tags as databases: properties, typed values, rename and delete', async () => {
    const { ok, call } = api();
    const card = await ok('createCard', { title: 'The Rust Book' });
    await ok('addTagProperty', { tag: 'book', name: 'Rating', type: 'number' });
    await ok('addTagProperty', { tag: 'book', name: 'Topics', type: 'multiselect', options: ['lang', 'systems'] });
    await ok('addTagProperty', { tag: 'book', name: 'Read', type: 'checkbox' });
    await ok('updateCard', { id: card.id, properties: { book: { rating: 5, Topics: ['lang'], Read: true } } });
    await ok('setCardProperty', { id: card.id, tag: 'book', property: 'Topics', value: 'systems' });

    const table = await ok('readTag', { tag: 'book' });
    expect(table.properties.map((p: { name: string }) => p.name)).toEqual(['Rating', 'Topics', 'Read']);
    expect(table.cards).toEqual([expect.objectContaining({ id: card.id, values: { Rating: 5, Topics: ['systems'], Read: true } })]);
    expect((await ok('readCard', { id: card.id })).properties).toEqual({ book: { Rating: 5, Topics: ['systems'], Read: true } });

    expect(await call('setCardProperty', { id: card.id, tag: 'book', property: 'Topics', value: ['cooking'] })).toMatchObject({ status: 422 });
    expect(await call('setCardProperty', { id: card.id, tag: 'book', property: 'Pages', value: 3 })).toMatchObject({ status: 404 });

    await ok('updateTagProperty', { tag: 'book', property: 'Rating', name: 'Score' });
    await ok('renameTag', { from: 'book', to: 'books' });
    expect((await ok('readTag', { tag: 'books' })).cards[0].values).toMatchObject({ Score: 5 });
    await ok('removeTagProperty', { tag: 'books', property: 'Read' });
    expect((await ok('readTag', { tag: 'books' })).properties).toHaveLength(2);
    await ok('deleteTag', { tag: 'books' });
    expect((await ok('readCard', { id: card.id })).tags).toEqual([]);
  });

  it('builds and edits whiteboards: objects, sections, connections, mind maps', async () => {
    const { ok, call } = api();
    const board = await ok('createWhiteboard', { name: 'Plan' });
    const card = await ok('createCard', { title: 'Idea', whiteboardId: board.id });
    const section = await ok('addWhiteboardObject', { whiteboardId: board.id, kind: 'section', text: 'Now', x: 0, y: 0 });
    const text = await ok('addWhiteboardObject', { whiteboardId: board.id, kind: 'text', text: 'Note to self', x: 600, y: 0 });
    const sub = await ok('addWhiteboardObject', { whiteboardId: board.id, kind: 'board', text: 'Details' });
    const placed = (await ok('readWhiteboard', { id: board.id })).objects.find((o: { cardId?: string }) => o.cardId === card.id);
    await ok('updateWhiteboardObject', { id: placed.id, x: 40, y: 40, sectionId: section.id });
    await ok('updateWhiteboardObject', { id: text.id, text: 'Edited', color: 'blue' });
    const edge = await ok('createConnection', { whiteboardId: board.id, from: placed.id, to: text.id, label: 'see' });
    await ok('updateConnection', { id: edge.id, style: 'dashed' });
    await ok('createMindMap', { whiteboardId: board.id, tree: { text: 'Root', children: [{ text: 'A' }, { text: 'B', children: [{ text: 'B1' }] }] } });
    await ok('updateWhiteboard', { id: board.id, name: 'Plan v2', color: 'green' });

    const view = await ok('readWhiteboard', { id: board.id });
    expect(view).toMatchObject({ name: 'Plan v2', color: 'green' });
    expect(view.objects.find((o: { id: string }) => o.id === placed.id)).toMatchObject({ x: 40, y: 40, sectionId: section.id });
    expect(view.objects.find((o: { id: string }) => o.id === text.id)).toMatchObject({ text: 'Edited', color: 'blue' });
    expect(view.objects.filter((o: { kind: string }) => o.kind === 'text').length).toBe(5);
    expect(view.connections.find((c: { id: string }) => c.id === edge.id)).toMatchObject({ label: 'see', style: 'dashed' });
    const subId = view.objects.find((o: { id: string }) => o.id === sub.id).whiteboardRef;
    expect((await ok('getObject', { id: subId })).type).toBe('whiteboard');
    expect(await ok('getObject', { id: edge.id })).toMatchObject({ type: 'connection', whiteboardId: board.id });
    expect(await ok('getObject', { id: text.id })).toMatchObject({ type: 'object', kind: 'text' });

    expect(await call('updateWhiteboardObject', { id: text.id, sectionId: text.id })).toMatchObject({ status: 400 });
    await ok('deleteConnection', { id: edge.id });
    await ok('removeWhiteboardObjects', { ids: [text.id] });
    expect((await ok('readWhiteboard', { id: board.id })).connections).toHaveLength(Math.max(0, view.connections.length - 1));
    expect(await call('getObject', { id: text.id })).toMatchObject({ status: 404 });

    await ok('trashWhiteboard', { id: board.id });
    expect((await ok('listTrash')).whiteboards.map((w: { id: string }) => w.id)).toContain(board.id);
    await ok('restoreWhiteboard', { id: board.id });
    expect((await ok('getObject', { id: board.id })).type).toBe('whiteboard');
  });

  it('trashes and restores cards, and reads chats and tags through getObject', async () => {
    const { ok, call, store } = api();
    const card = await ok('createCard', { title: 'Temporary', tags: ['scratch'] });
    await ok('trashCard', { id: card.id });
    expect(await call('readCard', { id: card.id })).toMatchObject({ status: 404 });
    await ok('restoreCard', { id: card.id });
    expect((await ok('getObject', { id: card.id })).title).toBe('Temporary');
    expect(await ok('getObject', { id: '#scratch' })).toMatchObject({ type: 'tag', tag: 'scratch' });

    const chatId = buildApp(store, { filesDir: null }).chats.createChat({ title: 'Ask' });
    await ok('renameChat', { id: chatId, title: 'Asked' });
    expect(await ok('getObject', { id: chatId })).toMatchObject({ type: 'chat', title: 'Asked' });
    await ok('deleteChat', { id: chatId });
    expect(await ok('listChats')).toEqual([]);
  });

  it('describes every operation with a JSON schema and flags destructive ones', () => {
    const ops = describeOperations();
    expect(ops.every((o) => (o.input as { type?: string }).type === 'object')).toBe(true);
    expect(ops.filter((o) => o.destructive).every((o) => o.write)).toBe(true);
    expect(ops.find((o) => o.name === 'trashCard')?.destructive).toBe(true);
    expect(ops.find((o) => o.name === 'searchAll')?.write).toBe(false);
  });
});

describe('MCP server', () => {
  function mcp(options: { readOnly?: boolean } = {}) {
    const { call } = api();
    const backend: Backend = { describe: 'test', call, operations: async () => describeOperations(), health: async () => ({ ok: true }), close: async () => undefined };
    let next = 1;
    const handle = createMcpHandler(backend, options);
    const request = async (method: string, params?: unknown): Promise<any> => handle({ jsonrpc: '2.0', id: next++, method, params: params as Record<string, unknown> });
    const tool = async (name: string, args: unknown): Promise<any> => {
      const reply = await request('tools/call', { name, arguments: args });
      return { ...reply.result, json: reply.result.isError ? undefined : JSON.parse(reply.result.content[0].text) };
    };
    return { handle, request, tool };
  }

  it('initializes, lists tools with annotations, and runs them', async () => {
    const { handle, request, tool } = mcp();
    const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'loom' } });
    expect(init.result.instructions).toContain('searchAll');
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();

    const { tools } = (await request('tools/list')).result;
    expect(tools.length).toBe(describeOperations().length);
    expect(tools.every((t: { inputSchema: { type: string; $schema?: string } }) => t.inputSchema.type === 'object' && !t.inputSchema.$schema)).toBe(true);
    expect(tools.find((t: { name: string }) => t.name === 'trashCard').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find((t: { name: string }) => t.name === 'readCard').annotations).toMatchObject({ readOnlyHint: true });

    const made = await tool('createCard', { kind: 'task', title: 'From an agent', tags: ['agent'] });
    expect(made.isError).toBe(false);
    const found = await tool('searchAll', { query: 'agent' });
    expect(found.json).toContainEqual(expect.objectContaining({ id: made.json.id }));
  });

  it('reports refusals as tool errors and protocol mistakes as JSON-RPC errors', async () => {
    const { request, tool } = mcp();
    const bad = await tool('readCard', { id: 'missing' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('not_found');
    expect((await request('tools/call', { name: 'dropEverything', arguments: {} })).error.code).toBe(-32602);
    expect((await request('nope')).error.code).toBe(-32601);
    expect((await request('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-11-25');
  });

  it('offers only reading tools when read-only', async () => {
    const { request, tool } = mcp({ readOnly: true });
    const { tools } = (await request('tools/list')).result;
    expect(tools.length).toBeGreaterThan(5);
    expect(tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    expect((await request('tools/call', { name: 'createCard', arguments: { title: 'x' } })).error).toBeDefined();
    expect((await tool('listCards', {})).isError).toBe(false);
  });
});
