import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockLlm } from '../tests/mock-llm.js';
import { pw, useBrowser } from './harness.js';

const h = useBrowser();
const page = () => h.page();

describe('search, commands and tabs', () => {
  it('searches everything with Ctrl+O, filters by type and opens results', async () => {
    await page().keyboard.press('Control+o');
    await page().fill('input[aria-label="Search everything"]', 'backlinks');
    await pw(page().locator('[cmdk-item]').first()).toContainText('Linking ideas');
    await page().click('.search-filters button:text-is("pdf")');
    await pw(page().locator('.none')).toBeVisible();
    await page().click('.search-filters button:text-is("pdf")');
    await page().fill('input[aria-label="Search everything"]', 'getting');
    await pw(page().locator('[cmdk-item]').first()).toContainText('Getting started'); // whiteboard title
    await page().keyboard.press('Enter');
    await pw(page().locator('.board-title')).toHaveValue('Getting started');
    expect(h.errors).toEqual([]);
  });

  it('finds text that lives on a whiteboard', async () => {
    await page().click('.app-link:has-text("Whiteboards")');
    await page().click('.tree-main');
    await page().waitForSelector('.obj');
    await page().click('button[aria-label="Text"]');
    await page().mouse.click(700, 150);
    await pw(page().locator('textarea[aria-label="Text"]')).toBeFocused();
    await page().keyboard.type('zebra crossing');
    await page().keyboard.press('Control+Enter');
    await pw(page().locator('.text-obj')).toContainText('zebra crossing');
    await page().waitForTimeout(300);
    await page().keyboard.press('Control+o');
    await page().fill('input[aria-label="Search everything"]', 'zebra');
    await pw(page().locator('[cmdk-item]').first()).toContainText('zebra');
    await page().keyboard.press('Enter');
    await pw(page().locator('.obj.selected')).toContainText('zebra crossing');
  });

  it('runs commands from the palette', async () => {
    await page().keyboard.press('Control+k');
    await page().fill('input[aria-label="Command"]', 'new whiteboard');
    await page().keyboard.press('Enter');
    await pw(page().locator('.board-title')).toHaveValue('Untitled whiteboard');
    await page().keyboard.press('Control+k');
    await page().fill('input[aria-label="Command"]', 'settings');
    await page().keyboard.press('Enter');
    await pw(page().locator('.settings h2')).toHaveText('Settings');
  });

  it('manages tabs: new, pin, folders, groups, close', async () => {
    await page().keyboard.press('Control+t');
    await pw(page().locator('.quick-start')).toBeVisible();
    await page().click('.tile:has-text("Today\'s journal")');
    await pw(page().locator('.card-title')).toHaveAttribute('placeholder', /\d{4}-\d{2}-\d{2}/);
    // pin the journal tab through its context menu
    await page().locator('.tab.active').click({ button: 'right' });
    await page().click('[role^="menuitem"]:has-text("Pin tab")');
    await page().locator('.tab.active').click({ button: 'right' });
    await pw(page().locator('[role^="menuitem"]:has-text("Unpin tab")')).toBeVisible();
    await page().keyboard.press('Escape');
    // folder for pinned tabs
    await page().click('button[aria-label="New folder"]');
    await page().keyboard.press('Enter');
    await pw(page().locator('.folder')).toHaveCount(1);
    await page().locator('.tab.active').click({ button: 'right' });
    await page().click('[role^="menuitem"]:has-text("Move to folder")');
    await pw(page().locator('.folder .tab')).toHaveCount(1);
    // a second group keeps its own tabs
    await page().click('button[aria-label="New tab group"]');
    await pw(page().locator('.group')).toHaveCount(2);
    await pw(page().locator('.tab-list .tab')).toHaveCount(1); // a fresh group starts with a blank tab
    await pw(page().locator('.quick-start')).toBeVisible();
    await page().locator('.group').first().click();
    await pw(page().locator('.folder .tab')).toHaveCount(1);
    // tabs survive a reload
    await page().reload();
    await pw(page().locator('.folder .tab')).toHaveCount(1);
    // close with Ctrl+W
    await page().keyboard.press('Control+w');
    await pw(page().locator('.folder .tab')).toHaveCount(0);
  });

  it('uses the right-hand panels for a card', async () => {
    await page().click('.app-link:has-text("Card Library")');
    await page().click('.card-row:has(.title:text-is("Welcome to Loom"))');
    await page().click('button[aria-label="Table of contents"]');
    await pw(page().locator('.rightbar')).toContainText('No headings');
    await page().click('button[aria-label="To-dos"]');
    await pw(page().locator('.rightbar')).toContainText('No to-dos');
    await pw(page().locator('button[aria-label="Related cards"]')).toHaveCount(0); // only offered on whiteboards
    await page().click('button[aria-label="Journal"]');
    await pw(page().locator('.rightbar[aria-label="Journal"]')).toBeVisible();
    await page().click('button[aria-label="Close panel"]');
    await pw(page().locator('.rightbar')).toHaveCount(0);
  });

  it('exports the library as markdown and JSON', async () => {
    await page().click('button[aria-label="Settings"]');
    const md = page().waitForEvent('download');
    await page().click('button:has-text("Export Markdown")');
    const mdFile = await md;
    expect(mdFile.suggestedFilename()).toMatch(/^loom-export-.*\.md$/);
    const text = await (await import('node:fs/promises')).readFile((await mdFile.path())!, 'utf8');
    expect(text).toContain('# Welcome to Loom');
    expect(text).toContain('[[Linking ideas]]');
    const json = page().waitForEvent('download');
    await page().click('button:has-text("Export JSON")');
    const parsed = JSON.parse(await (await import('node:fs/promises')).readFile((await (await json).path())!, 'utf8'));
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.whiteboards).toHaveLength(1);
  });

  it('saves the sync server settings and reports problems', async () => {
    await page().click('button[aria-label="Settings"]');
    await page().fill('input[placeholder="http://localhost:8787"]', 'ftp://nope');
    await page().click('.settings section[aria-label="Sync"] button:has-text("Save")');
    await pw(page().locator('.settings section[aria-label="Sync"]')).toContainText('http');
    await pw(page().locator('.sync-badge')).toContainText('Sync off');
  });
});

