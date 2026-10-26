import { afterEach, describe, expect, it } from 'vitest';
import { Chats } from '../src/core/chats.js';
import { Ai } from '../src/core/ai/service.js';
import { loadCardText, readCard, readWithinBudget, resolveCitations } from '../src/core/ai/context.js';
import { Handles } from '../src/core/ai/handles.js';
import { serializeBoard } from '../src/core/ai/whiteboardText.js';
import { estimateTokens } from '../src/core/ai/tokens.js';
import { markdownToContent } from '../src/core/markdown.js';
import { buildApp, createRpc } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';
import { mockLlm, type MockCall, type MockReply } from './mock-llm.js';

const open: Store[] = [];
const closers: (() => Promise<void>)[] = [];
const mem = (): Store => {
  const s = new Store(':memory:');
  open.push(s);
  return s;
};
afterEach(async () => {
  open.splice(0).forEach((s) => s.close());
  await Promise.all(closers.splice(0).map((c) => c()));
});

const note = (s: Store, title: string, md: string): string => s.createCard({ title, content: markdownToContent(md) });

async function setup(script: (call: MockCall, n: number) => MockReply, provider: 'anthropic' | 'openai' = 'anthropic') {
  const store = mem();
  const llm = await mockLlm(script);
  closers.push(llm.close);
  const chats = new Chats(store);
  const events: any[] = [];
  const ai = new Ai(store, chats, (_c, p) => events.push(p));
  ai.setAiConfig({ provider, model: 'm', baseUrl: provider === 'openai' ? `${llm.url}/v1` : llm.url, apiKey: 'sk-secret' });
  return { store, chats, ai, llm, events };
}

describe('context engine', () => {
  it('numbers lines and resolves citations to the exact block', () => {
    const s = mem();
    const id = note(s, 'Memory', '# Spacing\n\nReview after one day.\n\n- first\n- second');
    const handles = new Handles();
    const card = loadCardText(s, handles, id)!;
    expect(card.handle).toBe('c1');
    const read = readCard(card);
    expect(read.text).toContain('  1| # Spacing');
    const { text, sources } = resolveCitations('Review daily [c1:3]. Also lists [c1:5-6] and [c9:1] and again [c1:3].', new Map([[id, card]]), handles);
    expect(text).toBe('Review daily [1]. Also lists [2] and  and again [1].');
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ cardId: id, startLine: 3, quote: 'Review after one day.' });
    expect(sources[0]!.blockId).toBeTruthy();
    expect(sources[1]!.endLine).toBe(6);
  });

  it('paginates and reads by block id', () => {
    const s = mem();
    const md = Array.from({ length: 200 }, (_, i) => `Line number ${i + 1} has some words in it.`).join('\n\n');
    const card = loadCardText(s, new Handles(), note(s, 'Long', md))!;
    const page = readCard(card, { offset: 11, limit: 5 });
    expect(page.from).toBe(11);
    expect(page.to).toBe(15);
    const capped = readCard(card, { tokenBudget: 300 });
    expect(capped.to).toBeLessThan(card.lines.length);
    expect(capped.text).toContain('Use offset and limit');
    const blockId = card.blocks[3]!.blockId;
    expect(readCard(card, { blockIds: [blockId, 'nope'] }).missing).toEqual(['nope']);
  });

  it('spends the budget in three phases and reports partial/omitted', () => {
    const s = mem();
    const handles = new Handles();
    const cards = Array.from({ length: 30 }, (_, i) =>
      loadCardText(s, handles, note(s, `Card ${i}`, Array.from({ length: 80 }, (_, j) => `Paragraph ${j} of card ${i} with enough words to cost tokens.`).join('\n\n')))!,
    );
    const result = readWithinBudget(cards, 3000);
    expect(estimateTokens(result.text)).toBeLessThan(3000 * 1.15);
    expect(result.shown.length).toBeGreaterThan(5);
    expect(result.shown.every((x) => x.to >= 1)).toBe(true);
    expect(result.text).toMatch(/\(\d+ partial, \d+ omitted/);
    expect(result.omitted.length + result.shown.length).toBe(30);

    const small = cards.slice(0, 2);
    const all = readWithinBudget(small, 25_000);
    expect(all.shown.every((x) => x.complete)).toBe(true);
    expect(all.text).not.toContain('omitted');
  });

  it('serializes a whiteboard as a tree with sections, mind maps and connections', () => {
    const s = mem();
    const board = s.createWhiteboard('Research');
    const a = s.addCardToWhiteboard(board, note(s, 'Alpha', 'a'), 0, 0);
    const b = s.addCardToWhiteboard(board, note(s, 'Beta', 'b'), 400, 0);
    const section = s.addObject(board, { kind: 'section', x: -20, y: -20, text: 'Ideas' });
    s.updatePlacements([{ id: a, sectionId: section }]);
    const root = s.addObject(board, { kind: 'text', x: 0, y: 500, text: 'Topic' });
    s.addObject(board, { kind: 'text', x: 300, y: 500, text: 'Sub', parentId: root });
    const edge = s.createEdge(board, a, b);
    s.updateEdge(edge, { style: 'dashed', color: 'red', label: 'because' });
    const handles = new Handles();
    const text = serializeBoard(s, handles, board)!;
    expect(text).toContain('cards: 2 (note 2); other objects: 3 (section 1, text 2)');
    expect(text).toMatch(/section "Ideas" p\d+ \(1 objects\)\n  - card "Alpha"/);
    expect(text).toMatch(/text "Topic"[^\n]*\n {4}- text "Sub"/);
    expect(text).toMatch(/Connections:\n {2}p\d+ -> p\d+ \(red, dashed\) "because"/);
    const layout = serializeBoard(s, handles, board, { mode: 'layout', viewport: { x: -100, y: -100, w: 800, h: 300 } })!;
    expect(layout).toContain('in viewport: 3, peripheral: 2');
    expect(layout).toContain('Peripheral clusters');
    expect(serializeBoard(s, handles, 'missing')).toBeNull();
  });

  it('shrinks very large boards structurally', () => {
    const s = mem();
    const board = s.createWhiteboard('Big');
    for (let i = 0; i < 400; i++) s.addObject(board, { kind: 'text', x: i * 10, y: 0, text: `Note number ${i} ${'word '.repeat(20)}` });
    const text = serializeBoard(s, new Handles(), board, { tokenBudget: 1500 })!;
    expect(text).toContain('(Output truncated)');
    expect(text).toContain('more');
  });
});

