// Dev helper: boots the dev server and screenshots the main screens. Usage: bun scripts/smoke.mjs <outDir>
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const out = process.argv[2] ?? '.dev/shots';
process.env.LOOM_DB = ':memory:';
process.env.LOOM_E2E = '1';
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(url);
await page.waitForSelector('.sidebar');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-start.png` });
for (const [name, label] of [['inbox', 'Inbox'], ['journal', 'Journal'], ['whiteboards', 'Whiteboards'], ['library', 'Card Library'], ['tags', 'Tag Database']]) {
  await page.click(`.app-link:has-text("${label}")`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/2-${name}.png` });
}
await page.click('.app-link:has-text("Whiteboards")');
await page.click('.tree-main');
await page.waitForSelector('.obj');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-board.png` });
await page.click('.obj.card-obj header strong');
await page.screenshot({ path: `${out}/4-selected.png` });
await page.locator('.card-obj').first().dblclick();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/5-editing.png` });
await page.keyboard.press('Escape');
await page.click('button[aria-label="Chat"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/6-chat.png` });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
await server.close();
