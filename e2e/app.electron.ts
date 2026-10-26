import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect as pw } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: ElectronApplication;
let page: Page;
let dataDir: string;

const launch = () =>
  electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOOM_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });

const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const rpc = <T>(method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => window.loom!.rpc({ method: m as string, args: a as unknown[] }), [method, args]) as Promise<T>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loom-electron-'));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.sidebar');
});
afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('packaged-style Electron app', () => {
  it('loads the bundled renderer and talks to SQLite over IPC', async () => {
    expect(page.url()).toMatch(/^file:\/\/.*\/dist\/renderer\/index\.html/);
    expect(await page.evaluate(() => typeof window.loom?.rpc)).toBe('function');
    await page.click('.app-link:has-text("Card Library")');
    await pw(page.locator('.card-row .title:text-is("Welcome to Loom")')).toBeVisible();
  });

  it('is isolated: no Node, no require, only the rpc bridge', async () => {
    const exposed = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      keys: Object.keys(window.loom ?? {}),
    }));
    expect(exposed).toEqual({ require: 'undefined', process: 'undefined', keys: ['rpc', 'upload', 'onEvent', 'ready', 'localApi'] });
  });

  it('only accepts whitelisted RPC methods and never exposes the AI key', async () => {
    const bad = await page.evaluate(() => window.loom!.rpc({ method: 'close', args: [] }).then(() => 'resolved', (e: Error) => e.message));
    expect(bad).not.toBe('resolved');
    const boards = await rpc<{ name: string }[]>('listWhiteboards');
    expect(boards[0]?.name).toBe('Getting started');
    await rpc('setAiConfig', { provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-secret' });
    expect(JSON.stringify(await rpc('getAiConfig'))).not.toContain('sk-secret');
  });

  it('persists UI edits as JSON files in the data dir', async () => {
    await page.click('.side-actions button[aria-label="New card"]');
    await page.fill('input[aria-label="Card title"]', 'From Electron');
    await page.locator('.ProseMirror').click();
    await pw(page.locator('.ProseMirror')).toBeFocused();
    await page.keyboard.type('stored via ipc');
    await page.waitForTimeout(1500);
    const cards = join(dataDir, 'library', 'cards');
    const row = readdirSync(cards)
      .map((n) => JSON.parse(readFileSync(join(cards, n), 'utf8')) as { title: string; content: unknown })
      .find((c) => c.title === 'From Electron');
    expect(JSON.stringify(row?.content)).toContain('stored via ipc');
    expect(existsSync(join(dataDir, 'loom.db'))).toBe(false);
    expect((await rpc<{ id: string }[]>('search', 'stored')).length).toBe(1);
    // The daily backup was taken at startup, as one JSON file.
    expect(readdirSync(join(dataDir, 'backups')).filter((n) => /^loom-.*\.json$/.test(n))).toHaveLength(1);
  });

  it('runs the local API for the loom CLI only while it is switched on', async () => {
    const infoFile = join(dataDir, 'local-server.json');
    const off = await page.evaluate(() => window.loom!.localApi!());
    expect(off).toMatchObject({ enabled: false });
    expect(existsSync(infoFile)).toBe(false);

    const on = (await page.evaluate(() => window.loom!.localApi!(true))) as { enabled: boolean; port: number };
    expect(on.enabled).toBe(true);
    expect(statSync(infoFile).mode & 0o777).toBe(0o600);
    const cli = (...args: string[]) =>
      execFileSync(process.execPath, [join(process.cwd(), 'dist/cli/loom.cjs'), ...args], { env: { ...process.env, LOOM_DATA_DIR: dataDir }, encoding: 'utf8' });
    const made = JSON.parse(cli('note', 'From the CLI', '--body', 'piped **words**', '--tag', 'cli', '--json')) as { id: string };
    expect(cli('read', made.id)).toContain('piped **words**');
    expect(cli('search', 'piped')).toContain('From the CLI');
    await page.click('.app-link:has-text("Card Library")');
    await pw(page.locator('.card-row .title:text-is("From the CLI")')).toBeVisible();

    await page.evaluate(() => window.loom!.localApi!(false));
    expect(existsSync(infoFile)).toBe(false);
    expect(() => execFileSync(process.execPath, [join(process.cwd(), 'dist/cli/loom.cjs'), 'health'], { env: { ...process.env, LOOM_DATA_DIR: dataDir }, stdio: 'pipe' })).toThrow();
  });

  it('opens loom:// links in the running window', async () => {
    const id = await rpc<string>('createCard', { title: 'Deep linked', content: doc('arrived by link') });
    await app.evaluate(({ app: a }, link) => {
      a.emit('open-url', { preventDefault: () => undefined }, link);
    }, `loom://card/${id}`);
    await pw(page.locator('input[aria-label="Card title"]')).toHaveValue('Deep linked');
    // Anything else is ignored rather than guessed at.
    await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault: () => undefined }, 'loom://card/..%2F..%2Fetc'));
    await pw(page.locator('input[aria-label="Card title"]')).toHaveValue('Deep linked');
  });

  it('renders attachments through loom-file:// under the CSP: image, range reads and a PDF', async () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const pdfText = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (Hello PDF) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF';
    const pdf = Uint8Array.from(Buffer.from(pdfText, 'latin1'));
    const ids = await page.evaluate(async ([a, b]) => {
      const up = window.loom!.upload as (name: string, mime: string, bytes: Uint8Array) => Promise<string>;
      return [await up('dot.png', 'image/png', new Uint8Array(a!)), await up('doc.pdf', 'application/pdf', new Uint8Array(b!))];
    }, [[...png], [...pdf]]);
    await rpc<string>('createCard', { title: 'Dot', kind: 'image', fileId: ids[0] });
    await rpc<string>('createCard', { title: 'Doc', kind: 'pdf', fileId: ids[1] });

    const range = await page.evaluate(async (id) => {
      const r = await fetch(`loom-file://${id}`, { headers: { range: 'bytes=0-7' } });
      return { status: r.status, bytes: (await r.arrayBuffer()).byteLength, type: r.headers.get('content-type'), sniff: r.headers.get('x-content-type-options') };
    }, ids[0]);
    expect(range).toEqual({ status: 206, bytes: 8, type: 'image/png', sniff: 'nosniff' });

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.click('.app-link:has-text("Card Library")');
    await page.locator('.card-row', { has: page.locator('.title:text-is("Dot")') }).click();
    await pw(page.locator('img.attachment')).toHaveJSProperty('naturalWidth', 1);

    await page.click('.app-link:has-text("Card Library")');
    await page.locator('.card-row', { has: page.locator('.title:text-is("Doc")') }).click();
    await pw(page.locator('.pdf canvas').first()).toBeVisible({ timeout: 15000 });
    await pw(page.locator('.pdf-page .textLayer, .pdf-page span').first()).toContainText('Hello PDF', { timeout: 15000 });
  });

  it('has an application menu whose commands drive the page, without double-firing shortcuts', async () => {
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
    expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'Go', 'View']));
    const tabs = () => page.locator('.tab-list .tab').count();
    const before = await tabs();
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!;
      file.submenu!.items.find((i) => i.label === 'New Tab')!.click();
    });
    await pw(page.locator('.tab-list .tab')).toHaveCount(before + 1);
    await page.keyboard.press('Control+t'); // keyboard path: exactly one more tab
    await pw(page.locator('.tab-list .tab')).toHaveCount(before + 1); // a blank tab is reused rather than stacked
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!;
      file.submenu!.items.find((i) => i.label === 'Close Tab')!.click();
    });
    await pw(page.locator('.tab-list .tab')).toHaveCount(before);
  });

  it('opens http links externally and never navigates the app window away', async () => {
    const before = page.url();
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    const opened = await page.evaluate(() => window.open('https://example.com/') === null);
    expect(opened).toBe(true);
    expect(app.windows()).toHaveLength(1);
  });

  it('restores data and the window size after a restart', async () => {
    await rpc<string>('createCard', { title: 'Second run', content: doc('persisted') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1111, height: 777 }));
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForSelector('.sidebar');
    await page.click('.app-link:has-text("Card Library")');
    await pw(page.locator('.card-row .title:text-is("From Electron")')).toBeVisible();
    await pw(page.locator('.card-row .title:text-is("Second run")')).toBeVisible();
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
    expect(size).toMatchObject({ width: 1111, height: 777 });
  });
});
