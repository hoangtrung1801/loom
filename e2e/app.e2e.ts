import { expect as pw } from '@playwright/test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let server: ViteDevServer;
let browser: Browser;
let page: Page;
let url: string;

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([m, a]) => {
      const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-loom': '1' }, body: JSON.stringify({ method: m, args: a }) });
      return res.json();
    },
    [method, args] as const,
  ) as Promise<T>;
}

beforeAll(async () => {
  process.env.LOOM_DB = ':memory:';
  process.env.LOOM_E2E = '1';
  server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  url = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
beforeEach(async () => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  expect((await page.request.post(`${url}__reset`, { headers: { 'x-loom': '1' } })).status()).toBe(204);
  await page.goto(url);
  await page.waitForSelector('.node');
});

const nodes = () => page.locator('.node');
const visibleEdges = () => page.locator('.edge-line:not(.draft)');

describe('loom in the browser', () => {
  it('shows the seeded whiteboard with cards and a connection', async () => {
    await pw(page.locator('.board-title')).toHaveText('Getting started');
    expect(await nodes().count()).toBe(2);
    expect(await visibleEdges().count()).toBe(1);
    await pw(nodes().first().locator('.node-title')).toHaveValue('Welcome to Loom');
    await pw(page.locator('.wikilink').first()).toHaveText('[[Linking ideas]]');
  });

  it('creates a card by double-clicking, edits it with markdown shortcuts, and persists it', async () => {
    await page.mouse.dblclick(500, 770);
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 3);
    const node = nodes().last();
    await node.locator('.node-title').fill('Persisted idea');
    await node.locator('.ProseMirror').click();
    await page.keyboard.type('# Big heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- first item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second item');
    await pw(node.locator('h2, h1').first()).toHaveText('Big heading');
    expect(await node.locator('li').count()).toBe(2);

    await page.waitForTimeout(900); // debounce
    await page.reload();
    await page.waitForSelector('.node');
    expect(await nodes().count()).toBe(3);
    const saved = nodes().last();
    await pw(saved.locator('.node-title')).toHaveValue('Persisted idea');
    await pw(saved.locator('li').nth(1)).toHaveText('second item');
  });

  it('drags and resizes cards and remembers the geometry', async () => {
    const node = nodes().first();
    const before = (await node.boundingBox())!;
    const head = (await node.locator('.node-head').boundingBox())!;
    await page.mouse.move(head.x + 40, head.y + head.height / 2);
    await page.mouse.down();
    await page.mouse.move(head.x + 140, head.y + 90, { steps: 8 });
    await page.mouse.up();
    const after = (await node.boundingBox())!;
    expect(Math.round(after.x - before.x)).toBe(100);
    expect(Math.round(after.y - before.y)).toBe(Math.round(90 - head.height / 2));

    const handle = (await node.locator('.resize').boundingBox())!;
    await page.mouse.move(handle.x + 9, handle.y + 9);
    await page.mouse.down();
    await page.mouse.move(handle.x + 9 + 80, handle.y + 9 + 50, { steps: 6 });
    await page.mouse.up();
    expect(Math.round((await node.boundingBox())!.width - before.width)).toBe(80);

    await page.waitForTimeout(400);
    const id = await node.getAttribute('data-pid');
    const board = await rpc<{ placements: { id: string; w: number }[] }>('getWhiteboard', (await rpc<{ id: string }[]>('listWhiteboards'))[0]!.id);
    expect(board.placements.find((p) => p.id === id)!.w).toBe(400);
  });

  it('connects two cards by dragging from a port, edits the label, and deletes the edge', async () => {
    await page.mouse.dblclick(500, 770);
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 3);
    const third = nodes().last();
    const target = (await third.boundingBox())!;
    const port = nodes().first().locator('.port');
    await nodes().first().hover();
    const p = (await port.boundingBox())!;
    await page.mouse.move(p.x + 7, p.y + 7);
    await page.mouse.down();
    await page.mouse.move(target.x + 100, target.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.edge-line:not(.draft)').length === 2);

    const hit = page.locator('.edge-hit').last();
    await hit.dispatchEvent('dblclick');
    await page.locator('.edge-input').fill('supports');
    await page.keyboard.press('Enter');
    await pw(page.locator('.edge-label')).toHaveText('supports');

    await hit.dispatchEvent('pointerdown');
    await page.mouse.move(5, 5); // keep focus out of any text field
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('.edge-line:not(.draft)').length === 1);
  });

  it('removes a card from the whiteboard with Delete but keeps the card', async () => {
    await nodes().last().locator('.node-head').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 1);
    expect(await visibleEdges().count()).toBe(0);
    expect(await page.locator('.cards .card-row').count()).toBe(2);
  });

  it('searches as you type and opens a card with backlinks', async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('linkin');
    const hit = page.locator('.cards .card-row').first();
    await pw(hit.locator('.title')).toHaveText('Linking ideas');
    await pw(hit.locator('mark').first()).toHaveText(/linkin/i);
    await hit.click();
    await pw(page.locator('.panel-title')).toHaveValue('Linking ideas');
    await pw(page.locator('.panel .link', { hasText: 'Welcome to Loom' }).last()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  it('opens a card from a [[wikilink]], creating it when missing, and adds tags', async () => {
    await page.locator('.wikilink').first().click();
    await pw(page.locator('.panel-title')).toHaveValue('Linking ideas');

    await rpc('createCard', { title: 'Orphan', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see [[Brand new]]' }] }] }) });
    await page.reload();
    await page.waitForSelector('.node');
    await page.locator('.card-row', { hasText: 'Orphan' }).click();
    await page.locator('.panel .wikilink').click();
    await pw(page.locator('.panel-title')).toHaveValue('Brand new');

    await page.getByLabel('Add tag').fill('#Research Notes');
    await page.keyboard.press('Enter');
    await pw(page.locator('.chip')).toHaveText(/#research-notes/);
    await pw(page.locator('.card-row', { hasText: 'Brand new' }).locator('.tags')).toHaveText('#research-notes');
  });

  it('drags a card from the sidebar onto the whiteboard', async () => {
    await rpc('createCard', { title: 'Dragged in' });
    await page.reload();
    await page.waitForSelector('.node');
    const src = page.locator('.card-row', { hasText: 'Dragged in' });
    await src.dragTo(page.locator('.canvas'), { targetPosition: { x: 800, y: 500 } });
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 3);
    await pw(nodes().last().locator('.node-title')).toHaveValue('Dragged in');
  });

  it('pans with the wheel, zooms with ctrl+wheel and fits to content', async () => {
    const before = (await nodes().first().boundingBox())!;
    await page.mouse.move(700, 700);
    await page.mouse.wheel(0, 120);
    const panned = (await nodes().first().boundingBox())!;
    expect(Math.round(before.y - panned.y)).toBe(120);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    const zoomed = Number.parseInt((await page.locator('.controls span').textContent())!, 10);
    expect(zoomed).toBeGreaterThan(100);

    await page.getByLabel('Fit to content').click();
    const box = (await nodes().first().boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
  });

  it('never renders unsafe links or images from synced content', async () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: ' good', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] },
        ] },
      ],
    };
    const id = await rpc<string>('createCard', { title: 'Hostile', content: JSON.stringify(doc) });
    const withImage = await rpc<string>('createCard', { title: 'Has image', content: JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://evil.test/x.png' } }] }) });
    await page.reload();
    await page.waitForSelector('.node');

    await page.locator('.card-row', { hasText: 'Hostile' }).click();
    await page.locator('.panel .editor a').first().waitFor();
    const hrefs = await page.locator('.panel .editor a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(['https://example.com/']);

    await page.locator('.card-row', { hasText: 'Has image' }).click();
    await pw(page.locator('.panel .editor[data-unsupported="1"]')).toBeVisible();
    expect(await page.locator('.panel img').count()).toBe(0);
    // the unsupported card was not overwritten by merely opening it
    await page.waitForTimeout(800);
    expect((await rpc<{ content: string }>('getCard', withImage)).content).toContain('image');
    expect(id).toBeTruthy();
  });

  it('rejects the bridge for cross-site style requests', async () => {
    const res = await page.evaluate(async () => (await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status);
    expect(res).toBe(403);
  });
});
