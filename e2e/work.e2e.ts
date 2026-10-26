import { describe, expect, it } from 'vitest';
import { pw, useBrowser } from './harness.js';

const h = useBrowser();
const page = () => h.page();
const column = (name: string) => page().locator(`section.kanban-col[aria-label="${name}"]`);
const openApp = (name: string) => page().click(`.app-link:has-text("${name}")`);

describe('tasks', () => {
  it('captures tasks on a board, moves them between columns and edits their fields', async () => {
    await openApp('Tasks');
    await pw(page().locator('.kanban-col')).toHaveCount(4);
    await page().fill('input[aria-label="Add a task to To do"]', 'Write the report');
    await page().keyboard.press('Enter');
    await pw(column('To do').locator('.task-card')).toContainText('Write the report');
    await page().fill('input[aria-label="Add a task to To do"]', 'Book flights');
    await page().keyboard.press('Enter');
    await pw(column('To do').locator('.task-card')).toHaveCount(2);

    // the status select is the keyboard path; dragging is the pointer path
    await page().selectOption('select[aria-label="Status of Book flights"]', 'in-progress');
    await pw(column('In progress').locator('.task-card')).toContainText('Book flights');
    await column('To do').locator('.task-card', { hasText: 'Write the report' }).dragTo(column('In review'));
    await pw(column('In review').locator('.task-card')).toContainText('Write the report');
    await pw(column('To do').locator('.task-card')).toHaveCount(0);

    // a task is a card: status, priority, assignee, due and subtasks live on its page
    await column('In review').locator('.task-title').click();
    await pw(page().locator('select[aria-label="Task status"]')).toHaveValue('in-review');
    await page().selectOption('select[aria-label="Task priority"]', 'high');
    await page().fill('input[aria-label="Task assignee"]', 'sam');
    await page().keyboard.press('Enter');
    await page().fill('input[aria-label="Task due date"]', '2020-01-02');
    await page().fill('input[aria-label="Add a subtask"]', 'Outline');
    await page().keyboard.press('Enter');
    await pw(page().locator('.subtasks .subtask')).toHaveCount(1);
    await page().click('input[aria-label="Mark Outline done"]');
    await pw(page().locator('.subtasks .count')).toHaveText('1/1');

    await openApp('Tasks');
    const card = column('In review').locator('.task-card', { hasText: 'Write the report' });
    await pw(card).toContainText('high');
    await pw(card.locator('.avatar[title="sam"]')).toHaveText('S');
    await pw(card.locator('.due.overdue')).toHaveText('2020-01-02');
    await pw(card).toContainText('1/1 subtasks');

    // filters and the list view
    await page().selectOption('select[aria-label="Filter by priority"]', 'low');
    await pw(page().locator('.task-card')).toHaveCount(0);
    await page().selectOption('select[aria-label="Filter by priority"]', '');
    await page().check('.tasks-app .check input');
    await pw(page().locator('.task-card')).toHaveCount(1);
    await page().uncheck('.tasks-app .check input');
    await page().click('button:text-is("List")');
    await pw(page().locator('table[aria-label="Task list"] tbody tr')).toHaveCount(3); // two tasks plus the subtask
    expect(h.errors).toEqual([]);
  });

  it('creates a task from the palette with the planning headings and a title ready to type', async () => {
    await page().keyboard.press('Control+k');
    await page().fill('input[aria-label="Command"]', 'new task');
    await page().keyboard.press('Enter');
    await pw(page().locator('input[aria-label="Card title"]')).toHaveValue('New task');
    await pw(page().locator('input[aria-label="Card title"]')).toBeFocused();
    await page().keyboard.type('Plan the launch');
    await pw(page().locator('.ProseMirror h2').first()).toHaveText('Acceptance criteria');
    await pw(page().locator('.card-meta .kind')).toHaveText('task');
    await page().waitForTimeout(600);
    expect((await h.rpc<{ title: string; status: string }[]>('listWorkTasks', {})).map((t) => t.title)).toContain('Plan the launch');
  });
});

