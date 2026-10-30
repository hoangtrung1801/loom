import { describe, expect, it } from 'vitest';
import { pw, useBrowser } from './harness.js';

const h = useBrowser();
const page = () => h.page();
const objs = () => page().locator('.obj');
const cardObjs = () => page().locator('.obj.card-obj');

async function openSeedBoard(): Promise<void> {
  await page().click('.app-link:has-text("Whiteboards")');
  await page().click('.tree-main');
  await page().waitForSelector('.obj');
}
interface Placement { id: string; kind: string; x: number; y: number; w: number; h: number; text: string; sectionId: string; parentId: string; color: string; size: number; cardId: string; title: string }
async function boardData(): Promise<{ placements: Placement[]; edges: { id: string; from: string; to: string; label: string; style: string; color: string; arrow: string }[] }> {
  const [b] = await h.rpc<{ id: string }[]>('listWhiteboards');
  return h.rpc('getWhiteboard', b!.id);
}
const centerOf = async (loc: ReturnType<typeof objs>) => {
  const box = (await loc.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};
async function drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page().mouse.move(from.x, from.y);
  await page().mouse.down();
  await page().mouse.move(to.x, to.y, { steps: 8 });
  await page().mouse.up();
}

async function addText(x: number, y: number, text: string): Promise<void> {
  await page().click('button[aria-label="Text"]');
  await page().mouse.click(x, y);
  await pw(page().locator('textarea[aria-label="Text"]')).toBeFocused();
  await page().keyboard.type(text);
  await page().keyboard.press('Control+Enter');
  await pw(page().locator('textarea[aria-label="Text"]')).toHaveCount(0);
}

