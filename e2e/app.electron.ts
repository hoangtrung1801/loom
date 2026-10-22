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

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'loom-electron-'));
  app = await electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOOM_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('.node');
});
afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('packaged-style Electron app', () => {
  it('loads the bundled renderer and talks to SQLite over IPC', async () => {
    expect(page.url()).toMatch(/^file:\/\/.*\/dist\/renderer\/index\.html/);
    expect(await page.locator('.node').count()).toBe(2);
    expect(await page.evaluate(() => typeof window.loom?.rpc)).toBe('function');
  });

  it('is isolated: no Node, no require, only the rpc bridge', async () => {
    const exposed = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      keys: Object.keys(window.loom ?? {}),
    }));
    expect(exposed).toEqual({ require: 'undefined', process: 'undefined', keys: ['rpc'] });
  });

  it('only accepts whitelisted RPC methods', async () => {
    const bad = await page.evaluate(() => window.loom!.rpc({ method: 'close', args: [] }).then(() => 'resolved', (e: Error) => e.message));
    expect(bad).not.toBe('resolved');
    const ok = await page.evaluate(() => window.loom!.rpc({ method: 'listWhiteboards', args: [] }) as Promise<{ name: string }[]>);
    expect(ok[0]?.name).toBe('Getting started');
  });

  it('persists UI edits to the SQLite file in the data dir', async () => {
    await page.mouse.dblclick(500, 770);
    await page.waitForFunction(() => document.querySelectorAll('.node').length === 3);
    const node = page.locator('.node').last();
    await node.locator('.node-title').fill('From Electron');
    await node.locator('.ProseMirror').click();
    await page.keyboard.type('stored via ipc');
    await page.waitForTimeout(1200);
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
    await app.close();
    app = await electron.launch({
      executablePath: join(process.cwd(), 'node_modules/electron/dist/electron'),
      args: ['.', '--no-sandbox'],
      env: { ...process.env, LOOM_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    });
    page = await app.firstWindow();
    await page.waitForSelector('.node');
    expect(await page.locator('.node').count()).toBe(3);
    await pw(page.locator('.node-title').nth(2)).toHaveValue('From Electron');
  });
});