describe('agent', () => {
  for (const provider of ['anthropic', 'openai'] as const) {
    it(`pulls notes with tools and cites them (${provider})`, async () => {
      const { store, ai, chats, llm, events } = await setup((call, n) => {
        if (n === 0) return { text: 'Let me look. ', tools: [{ name: 'search_notes', args: { query: 'spacing' } }] };
        if (n === 1) {
          const result = JSON.stringify(call.body.messages);
          expect(result).toContain('Spacing');
          return { tools: [{ name: 'read_card', args: { card: 'c1' } }] };
        }
        return { text: 'Review after one day [c1:3].' };
      }, provider);
      const id = note(store, 'Spacing', '# Spacing\n\nReview after one day.');
      note(store, 'Other', 'Nothing about it');
      const { chatId } = ai.sendChat({ text: 'What did I write about spacing?' });
      await ai.whenIdle(chatId);
      const chat = chats.getChat(chatId)!;
      expect(chat.messages.map((m) => m.role)).toEqual(['user', 'tool', 'tool', 'assistant']);
      expect(chat.messages[1]!.content).toBe('Searched notes for “spacing”');
      const answer = chat.messages[3]!;
      expect(answer.content).toBe('Let me look.\n\nReview after one day [1].');
      expect(answer.sources[0]).toMatchObject({ n: 1, cardId: id, quote: 'Review after one day.' });
      expect(chat.title).toBe('What did I write about spacing?');
      expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toContain('Review after one day');
      expect(events.at(-1)).toMatchObject({ type: 'done', messageId: answer.id });
      // The key goes in the right header and never into the prompt.
      const first = llm.calls[0]!;
      expect(provider === 'anthropic' ? first.headers['x-api-key'] : first.headers.authorization).toContain('sk-secret');
      expect(JSON.stringify(first.body)).not.toContain('sk-secret');
    });
  }

  it('attaches context with a budget and sends prior turns as history', async () => {
    const { store, ai, chats, llm } = await setup((_c, n) => ({ text: `answer ${n}` }));
    const a = note(store, 'Alpha', 'Alpha facts here');
    const chatId = chats.createChat({ context: [{ type: 'card', id: a }] });
    ai.sendChat({ chatId, text: 'first' });
    await ai.whenIdle(chatId);
    ai.sendChat({ chatId, text: 'second' });
    await ai.whenIdle(chatId);
    const firstBody = JSON.stringify(llm.calls[0]!.body.messages);
    expect(firstBody).toContain('<attached_context>');
    expect(firstBody).toContain('Alpha facts here');
    expect(llm.calls[1]!.body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('refuses editing tools unless allowed, and applies them when allowed', async () => {
    const script = (_c: MockCall, n: number): MockReply =>
      n === 0 ? { tools: [{ name: 'create_card', args: { title: 'From AI', markdown: '# Hi\n\n- one', tags: ['ai'] } }] } : { text: 'ok' };
    const denied = await setup(script);
    const d = denied.ai.sendChat({ text: 'make a card' });
    await denied.ai.whenIdle(d.chatId);
    expect(denied.store.listCards({}).length).toBe(0);
    expect(JSON.stringify(denied.llm.calls[1]!.body)).toContain('Editing is disabled');
    expect(denied.llm.calls[0]!.body.tools.map((t: any) => t.name)).not.toContain('create_card');

    const allowed = await setup(script);
    const a = allowed.ai.sendChat({ text: 'make a card', allowWrites: true });
    await allowed.ai.whenIdle(a.chatId);
    const [created] = allowed.store.listCards({});
    expect(created).toMatchObject({ title: 'From AI', tags: ['ai'] });
    expect(allowed.events.at(-1).changes).toEqual(['Created card “From AI”']);
  });

  it('builds a section of cards and a mind map through tools', async () => {
    const { store, ai } = await setup((call, n) => {
      if (n === 0) return { tools: [{ name: 'create_whiteboard', args: { name: 'AI board' } }, { name: 'search_notes', args: { query: 'topic' } }] };
      if (n === 1) {
        const results = call.body.messages.at(-1).content.map((c: any) => c.content).join('\n');
        const board = results.match(/Created (w\d+)/)![1];
        return {
          tools: [
            { name: 'place_cards', args: { whiteboard: board, cards: ['c1', 'c2'], section: 'Found' } },
            { name: 'create_mind_map', args: { whiteboard: board, tree: { text: 'Root', children: [{ text: 'A', children: [{ text: 'A1' }] }, { text: 'B' }] } } },
          ],
        };
      }
      return { text: 'done' };
    });
    note(store, 'Topic one', 'topic');
    note(store, 'Topic two', 'topic');
    const { chatId } = ai.sendChat({ text: 'organize', allowWrites: true });
    await ai.whenIdle(chatId);
    const board = store.listWhiteboards().find((b) => b.name === 'AI board')!;
    const data = store.getWhiteboard(board.id)!;
    const section = data.placements.find((p) => p.kind === 'section')!;
    expect(data.placements.filter((p) => p.sectionId === section.id)).toHaveLength(2);
    const root = data.placements.find((p) => p.text === 'Root')!;
    const a = data.placements.find((p) => p.text === 'A')!;
    expect(a.parentId).toBe(root.id);
    expect(data.placements.find((p) => p.text === 'A1')!.parentId).toBe(a.id);
    // Children sit to the right of their parent; the parent is centred on them.
    expect(a.x).toBeGreaterThan(root.x);
  });

  it('turns provider errors into an error event and keeps the user message', async () => {
    const { ai, chats, events } = await setup(() => ({ status: 429 }));
    const { chatId } = ai.sendChat({ text: 'hello' });
    await ai.whenIdle(chatId);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.at(-1).message).toContain('429');
    expect(events.at(-1).message).toContain('mock failure');
    expect(chats.getChat(chatId)!.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('stops a run and keeps what was streamed', async () => {
    const { ai, chats, events } = await setup(() => ({ text: 'partial answer ', hang: true }));
    const { chatId } = ai.sendChat({ text: 'go' });
    await new Promise((r) => setTimeout(r, 150));
    expect(() => ai.sendChat({ chatId, text: 'again' })).toThrow(/still answering/);
    ai.stopChat(chatId);
    await ai.whenIdle(chatId);
    expect(chats.getChat(chatId)!.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'partial answer' });
    expect(events.at(-1).type).toBe('done');
  });

  it('requires a key for Anthropic and keeps it out of the public config', () => {
    const store = mem();
    const app = buildApp(store, { filesDir: null });
    expect(() => app.ai.sendChat({ text: 'hi' })).toThrow(/API key/);
    const cfg = app.ai.setAiConfig({ provider: 'anthropic', model: '', baseUrl: '', apiKey: 'sk-abc' });
    expect(cfg).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com', hasKey: true });
    expect(JSON.stringify(app.ai.getAiConfig())).not.toContain('sk-abc');
    expect(() => app.ai.setAiConfig({ provider: 'x', model: '', baseUrl: '' })).toThrow();
    expect(() => app.ai.setAiConfig({ provider: 'openai', model: '', baseUrl: 'ftp://nope' })).toThrow(/http/);
    // Saving without a key keeps the stored one.
    expect(app.ai.setAiConfig({ provider: 'openai', model: 'm', baseUrl: 'http://localhost:1/v1' }).hasKey).toBe(true);
  });
});

describe('one-shot AI features', () => {
  it('runs built-in, translate and saved actions', async () => {
    const { ai, chats, llm } = await setup((call) => ({ text: `echo: ${call.body.messages[0].content}` }));
    expect(await ai.runAiAction({ action: 'summarize', text: 'Long text' })).toBe('echo: Long text');
    expect(llm.calls[0]!.body.system).toContain('Summarize');
    await ai.runAiAction({ action: 'translate', text: 'hi', language: 'French' });
    expect(llm.calls[1]!.body.system).toContain('into French');
    const id = chats.saveAiAction({ name: 'Pirate', prompt: 'Talk like a pirate.' });
    await ai.runAiAction({ action: id, text: 'hello' });
    expect(llm.calls[2]!.body.system).toContain('pirate');
    await expect(ai.runAiAction({ action: 'nope', text: 'x' })).rejects.toThrow(/Unknown/);
    await expect(ai.runAiAction({ action: 'summarize', text: '  ' })).rejects.toThrow(/Select/);
  });

  it('generates a mind map from a card, tolerating fenced JSON', async () => {
    const { store, ai } = await setup(() => ({ text: '```json\n{"text":"Root","children":[{"text":"One"},{"text":"Two"}]}\n```' }));
    const id = note(store, 'Source', 'some content');
    const { boardId } = await ai.generateMindMap({ cardId: id });
    const data = store.getWhiteboard(boardId)!;
    expect(data.whiteboard.name).toBe('Mind map: Root');
    expect(data.placements.map((p) => p.text).sort()).toEqual(['One', 'Root', 'Two']);
  });

  it('extracts insights tied to blocks and promotes one to a card', async () => {
    const { store, ai } = await setup(() => ({ text: '[{"insight":"Spacing beats cramming.","lines":[3,3]},{"insight":"bad","lines":[99,120]}]' }));
    const id = note(store, 'Learning', '# Learning\n\nSpacing beats cramming.\n\nSleep helps.');
    const insights = await ai.cardInsights(id);
    expect(insights).toHaveLength(2);
    const card = loadCardText(store, new Handles(), id)!;
    expect(insights[0]!.blockIds).toEqual([card.lines[2]!.blocks.at(-1)]);
    expect(insights[1]!.endLine).toBe(card.lines.length);
    const promoted = ai.promoteInsight({ cardId: id, text: insights[0]!.text });
    const created = store.getCard(promoted)!;
    expect(created.title).toBe('Spacing beats cramming.');
    expect(store.cardsMentioning(id).map((b) => b.id)).toContain(promoted);
  });

  it('exposes only whitelisted AI methods over RPC', async () => {
    const store = mem();
    const app = buildApp(store, { filesDir: null });
    const rpc = createRpc(app);
    await expect(rpc({ method: 'getAiConfig', args: [] })).resolves.toMatchObject({ hasKey: false });
    await expect(rpc({ method: 'runAgent', args: [] })).rejects.toThrow(/Unknown method/);
    const exported = (await rpc({ method: 'exportAll', args: ['markdown'] })) as { name: string; text: string };
    expect(exported.name).toMatch(/\.md$/);
  });
});