describe('whiteboards', () => {
  it('shows the seeded whiteboard with cards and a connection', async () => {
    await openSeedBoard();
    await pw(page().locator('.board-title')).toHaveValue('Getting started');
    expect(await cardObjs().count()).toBe(2);
    expect(await page().locator('.edge-line:not(.preview)').count()).toBe(1);
    await pw(cardObjs().first()).toContainText('Welcome to Loom');
  });

  it('creates a card by double-clicking, edits it in place and persists it', async () => {
    await openSeedBoard();
    await page().mouse.dblclick(900, 700);
    await page().waitForFunction(() => document.querySelectorAll('.obj.card-obj').length === 3);
    const card = cardObjs().last();
    await pw(card).toHaveClass(/editing/);
    await card.locator('.obj-title').fill('On the board');
    await card.locator('.ProseMirror').click();
    await page().keyboard.type('- one');
    await page().keyboard.press('Enter');
    await page().keyboard.type('two');
    await pw(card.locator('li')).toHaveCount(2);
    await page().waitForTimeout(900);
    await page().reload();
    await page().waitForSelector('.obj');
    expect(await cardObjs().count()).toBe(3);
    await pw(cardObjs().last()).toContainText('On the board');
    await pw(cardObjs().last().locator('li').nth(1)).toHaveText('two');
  });

  it('drags and resizes objects and remembers the geometry', async () => {
    await openSeedBoard();
    const card = cardObjs().first();
    const before = await centerOf(card);
    await card.locator('header strong').hover();
    const head = (await card.locator('header').boundingBox())!;
    await drag({ x: head.x + 60, y: head.y + 10 }, { x: head.x + 160, y: head.y + 100 });
    const after = (await card.boundingBox())!;
    expect(Math.round(after.x - before.box.x)).toBe(100);
    expect(Math.round(after.y - before.box.y)).toBe(90);

    await pw(card).toHaveClass(/selected/);
    const handle = (await card.locator('.handle.resize').boundingBox())!;
    await drag({ x: handle.x + 6, y: handle.y + 6 }, { x: handle.x + 86, y: handle.y + 56 });
    expect(Math.round((await card.boundingBox())!.width - before.box.width)).toBe(80);
    await page().waitForTimeout(400);
    const saved = (await boardData()).placements.find((p) => p.title === 'Welcome to Loom')!;
    expect(Math.round(saved.w)).toBe(Math.round(before.box.width + 80));
    // the viewport starts at 100% so screen deltas equal world deltas
    await page().reload();
    await page().waitForSelector('.obj');
    expect(Math.round((await cardObjs().first().boundingBox())!.width)).toBe(Math.round(before.box.width + 80));
  });

  it('adds text, sections and mind-map children, and recolours them', async () => {
    await openSeedBoard();
    await addText(500, 150, 'A loose thought');
    await pw(page().locator('.text-obj')).toContainText('A loose thought');

    await page().click('button[aria-label="Section"]');
    await page().mouse.move(300, 560);
    await page().mouse.down();
    await page().mouse.move(700, 760, { steps: 6 });
    await page().mouse.up();
    await pw(page().locator('input[aria-label="Section title"]')).toBeFocused();
    await page().keyboard.type('Group A');
    await page().keyboard.press('Enter');
    await pw(page().locator('.section-obj header strong')).toHaveText('Group A');

    await page().click('button[aria-label="Mind map"]');
    await page().mouse.click(900, 200);
    await pw(page().locator('textarea[aria-label="Text"]')).toBeFocused();
    await page().keyboard.type('Root idea');
    await page().keyboard.press('Control+Enter');
    await pw(page().locator('textarea[aria-label="Text"]')).toHaveCount(0);
    await page().keyboard.press('Tab');
    await pw(page().locator('textarea[aria-label="Text"]')).toBeFocused();
    await page().keyboard.type('Child one');
    await page().keyboard.press('Control+Enter');
    await pw(page().locator('.text-obj.mind')).toHaveCount(2);
    await pw(page().locator('.mind-edge')).toHaveCount(1);

    await page().locator('.obj:has-text("Root idea")').click();
    await page().click('.selection-bar button[aria-label="red"]');
    await page().waitForTimeout(300);
    const data = await boardData();
    const root = data.placements.find((p) => p.text === 'Root idea')!;
    const child = data.placements.find((p) => p.text === 'Child one')!;
    expect(root.color).toBe('red');
    expect(child.color).toBe('red'); // colouring a mind-map node colours its branch
    expect(child.parentId).toBe(root.id);
    expect(child.x).toBeGreaterThan(root.x);
  });

  it('moves objects into a section by dropping them there, and the section carries them', async () => {
    await openSeedBoard();
    await page().click('button[aria-label="Section"]');
    await page().mouse.move(300, 560);
    await page().mouse.down();
    await page().mouse.move(700, 760, { steps: 6 });
    await page().mouse.up();
    await pw(page().locator('.section-obj')).toHaveCount(1);
    await page().keyboard.press('Escape');
    // drag the second card onto the section by its header
    const target = cardObjs().nth(1);
    const head = (await target.locator('header').boundingBox())!;
    const card = (await target.boundingBox())!;
    const sec = (await page().locator('.section-obj').boundingBox())!;
    const grab = { x: head.x + 60, y: head.y + 10 };
    // aim so the card's centre (what decides membership) lands in the middle of the section
    await drag(grab, { x: sec.x + sec.width / 2 + (grab.x - (card.x + card.width / 2)), y: sec.y + sec.height / 2 + (grab.y - (card.y + card.height / 2)) });
    await page().waitForTimeout(400);
    let data = await boardData();
    const section = data.placements.find((p) => p.kind === 'section')!;
    const linking = data.placements.find((p) => p.title === 'Linking ideas')!;
    expect(linking.sectionId).toBe(section.id);
    // dragging the section drags its members
    const before = linking.x;
    const sh = (await page().locator('.section-obj').boundingBox())!;
    await drag({ x: sh.x + 8, y: sh.y + 8 }, { x: sh.x + 58, y: sh.y + 8 });
    await page().waitForTimeout(400);
    data = await boardData();
    expect(Math.round(data.placements.find((p) => p.title === 'Linking ideas')!.x - before)).toBe(50);
  });

  it('connects objects, styles the connection, and undoes and redoes', async () => {
    await openSeedBoard();
    await addText(700, 120, 'Source');
    await addText(1000, 120, 'Target');

    await page().locator('.obj:has-text("Source")').click();
    const link = (await page().locator('.obj:has-text("Source") .handle.link').boundingBox())!;
    const to = await centerOf(page().locator('.obj:has-text("Target")'));
    await drag({ x: link.x + 6, y: link.y + 6 }, { x: to.x, y: to.y });
    await pw(page().locator('.edge-line:not(.preview)')).toHaveCount(2);
    await pw(page().locator('[aria-label="Connection"]')).toBeVisible();
    await page().fill('input[aria-label="Connection label"]', 'leads to');
    await page().keyboard.press('Enter');
    await page().selectOption('select[aria-label="Line style"]', 'dashed');
    await page().click('.selection-bar button[aria-label="blue"]');
    await page().waitForTimeout(300);
    let edges = (await boardData()).edges;
    const made = edges.find((e) => e.label === 'leads to')!;
    expect(made).toMatchObject({ style: 'dashed', color: 'blue' });
    await pw(page().locator('.edge-label')).toHaveText('leads to');

    await page().keyboard.press('Control+z'); // colour
    await page().keyboard.press('Control+z'); // style
    await page().keyboard.press('Control+z'); // label
    await page().keyboard.press('Control+z'); // connection itself
    await pw(page().locator('.edge-line:not(.preview)')).toHaveCount(1);
    await page().keyboard.press('Control+Shift+z');
    await pw(page().locator('.edge-line:not(.preview)')).toHaveCount(2);
  });

  it('removes objects from the board with Delete and undoes it, keeping the cards', async () => {
    await openSeedBoard();
    await cardObjs().first().locator('header strong').click();
    await page().keyboard.press('Delete');
    await pw(cardObjs()).toHaveCount(1);
    expect((await h.rpc<unknown[]>('listCards', {})).length).toBe(2); // still in the library
    await page().keyboard.press('Control+z');
    await pw(cardObjs()).toHaveCount(2);
  });

  it('box-selects several objects and moves them together', async () => {
    await openSeedBoard();
    await page().mouse.move(330, 250);
    await page().mouse.down();
    await page().mouse.move(1300, 700, { steps: 8 });
    await page().mouse.up();
    await pw(page().locator('.obj.selected')).toHaveCount(2);
    await pw(page().locator('.selection-bar')).toContainText('2 selected');
    const first = (await cardObjs().first().boundingBox())!;
    await drag({ x: first.x + 60, y: first.y + 12 }, { x: first.x + 60, y: first.y + 62 });
    await page().waitForTimeout(400);
    const before = (await boardData()).placements.map((p) => p.y);
    await page().keyboard.press('Control+z');
    await page().waitForTimeout(400);
    const after = (await boardData()).placements.map((p) => p.y);
    after.forEach((y, i) => expect(Math.round(before[i]! - y)).toBe(50));
  });

  it('finds things on the board and highlights matches', async () => {
    await openSeedBoard();
    await page().keyboard.press('Control+f');
    await page().fill('input[aria-label="Search this whiteboard"]', 'backlinks');
    await pw(page().locator('.obj.match')).toHaveCount(1);
    await pw(page().locator('.obj.dim')).toHaveCount(1);
    await page().keyboard.press('Enter');
    await pw(page().locator('.obj.selected')).toContainText('Linking ideas');
    await page().keyboard.press('Escape');
  });

  it('creates sub-whiteboards and moves cards into them by dropping on the tile', async () => {
    await openSeedBoard();
    await page().mouse.click(1000, 120, { button: 'right' });
    await page().click('[role^="menuitem"]:has-text("New sub-whiteboard here")');
    await pw(page().locator('.board-obj')).toHaveCount(1);
    const tile = await centerOf(page().locator('.board-obj'));
    const head = (await cardObjs().nth(1).locator('header').boundingBox())!;
    await drag({ x: head.x + 60, y: head.y + 10 }, { x: tile.x, y: tile.y });
    await pw(cardObjs()).toHaveCount(1);
    await page().locator('.board-obj').dblclick();
    await pw(page().locator('.board-title')).toHaveValue('Untitled whiteboard');
    await pw(cardObjs()).toHaveCount(1);
    await pw(cardObjs()).toContainText('Linking ideas');
    await pw(page().locator('.board-head .link')).toContainText('Getting started');
  });

  it('adds an existing card from the picker and drops library cards onto the board', async () => {
    await openSeedBoard();
    await page().click('.board-toolbar button[aria-label="New card"]');
    await pw(cardObjs()).toHaveCount(3);
    await page().keyboard.press('Escape');
    await page().click('button[aria-label="Add existing card"]');
    await page().fill('input[aria-label="Search cards to add"]', 'Welcome');
    await page().click('.picker li button');
    await pw(cardObjs()).toHaveCount(4); // the same card can sit on a board twice
    await page().click('button[aria-label="Card Library"]');
    const row = page().locator('.rightbar .card-row').first();
    const canvas = (await page().locator('.canvas').boundingBox())!;
    await row.dragTo(page().locator('.canvas'), { targetPosition: { x: canvas.width / 2, y: 120 } });
    await pw(cardObjs()).toHaveCount(5);
  });

  it('shows where a card lives and focuses it on the board', async () => {
    await page().click('.app-link:has-text("Card Library")');
    await page().click('.card-row:has(.title:text-is("Welcome to Loom"))');
    await page().click('button[aria-label="Whiteboard location"]');
    await page().click('.rightbar .card-row');
    await pw(page().locator('.board-title')).toHaveValue('Getting started');
    await pw(page().locator('.obj.selected')).toContainText('Welcome to Loom');
  });

  it('uploads files onto the board as cards', async () => {
    await openSeedBoard();
    const chooser = page().waitForEvent('filechooser');
    await page().click('button[aria-label="Upload"]');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await (await chooser).setFiles([{ name: 'pic.png', mimeType: 'image/png', buffer: png }, { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# From file\n\nbody') }]);
    await pw(page().locator('.obj.kind-image img')).toHaveCount(1);
    await pw(cardObjs().filter({ hasText: 'From file' })).toHaveCount(1);
  });

  it('opens the chat with the right context from the selection', async () => {
    await openSeedBoard();
    await cardObjs().first().locator('header strong').click();
    await page().click('.selection-bar button[aria-label="Ask AI"]');
    await pw(page().locator('.rightbar .chips .chip-label')).toHaveText('Welcome to Loom');
  });
});
