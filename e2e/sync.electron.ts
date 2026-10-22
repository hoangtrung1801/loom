import { expect as pw } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
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
  await page.waitForSelector('.node');
  return page;
}

async function connect(page: Page, token: string): Promise<void> {
  await page.locator('.sync > button').click();
  await page.getByLabel('Server URL').fill(serverUrl);
  await page.getByLabel(/Access token/).fill(token);
  await page.getByRole('button', { name: 'Save' }).click();
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
    await pw(a.locator('.sync .msg')).toContainText('401');
    await a.getByLabel(/Access token/).fill('e2e-token');
    await a.getByRole('button', { name: 'Save' }).click();
    await pw(a.locator('.sync .msg')).toContainText('Synced');

    await connect(b, 'e2e-token');
    await pw(b.locator('.sync .msg')).toContainText('Synced');
    // demo content seeded independently on both devices must not be duplicated
    await pw(b.locator('.sidebar .list').first().locator('li')).toHaveCount(1);
    await pw(b.locator('.node')).toHaveCount(2);

    // A creates a card; B receives it without a restart
    await a.mouse.dblclick(500, 770);
    await a.waitForFunction(() => document.querySelectorAll('.node').length === 3);
    const node = a.locator('.node').last();
    await node.locator('.node-title').fill('Made on device A');
    await node.locator('.ProseMirror').click();
    await a.keyboard.type('hello from the other side');
    await a.waitForTimeout(900);
    await a.getByRole('button', { name: 'Sync now' }).click();
    await pw(a.locator('.sync .msg')).toContainText('Synced');

    await b.getByRole('button', { name: 'Sync now' }).click();
    await pw(b.locator('.node')).toHaveCount(3);
    await pw(b.locator('.node-title').nth(2)).toHaveValue('Made on device A');
    await pw(b.locator('.node').nth(2).locator('.ProseMirror')).toContainText('hello from the other side');

    // and B can find it with search
    await b.keyboard.press('Control+k');
    await b.keyboard.type('other side');
    await pw(b.locator('.cards .card-row').first().locator('.title')).toHaveText('Made on device A');

    // B edits the same card; A sees the change
    await b.keyboard.press('Escape');
    await b.locator('.node').nth(2).locator('.node-title').fill('Renamed on B');
    await b.waitForTimeout(900);
    await b.getByRole('button', { name: 'Sync now' }).click();
    await a.getByRole('button', { name: 'Sync now' }).click();
    await pw(a.locator('.node-title').nth(2)).toHaveValue('Renamed on B');
  });
});
