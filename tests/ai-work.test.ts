import { afterEach, describe, expect, it } from 'vitest';
import { loadCardText } from '../src/core/ai/context.js';
import { Handles } from '../src/core/ai/handles.js';
import { Ai } from '../src/core/ai/service.js';
import { executeTool, toolSpecs, type Run } from '../src/core/ai/tools.js';
import { Chats } from '../src/core/chats.js';
import { Store } from '../src/core/store.js';
import { Work } from '../src/core/work.js';
import { mockLlm } from './mock-llm.js';

const open: Store[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  open.splice(0).forEach((s) => s.close());
  await Promise.all(closers.splice(0).map((c) => c()));
});
function run(allowWrites = false): Run {
  const store = new Store(':memory:');
  open.push(store);
  return { store, handles: new Handles(), read: new Map(), allowWrites, changes: [] };
}
const call = (r: Run, name: string, args: Record<string, unknown> = {}) => executeTool(r, name, args).text;

describe('AI sees tasks, links and memos', () => {
  it('puts task fields and link details in the card header the model reads', () => {
    const r = run();
    const work = new Work(r.store);
    const parent = work.createTask({ title: 'Launch' });
    const task = work.createTask({ title: 'Write copy', status: 'in-review', priority: 'high', assignee: 'Ana', due: '2030-05-01', parentId: parent, labels: ['marketing'], acceptance: ['Reviewed'] });
    const { id: link } = work.saveLink({ url: 'https://example.com/guide', title: 'The guide', description: 'How to launch', tags: ['reading'] });
    const memo = work.addMemo('Remember to email the printer about proofs');

    const t = loadCardText(r.store, r.handles, task)!;
    expect(t.header).toBe(`${t.handle} card "Write copy" (task, status in-review, priority high, assignee Ana, due 2030-05-01, subtask of ${r.handles.short('c', parent)}, #marketing)`);
    expect(t.lines.map((l) => l.text).join('\n')).toContain('Reviewed');
    expect(loadCardText(r.store, r.handles, link)!.header).toContain('(link, https://example.com/guide, description: How to launch, #reading)');
    const m = loadCardText(r.store, r.handles, memo)!;
    expect(m.title).toBe('Remember to email the printer about proofs');
    expect(m.header).toContain('(memo)');
  });

  it('lists tasks, links and memos with handles the model can read', () => {
    const r = run();
    const work = new Work(r.store);
    work.createTask({ title: 'Old report', due: '2001-01-01', priority: 'high' });
    work.createTask({ title: 'Done thing', status: 'done' });
    work.saveLink({ url: 'https://example.com/zebra', title: 'Zebra facts', description: 'stripes', note: 'check source' });
    work.addMemo('buy milk');

    expect(call(r, 'list_tasks', { overdue: true })).toMatch(/^c1 "Old report" \[todo, high, due 2001-01-01\]$/);
    expect(call(r, 'list_tasks', { include_done: false })).not.toContain('Done thing');
    expect(call(r, 'list_tasks', { status: 'blocked' })).toBe('No matching tasks.');
    expect(call(r, 'list_tasks', { status: 'bogus' })).toMatch(/^Error: Unknown status/);
    const links = call(r, 'list_links', { query: 'zebra' });
    expect(links).toContain('"Zebra facts" https://example.com/zebra — stripes | note: check source');
    expect(call(r, 'list_links', { query: 'nothing' })).toBe('No saved links.');
    expect(call(r, 'list_memos', {})).toMatch(/c\d+ \d{4}-\d{2}-\d{2}: buy milk/);
    expect(call(r, 'list_memos', { query: 'zzz' })).toBe('No memos.');
    // handles from a listing can be read
    expect(call(r, 'read_card', { card: 'c1' })).toContain('Old report');
  });

  it('only exposes the editing tools when edits are allowed, and gates them at call time', () => {
    const names = (w: boolean) => toolSpecs(w).map((t) => t.name);
    expect(names(false)).toEqual(expect.arrayContaining(['list_tasks', 'list_links', 'list_memos']));
    for (const w of ['create_task', 'update_task', 'save_link', 'add_memo']) {
      expect(names(false)).not.toContain(w);
      expect(names(true)).toContain(w);
    }
    const r = run(false);
    expect(call(r, 'create_task', { title: 'nope' })).toMatch(/Editing is disabled/);
    expect(new Work(r.store).listTasks()).toEqual([]);
  });

  it('creates and updates tasks, saves links offline and adds memos when edits are allowed', () => {
    const r = run(true);
    const epic = call(r, 'create_task', { title: 'Epic' }).match(/c\d+/)![0];
    const made = call(r, 'create_task', { title: 'Child', priority: 'high', labels: ['x'], acceptance: ['one', 'two'], due: '2030-01-02', parent: epic });
    const handle = made.match(/c\d+/)![0];
    const work = new Work(r.store);
    expect(work.listTasks({ parentId: r.handles.resolve(epic, 'c')! })[0]).toMatchObject({ title: 'Child', priority: 'high', labels: ['x'], progress: { done: 0, total: 2 } });

    expect(call(r, 'update_task', { task: handle, status: 'done', assignee: 'Bo' })).toBe('Updated.');
    expect(work.getTask(r.handles.resolve(handle, 'c')!)).toMatchObject({ status: 'done', assignee: 'Bo' });
    expect(call(r, 'update_task', { task: handle, status: 'finished' })).toMatch(/^Error: Unknown status/);
    expect(call(r, 'update_task', { task: handle, parent: epic })).toBe('Updated.');
    expect(call(r, 'update_task', { task: epic, parent: handle })).toMatch(/subtask of itself/); // cycles are refused
    expect(call(r, 'update_task', { task: handle, parent: '' })).toBe('Updated.');

    expect(call(r, 'save_link', { url: 'https://example.com/a?utm_source=x', title: 'A', tags: ['t'] })).toMatch(/^Saved as c\d+\.$/);
    expect(call(r, 'save_link', { url: 'https://example.com/a' })).toMatch(/^Already saved as/);
    expect(call(r, 'save_link', { url: 'javascript:alert(1)' })).toMatch(/^Error/);
    expect(call(r, 'add_memo', { text: 'idea' })).toMatch(/^Created c\d+\.$/);
    expect(call(r, 'add_memo', { text: '  ' })).toMatch(/^Error: Write something/);
    expect(r.changes).toEqual(expect.arrayContaining(['Created task “Epic”', 'Updated task “Child”', 'Saved link https://example.com/a?utm_source=x', 'Added a memo']));
  });

  it('answers "what is overdue?" by calling list_tasks and citing nothing it did not read', async () => {
    const store = new Store(':memory:');
    open.push(store);
    const work = new Work(store);
    work.createTask({ title: 'File taxes', due: '2001-04-15', priority: 'high' });
    const llm = await mockLlm((req) => {
      const tool = (req.body.messages as { role: string; content?: string }[]).find((m) => m.role === 'tool' || (Array.isArray(m.content) && JSON.stringify(m.content).includes('tool_result')));
      return tool ? { text: 'Only “File taxes” is overdue.' } : { tools: [{ name: 'list_tasks', args: { overdue: true } }] };
    });
    closers.push(llm.close);
    const ai = new Ai(store, new Chats(store), () => undefined);
    ai.setAiConfig({ provider: 'anthropic', model: 'm', baseUrl: llm.url, apiKey: 'sk-secret' });
    const { chatId } = ai.sendChat({ text: 'What is overdue?' });
    await ai.whenIdle(chatId);
    const transcript = new Chats(store).getChat(chatId)!.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    expect(transcript).toContain('tool: Listed tasks');
    expect(transcript).toContain('Only “File taxes” is overdue.');
    // the tool result the model received contains the task, and the system prompt knows the new kinds
    const second = JSON.stringify(llm.calls[1]!.body);
    expect(second).toContain('File taxes');
    expect(JSON.stringify(llm.calls[0]!.body)).toContain('saved links and quick memos');
  });
});