describe('AI chat against a mock model', () => {
  let llm: Awaited<ReturnType<typeof mockLlm>>;
  beforeAll(async () => {
    llm = await mockLlm((call) => {
      const messages: { role: string; content?: unknown }[] = call.body.messages ?? [];
      if (JSON.stringify(messages).includes('Research the topic')) return { text: 'Research done.' };
      const toolResults = messages.filter((m) => m.role === 'tool').length;
      if (toolResults === 0) return { tools: [{ name: 'search_notes', args: { query: 'welcome' } }] };
      if (toolResults === 1) return { tools: [{ name: 'read_card', args: { card: 'c1' } }] };
      return { text: 'Cards are notes [c1:1].' };
    });
  });
  afterAll(async () => llm?.close());

  async function configure(): Promise<void> {
    await h.rpc('setAiConfig', { provider: 'openai', model: 'mock', baseUrl: `${llm.url}/v1`, apiKey: 'sk-test' });
  }

  it('answers with citations that open the cited card, and keeps the key private', async () => {
    await configure();
    expect(JSON.stringify(await h.rpc('getAiConfig'))).not.toContain('sk-test');
    await page().click('.app-link:has-text("Chat")');
    await page().click('button[aria-label="Chat"]').catch(() => undefined);
    await page().fill('textarea[aria-label="Message"]', 'What are cards?');
    await page().keyboard.press('Enter');
    await pw(page().locator('.msg.assistant .md').last()).toContainText('Cards are notes');
    await pw(page().locator('.tool-line').first()).toContainText('Searched notes');
    await pw(page().locator('.msg.assistant .cite').first()).toBeVisible();
    await page().locator('.msg.assistant .cite').first().click();
    await pw(page().locator('.tab.active')).toContainText('Welcome to Loom');
    // history persists and shows in the chat list
    await page().click('.app-link:has-text("Chat")');
    await pw(page().locator('.chat-list .card-row').first()).toContainText('What are cards?');
    expect(llm.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('starts research with the topic as context and sends it automatically', async () => {
    await configure();
    await page().click('.research');
    await page().fill('input[aria-label="Topic"]', 'whiteboards');
    await page().keyboard.press('Enter');
    await pw(page().locator('.msg.user').first()).toContainText('Research the topic "whiteboards"');
    await pw(page().locator('.msg.assistant .md').last()).toContainText('Research done');
    await pw(page().locator('.composer .chip-label')).toHaveText('whiteboards');
  });

  it('shows an error when no key is configured', async () => {
    await page().click('.app-link:has-text("Chat")');
    await pw(page().locator('.notice')).toContainText('API key');
  });
});
