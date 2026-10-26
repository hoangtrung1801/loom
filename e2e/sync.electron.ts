import { expect as pw } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSyncServer } from '../server/sync-server.js';

const dirs: string[] = [];
const apps: ElectronApplication[] = [];
const server = createSyncServer({ token: 'e2e-token' });
let serverUrl = '';

async function launch(): Promise<Page> {
  const dir = mkdtempSync(join(tmpdir(), 'loom-device-'));
  dirs.push(dir);
  const app = await electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOOM_DATA_DIR: dir, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.waitForSelector('.sidebar');
  return page;
}

const section = (page: Page) => page.locator('section[aria-label="Sync"]');
const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const rpc = <T>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => window.loom!.rpc({ method: m as string, args: a as unknown[] }), [method, args]) as Promise<T>;

async function openSync(page: Page): Promise<void> {
  if (!(await section(page).isVisible())) await page.locator('.sync-badge').click();
}
async function connect(page: Page, token: string): Promise<void> {
  await openSync(page);
  await page.getByLabel('Server URL').fill(serverUrl);
  await page.getByLabel('Token').fill(token);
  await section(page).getByRole('button', { name: 'Save' }).click();
}
async function syncNow(page: Page): Promise<void> {
  await openSync(page);
  await section(page).getByRole('button', { name: 'Sync now' }).click();
  await pw(section(page)).toContainText('Synced');
}

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  server.close();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('two Electron devices syncing through a server', () => {
  it('rejects a wrong token with a readable error, then converges once connected', async () => {
    const a = await launch();
    const b = await launch();

    await connect(a, 'wrong');
    await section(a).getByRole('button', { name: 'Sync now' }).click();
    await pw(section(a)).toContainText('401');
    await a.getByLabel('Token').fill('e2e-token');
    await section(a).getByRole('button', { name: 'Save' }).click();
    await syncNow(a);

    await connect(b, 'e2e-token');
    await syncNow(b);
    // demo content seeded independently on both devices must not be duplicated
    expect(await rpc<{ name: string }[]>(b, 'listWhiteboards')).toHaveLength(1);

    // A creates a card; B receives it without a restart
    const id = await rpc<string>(a, 'createCard', { title: 'Made on device A', content: doc('hello from the other side') });
    await syncNow(a);
    await syncNow(b);
    await b.click('.app-link:has-text("Card Library")');
    await pw(b.locator('.card-row .title:text-is("Made on device A")')).toBeVisible();

    // and B can find it with global search
    await b.keyboard.press('Control+o');
    await b.fill('input[aria-label="Search everything"]', 'other side');
    await pw(b.locator('.result').first()).toContainText('Made on device A');
    await b.keyboard.press('Escape');

    // B edits the same card; A sees the change
    await rpc(b, 'updateCard', id, { title: 'Renamed on B' });
    await syncNow(b);
    await syncNow(a);
    await a.click('.app-link:has-text("Card Library")');
    await pw(a.locator('.card-row .title:text-is("Renamed on B")')).toBeVisible();
  });
});