describe('memos', () => {
  it('captures with Enter and turns a memo into a task', async () => {
    await openApp('Memos');
    await pw(page().locator('textarea[aria-label="New memo"]')).toBeFocused();
    await page().keyboard.type('Ask Alex about the invoice');
    await page().keyboard.press('Enter');
    await pw(page().locator('.memo-item')).toContainText('Ask Alex about the invoice');
    await pw(page().locator('textarea[aria-label="New memo"]')).toHaveValue('');
    await page().keyboard.type('Second thought');
    await page().keyboard.press('Enter');
    await pw(page().locator('.memo-item')).toHaveCount(2);
    await pw(page().locator('.memo-item').first()).toContainText('Second thought'); // newest first

    await page().fill('input[aria-label="Search memos"]', 'invoice');
    await pw(page().locator('.memo-item')).toHaveCount(1);

    await page().locator('.memo-item').getByRole('button', { name: 'To task' }).click();
    await pw(page().locator('.card-meta .kind')).toHaveText('task');
    await pw(page().locator('input[aria-label="Card title"]')).toHaveValue('Ask Alex about the invoice');
    await openApp('Tasks');
    await pw(column('To do').locator('.task-card')).toContainText('Ask Alex about the invoice');
    expect(h.errors).toEqual([]);
  });
});

describe('saved links', () => {
  it('saves, dedupes and searches links even when the page cannot be read', async () => {
    await openApp('Links');
    await page().fill('input[aria-label="Link address"]', 'news.example.invalid/story?utm_source=feed');
    await page().fill('input[aria-label="Note about the link"]', 'for the roundup');
    await page().click('button:text-is("Save link")');
    await pw(page().locator('.link-card')).toHaveCount(1);
    await pw(page().locator('.link-card')).toContainText('news.example.invalid');
    await pw(page().locator('.link-card')).toContainText('for the roundup');
    await pw(page().locator('.toast, [role="status"]').first()).toContainText('could not be read');

    // the same page again, with tracking noise, is the same link
    await page().fill('input[aria-label="Link address"]', 'https://news.example.invalid/story#top');
    await page().fill('input[aria-label="Note about the link"]', 'second note');
    await page().click('button:text-is("Save link")');
    await pw(page().locator('.toast, [role="status"]').first()).toContainText('Already saved');
    await pw(page().locator('.link-card')).toHaveCount(1);
    await pw(page().locator('.link-card')).toContainText('second note');

    await page().fill('input[aria-label="Search links"]', 'roundup');
    await pw(page().locator('.link-card')).toHaveCount(1);
    await page().fill('input[aria-label="Search links"]', 'nothing-like-this');
    await pw(page().locator('.link-card')).toHaveCount(0);
    await page().fill('input[aria-label="Search links"]', '');

    await page().locator('.link-title').click();
    await pw(page().locator('.card-meta .kind')).toHaveText('link');
    await pw(page().locator('input[aria-label="Link address"]')).toHaveValue('https://news.example.invalid/story?utm_source=feed');
    await pw(page().locator('.link-header a.file-link')).toContainText('news.example.invalid');
    expect(h.errors).toEqual([]);
  });

  it('refuses things that are not web addresses', async () => {
    await page().keyboard.press('Control+k');
    await page().fill('input[aria-label="Command"]', 'save a link');
    await page().keyboard.press('Enter');
    await pw(page().locator('[role="dialog"][aria-label="Save a link"]')).toBeVisible();
    await page().fill('input[aria-label="Web address"]', 'javascript:alert(1)');
    await page().keyboard.press('Enter');
    await pw(page().locator('[role="dialog"][aria-label="Save a link"] [role="alert"]')).toContainText('http');
    await page().click('[role="dialog"] button:text-is("Clip page text")');
    await pw(page().locator('[role="dialog"][aria-label="Clip a web page"]')).toBeVisible();
    await page().keyboard.press('Escape');
    expect((await h.rpc<unknown[]>('listLinks', {})).length).toBe(0);
  });
});
