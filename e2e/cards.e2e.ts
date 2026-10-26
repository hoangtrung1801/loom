import { describe, expect, it } from 'vitest';
import { pw, useBrowser } from './harness.js';

const h = useBrowser();
const page = () => h.page();

async function newCard(title: string): Promise<void> {
  await page().click('button[aria-label="New card"]');
  await page().waitForSelector('.card-title');
  await page().fill('.card-title', title);
}
const editor = () => page().locator('.card-doc .ProseMirror');

describe('cards and the editor', () => {
  it('starts on the card library with the seeded cards', async () => {
    await pw(page().locator('.card-list .card-row').first()).toBeVisible();
    expect(await page().locator('.card-list .card-row').count()).toBe(2);
    for (const app of ['Inbox', 'Journal', 'Whiteboards', 'Card Library', 'Tag Database', 'Chat']) await pw(page().locator(`.app-link:has-text("${app}")`)).toBeVisible();
    expect(h.errors).toEqual([]);
  });

  it('creates a card in the inbox, writes with markdown shortcuts and persists', async () => {
    await newCard('Persisted idea');
    await editor().click();
    await page().keyboard.type('# Big heading');
    await page().keyboard.press('Enter');
    await page().keyboard.type('- first item');
    await page().keyboard.press('Enter');
    await page().keyboard.type('second item');
    await page().keyboard.press('Enter');
    await page().keyboard.press('Enter');
    await page().keyboard.type('**bold** and `code` and ==marked==');
    await pw(editor().locator('h1')).toHaveText('Big heading');
    expect(await editor().locator('li').count()).toBe(2);
    await pw(editor().locator('strong')).toHaveText('bold');
    await pw(editor().locator('mark')).toHaveText('marked');

    await page().waitForTimeout(900);
    await page().reload();
    await page().waitForSelector('.card-title');
    await pw(page().locator('.card-title')).toHaveValue('Persisted idea');
    await pw(editor().locator('li').nth(1)).toHaveText('second item');
    const inbox = await h.rpc<{ title: string }[]>('listCards', { inbox: true });
    expect(inbox.map((c) => c.title)).toContain('Persisted idea');
  });

  it('inserts blocks from the slash menu', async () => {
    await newCard('Blocks');
    await editor().click();
    await page().keyboard.type('/todo');
    await pw(page().locator('.menu-item').first()).toContainText('To-do');
    await page().keyboard.press('Enter');
    await page().keyboard.type('buy milk');
    await page().keyboard.press('Enter');
    await page().keyboard.press('Enter');
    await page().keyboard.type('/callout');
    await page().keyboard.press('Enter');
    await page().keyboard.type('careful');
    await pw(editor().locator('.todo-item')).toHaveCount(1);
    await pw(editor().locator('.callout')).toContainText('careful');
    await page().keyboard.press('Enter');
    await page().keyboard.press('Enter');
    await page().keyboard.type('/table');
    await page().keyboard.press('Enter');
    await pw(editor().locator('table')).toHaveCount(1);
    await page().waitForTimeout(800);
    const [card] = await h.rpc<{ id: string }[]>('listCards', { sort: 'updated', limit: 1 });
    const detail = await h.rpc<{ content: string }>('getCard', card!.id);
    for (const type of ['todo_item', 'callout', 'table']) expect(detail.content).toContain(`"type":"${type}"`);
    // every block has a stable id for citations and block-level backlinks
    expect(detail.content).toMatch(/"type":"paragraph","attrs":\{"id":"[^"]+"/);
  });

  it('turns to-dos into tasks that show in the inbox and can be checked from there', async () => {
    await newCard('Chores');
    await editor().click();
    await page().keyboard.type('[] water plants');
    await page().waitForTimeout(800);
    await page().click('.app-link:has-text("Inbox")');
    await pw(page().locator('.task-list .task')).toHaveCount(1);
    await page().locator('.task input[type=checkbox]').click();
    await page().waitForTimeout(300);
    const tasks = await h.rpc<{ checked: boolean }[]>('listTasks', {});
    expect(tasks[0]!.checked).toBe(true);
    await pw(page().locator('.task-list .task')).toHaveCount(0);
  });

  it('links cards with @ and shows block-level backlinks in the info panel', async () => {
    await newCard('Source note');
    await editor().click();
    await page().keyboard.type('See @Welcome');
    await pw(page().locator('.menu-item').first()).toContainText('Welcome to Loom');
    await page().keyboard.press('Enter');
    await pw(editor().locator('.mention')).toHaveText('@Welcome to Loom');
    await page().waitForTimeout(800);
    const welcome = (await h.rpc<{ id: string; title: string }[]>('listCards', {})).find((c) => c.title === 'Welcome to Loom')!;
    const links = await h.rpc<{ title: string; blockId: string }[]>('cardsMentioning', welcome.id);
    const mine = links.find((l) => l.title === 'Source note');
    expect(mine).toBeTruthy();
    expect(mine!.blockId).toBeTruthy();
    // open the target card, then its Info panel
    await page().click('.app-link:has-text("Card Library")');
    await page().click('.card-row:has(.title:text-is("Welcome to Loom"))');
    await page().click('button[aria-label="Info"]');
    await pw(page().locator('.rightbar .backlinks')).toContainText('Source note');
  });

  it('clicking a [[wikilink]] opens or creates the card', async () => {
    await newCard('Hub');
    await editor().click();
    await page().keyboard.type('Go to [[Brand new topic]] now');
    await page().waitForTimeout(800);
    await editor().locator('.wikilink').click();
    await pw(page().locator('.card-title')).toHaveValue('Brand new topic');
  });

  it('tags a card and edits the tag database', async () => {
    await newCard('Tagged card');
    await page().fill('input[aria-label="Add tag"]', 'Project X');
    await page().keyboard.press('Enter');
    await pw(page().locator('.chip-label')).toHaveText('#project-x');
    await page().click('.app-link:has-text("Tag Database")');
    await pw(page().locator('.tag-card:has-text("project-x")')).toContainText('1 card');
    await page().fill('input[aria-label="Collection of project-x"]', 'Work');
    await page().locator('input[aria-label="Collection of project-x"]').blur();
    await pw(page().locator('h3:has-text("Work")')).toBeVisible();
    await page().click('.tag-card:has-text("project-x")');
    await page().fill('input[aria-label="New property name"]', 'Status');
    await page().selectOption('select[aria-label="Property type"]', 'select');
    await page().click('button:has-text("Add property")');
    await pw(page().locator('.db-table th:has-text("Status")')).toBeVisible();
    await page().locator('.db-table td select').selectOption('Option 1');
    await page().waitForTimeout(300);
    const table = await h.rpc<{ rows: { values: Record<string, string> }[] }>('getTagTable', 'project-x');
    expect(Object.values(table.rows[0]!.values)).toEqual(['Option 1']);
    // the property shows up on the card itself
    await page().click('.db-table td .link');
    await pw(page().locator('.props')).toContainText('Status');
  });

  it('writes the daily journal from the calendar', async () => {
    await page().click('.app-link:has-text("Journal")');
    await page().waitForSelector('.journal-day .ProseMirror');
    await page().locator('.journal-day .ProseMirror').click();
    await page().keyboard.type('Today I tested the journal');
    await page().waitForTimeout(900);
    await page().reload();
    await page().click('.app-link:has-text("Journal")');
    await pw(page().locator('.journal-day .ProseMirror')).toContainText('Today I tested the journal');
    await pw(page().locator('.day.today.written')).toBeVisible();
  });

  it('moves cards to the trash and restores them', async () => {
    await newCard('Short lived');
    await page().click('button:has-text("Move to trash")');
    await page().click('button[aria-label="Trash"]');
    await pw(page().locator('.trash-row:has-text("Short lived")')).toBeVisible();
    await page().click('.trash-row:has-text("Short lived") button');
    await pw(page().locator('.trash-row')).toHaveCount(0);
    expect((await h.rpc<{ title: string }[]>('listCards', {})).map((c) => c.title)).toContain('Short lived');
  });

  it('attaches an image through the slash menu and serves it back', async () => {
    await newCard('Pictures');
    await editor().click();
    await page().keyboard.type('/image');
    const chooser = page().waitForEvent('filechooser');
    await page().keyboard.press('Enter');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
    await pw(editor().locator('img')).toHaveCount(1);
    const src = await editor().locator('img').getAttribute('src');
    expect(src).toMatch(/^\/file\/[0-9a-f]{64}$/);
    const res = await page().request.get(h.url() + src!.slice(1));
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  it('imports markdown and other files as cards', async () => {
    await page().click('.app-link:has-text("Card Library")');
    const chooser = page().waitForEvent('filechooser');
    await page().click('button:has-text("Import files")');
    await (await chooser).setFiles([
      { name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported note\n\n- a\n- b') },
      { name: 'data.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) },
    ]);
    await pw(page().locator('.card-row:has-text("Imported note")')).toBeVisible();
    const list = await h.rpc<{ title: string; kind: string }[]>('listCards', {});
    expect(list.find((c) => c.title === 'Imported note')?.kind).toBe('note');
    expect(list.find((c) => c.title === 'data')?.kind).toBe('file');
  });
});
