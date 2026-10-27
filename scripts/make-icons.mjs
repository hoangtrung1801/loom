// Renders the app icons from assets/brand/loom-mark.svg (run after changing the logo):
//   build/icon.png      1024px, full-bleed tile (Linux, Windows, window icon)
//   build/icon-mac.png  1024px, tile inset to Apple's 824px grid with a soft shadow
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync(new URL('../assets/brand/loom-mark.svg', import.meta.url), 'utf8');
const page = (inner) => `<!doctype html><style>html,body{margin:0;background:transparent}</style>${inner}`;
// CHROMIUM_PATH lets you point at an installed browser when Playwright's own download is missing.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await tab.setContent(page(svg.replace('<svg ', '<svg style="display:block;width:1024px;height:1024px" ')));
await tab.screenshot({ path: 'build/icon.png', omitBackground: true });
await tab.setContent(page(`<div style="padding:100px">${svg.replace('<svg ', '<svg style="display:block;width:824px;height:824px;filter:drop-shadow(0 10px 14px rgba(0,0,0,.28))" ')}</div>`));
await tab.screenshot({ path: 'build/icon-mac.png', omitBackground: true });
await browser.close();
