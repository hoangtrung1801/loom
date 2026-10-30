import { existsSync } from 'node:fs';
import { expect as pw } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

// CHROME_PATH wins; otherwise the first browser found in the usual image locations, else Playwright's own lookup.
const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

export interface Harness {
  page(): Page;
  url(): string;
  rpc<T>(method: string, ...args: unknown[]): Promise<T>;
  errors: string[];
}
export { pw };

/** Boots the dev server with an in-memory database and gives every test a fresh seeded page. */
export function useBrowser(options: { open?: boolean } = {}): Harness {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let context: BrowserContext | undefined;
  let url = '';
  const errors: string[] = [];

  beforeAll(async () => {
    process.env.LOOM_DB = ':memory:';
    process.env.LOOM_E2E = '1';
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { port: 0, strictPort: false } });
    await server.listen();
    url = server.resolvedUrls!.local[0]!;
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });
  afterEach(() => {
    expect(errors, 'the page logged errors').toEqual([]);
  });
  beforeEach(async () => {
    await context?.close();
    errors.length = 0;
    const ctx = (context = await browser.newContext({ viewport: { width: 1400, height: 860 } }));
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // Failed RPCs are expected in tests that check error handling; everything else on the console is a bug.
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console: ${m.text()}`));
    // Registering listeners makes Playwright intercept native dialogs/file choosers instead of leaving them blocking input.
    page.on('dialog', (d) => void d.dismiss());
    page.on('filechooser', () => undefined);
    expect((await page.request.post(`${url}__reset`, { headers: { 'x-loom': '1' } })).status()).toBe(204);
    await page.goto(url);
    await page.waitForSelector('.sidebar');
    if (options.open !== false) await page.waitForSelector('.tabbody');
  });

  return {
    page: () => page,
    url: () => url,
    errors,
    rpc: (method, ...args) =>
      page.evaluate(
        async ([m, a]) => {
          const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-loom': '1' }, body: JSON.stringify({ method: m, args: a }) });
          const body = await res.json();
          if (body && typeof body === 'object' && 'error' in body) throw new Error(String(body.error));
          return body;
        },
        [method, args] as const,
      ) as Promise<never>,
  };
}
