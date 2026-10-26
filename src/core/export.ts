import { docToMarkdown } from './doc.js';
import { priorityOf, statusOf, TASK_STATUS_LABELS } from './kinds.js';
import type { CardDetail, Store } from './store.js';

export interface ExportFile {
  name: string;
  mime: string;
  text: string;
}

/** Whole-library export. Markdown is for reading elsewhere; JSON keeps everything needed to rebuild the library. */
export function exportAll(store: Store, format: 'markdown' | 'json'): ExportFile {
  const stamp = new Date().toISOString().slice(0, 10);
  const cards = store.listCards({ limit: 5000, sort: 'title' }).map((summary) => store.getCard(summary.id)!).filter(Boolean);
  const titles = new Map(cards.map((c) => [c.id, c.title]));
  if (format === 'json') {
    const boards = store.listWhiteboards().map((b) => store.getWhiteboard(b.id)).filter(Boolean);
    const data = {
      app: 'loom',
      exportedAt: new Date().toISOString(),
      cards: cards.map((c) => ({
        id: c.id, title: c.title, kind: c.kind, journalDate: c.journalDate, tags: c.tags, createdAt: c.createdAt, updatedAt: c.updatedAt, content: safeParse(c.content),
        ...(c.kind === 'task' ? { status: statusOf(c.status), priority: priorityOf(c.priority), assignee: c.assignee, due: c.due, parentId: c.parentId, completedAt: c.completedAt } : {}),
        ...(c.kind === 'link' ? { url: c.url, meta: safeParse(c.meta) } : {}),
      })),
      whiteboards: boards,
      tags: store.listTags(),
    };
    return { name: `loom-export-${stamp}.json`, mime: 'application/json', text: JSON.stringify(data, null, 2) };
  }
  const parts = cards.map((c) => {
    const body = docToMarkdown(c.content, (id) => titles.get(id)).lines.map((l) => l.text).join('\n');
    const tags = c.tags.length ? `\n${c.tags.map((t) => `#${t}`).join(' ')}\n` : '';
    const heading = c.title || (c.kind === 'journal' ? c.journalDate : c.kind === 'memo' ? firstWords(body) : 'Untitled');
    return `# ${heading}\n${tags}${facts(c)}\n${body}`.trimEnd();
  });
  return { name: `loom-export-${stamp}.md`, mime: 'text/markdown', text: parts.join('\n\n---\n\n') + '\n' };
}

function safeParse(s: string): unknown {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

const firstWords = (body: string): string => body.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Memo';

/** A line of structured facts under a task's or link's heading, so the Markdown export keeps them. */
function facts(c: CardDetail): string {
  if (c.kind === 'task') {
    const parts = [`Status: ${TASK_STATUS_LABELS[statusOf(c.status)]}`, `Priority: ${priorityOf(c.priority)}`];
    if (c.assignee) parts.push(`Assignee: ${c.assignee}`);
    if (c.due) parts.push(`Due: ${c.due}`);
    return `\n${parts.join(' · ')}\n`;
  }
  if (c.kind === 'link') {
    const description = (safeParse(c.meta) as { description?: string } | null)?.description;
    return `\n<${c.url}>\n${description ? `\n${description}\n` : ''}`;
  }
  return '';
}
