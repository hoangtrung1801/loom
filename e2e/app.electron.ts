import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    expect(exposed).toEqual({ require: 'undefined', process: 'undefined', keys: ['rpc', 'upload', 'onEvent'] });
  });

  it('only accepts whitelisted RPC methods and never exposes the AI key', async () => {
    const bad = await page.evaluate(() => window.loom!.rpc({ method: 'close', args: [] }).then(() => 'resolved', (e: Error) => e.message));
    expect(bad).not.toBe('resolved');
    const boards = await rpc<{ name: string }[]>('listWhiteboards');
    expect(boards[0]?.name).toBe('Getting started');
    await rpc('setAiConfig', { provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-secret' });
    expect(JSON.stringify(await rpc('getAiConfig'))).not.toContain('sk-secret');
  });

  it('persists UI edits to the SQLite file in the data dir', async () => {
    await page.click('.side-actions button[aria-label="New card"]');
    await page.fill('input[aria-label="Card title"]', 'From Electron');
    await page.locator('.ProseMirror').click();
    await pw(page.locator('.ProseMirror')).toBeFocused();
    await page.keyboard.type('stored via ipc');
    await page.waitForTimeout(1500);
    const db = new DatabaseSync(join(dataDir, 'loom.db'), { readOnly: true });
    const row = db.prepare("SELECT title, content FROM cards WHERE title = 'From Electron'").get() as { title: string; content: string } | undefined;
    const hit = db.prepare("SELECT card_id FROM search_index WHERE search_index MATCH 'stored*'").all();
    db.close();
    expect(row?.content).toContain('stored via ipc');
    expect(hit).toHaveLength(1);
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

  it('restores data after a restart', async () => {
    await rpc<string>('createCard', { title: 'Second run', content: doc('persisted') });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForSelector('.sidebar');
    await page.click('.app-link:has-text("Card Library")');
    await pw(page.locator('.card-row .title:text-is("From Electron")')).toBeVisible();
    await pw(page.locator('.card-row .title:text-is("Second run")')).toBeVisible();
  });
});
