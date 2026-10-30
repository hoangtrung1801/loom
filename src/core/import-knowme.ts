import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_PRIORITIES, TASK_STATUSES } from './kinds.js';
import { markdownToContent } from './markdown.js';
import type { Store } from './store.js';
import { Work } from './work.js';

/**
 * Imports a Know-Me workspace (the `.knowns` folder of a Know-Me repository) into a Loom library:
 *
 *   tasks/ and archive/   → task cards (status, priority, labels, subtasks, acceptance criteria, plan, notes)
 *   links/                → link cards (title, description, note, tags; preview images are not downloaded)
 *   memos/                → memo cards
 *   docs/                 → note cards
 *
 * Every card gets an id derived from its Know-Me source, so running the import again skips what is already
 * there instead of duplicating it. Original creation, update and completion times are kept. Chats, time
 * tracking and task version history have no Loom equivalent and are left behind.
 */

export interface ImportReport {
  tasks: number;
  links: number;
  memos: number;
  docs: number;
  /** Already imported earlier, or a duplicate within the source. */
  skipped: number;
  /** Sources that could not be read, with the reason. */
  problems: string[];
}

interface FrontMatter {
  data: Record<string, string | string[]>;
  body: string;
}

/** The small YAML subset Know-Me writes: flat `key: value` pairs, quoted strings, `[]`, and `- item` lists. */
export function parseFrontMatter(text: string): FrontMatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey = '';
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    if (raw === '' ) {
      data[key] = [];
      listKey = key;
    } else if (raw === '[]') {
      data[key] = [];
      listKey = '';
    } else {
      data[key] = unquote(raw);
      listKey = '';
    }
  }
  return { data, body: m[2]! };
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : []);
const time = (v: string | string[] | undefined): number | null => {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? null : t;
};

/** A stable UUID-shaped id for a Know-Me source, so re-imports find their own cards. */
function stableId(...parts: string[]): string {
  const h = createHash('sha1').update(`knowme\0${parts.join('\0')}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const section = (body: string, name: string): string => new RegExp(`<!-- ${name}:BEGIN -->([\\s\\S]*?)<!-- ${name}:END -->`).exec(body)?.[1]?.trim() ?? '';

const slug = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function readDir(dir: string, ext: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];
}

export function importKnowMe(store: Store, source: string): ImportReport {
  const report: ImportReport = { tasks: 0, links: 0, memos: 0, docs: 0, skipped: 0, problems: [] };
  const work = new Work(store);
  const exists = (id: string): boolean => !!store.get('SELECT 1 AS x FROM cards WHERE id = ?', id);
  const read = (path: string): string => readFileSync(path, 'utf8');
  const stamps: { id: string; created: number | null; updated: number | null; completed?: number }[] = [];
  const stamp = (id: string, created: number | null, updated: number | null, completed?: number): void => void stamps.push({ id, created, updated, completed });

  const projects = new Map<string, string>(); // project id → tag
  try {
    for (const p of JSON.parse(read(join(source, 'registry.json'))) as { id?: string; name?: string }[]) if (p.id && p.name) projects.set(p.id, slug(p.name));
  } catch {
    /* no registry */
  }
  for (const f of existsSync(join(source, 'projects')) ? readdirSync(join(source, 'projects')) : []) {
    try {
      const cfg = JSON.parse(read(join(source, 'projects', f, 'config.json'))) as { id?: string; name?: string };
      if (cfg.name) projects.set(cfg.id ?? f, slug(cfg.name));
    } catch {
      /* a project without a readable config just gets no tag */
    }
  }
  const projectTag = (id: string): string[] => (projects.get(id) ? [projects.get(id)!] : []);

  const addTags = (id: string, tags: string[]): void => {
    for (const t of tags) if (t.trim()) store.addTag(id, t);
  };

  // ------------------------------------------------------------------ tasks
  const parents: { id: string; project: string; parent: string }[] = [];
  const taskIds = new Set<string>();
  for (const dir of ['tasks', 'archive']) {
    for (const file of readDir(join(source, dir), '.md')) {
      try {
        const { data, body } = parseFrontMatter(read(join(source, dir, file)));
        const title = str(data.title).trim();
        const sourceId = str(data.id);
        if (!title || !sourceId) throw new Error('missing id or title');
        const project = str(data.projectId);
        const id = stableId('task', project, sourceId);
        taskIds.add(id);
        if (exists(id)) {
          report.skipped++;
          continue;
        }
        let status = str(data.status);
        let priority = str(data.priority);
        if (status === 'urgent') {
          status = 'todo';
          priority = 'high';
        }
        if (!(TASK_STATUSES as readonly string[]).includes(status)) status = 'todo';
        if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) priority = 'medium';

        const parts = [section(body, 'SECTION:DESCRIPTION')];
        const criteria = section(body, 'AC').replace(/^(\s*- \[[ xX]\]) #\d+\s+/gm, '$1 ');
        if (criteria) parts.push(`## Acceptance criteria\n\n${criteria}`);
        const plan = section(body, 'SECTION:PLAN');
        if (plan) parts.push(`## Plan\n\n${plan}`);
        const notes = section(body, 'SECTION:NOTES');
        if (notes) parts.push(`## Notes\n\n${notes}`);

        store.createCard({ id, kind: 'task', title, status, priority, content: markdownToContent(parts.filter(Boolean).join('\n\n')) });
        addTags(id, [...list(data.labels), ...projectTag(project)]);
        const updated = time(data.updatedAt);
        stamp(id, time(data.createdAt), updated, status === 'done' ? (time(data.completedAt) ?? updated ?? Date.now()) : undefined);
        if (str(data.parent)) parents.push({ id, project, parent: str(data.parent) });
        report.tasks++;
      } catch (err) {
        report.problems.push(`${dir}/${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  for (const p of parents) {
    const parent = [stableId('task', p.project, p.parent), stableId('task', '', p.parent)].find((c) => taskIds.has(c));
    if (parent && parent !== p.id) store.patchCard(p.id, { parentId: parent });
  }

  // ------------------------------------------------------------------ links
  for (const file of readDir(join(source, 'links'), '.json')) {
    try {
      const l = JSON.parse(read(join(source, 'links', file))) as Record<string, unknown>;
      const { id, existed } = work.saveLink({
        url: String(l.url ?? ''),
        title: String(l.title ?? ''),
        description: String(l.description ?? ''),
        note: String(l.note ?? ''),
        tags: Array.isArray(l.tags) ? l.tags.map(String) : [],
      });
      if (existed) {
        report.skipped++;
        continue;
      }
      stamp(id, time(String(l.createdAt ?? '')), time(String(l.updatedAt ?? '')));
      report.links++;
    } catch (err) {
      report.problems.push(`links/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ------------------------------------------------------------------ memos
  for (const file of readDir(join(source, 'memos'), '.md')) {
    try {
      const { data, body } = parseFrontMatter(read(join(source, 'memos', file)));
      const text = body.trim();
      if (!text) throw new Error('empty memo');
      const id = stableId('memo', file);
      if (exists(id)) {
        report.skipped++;
        continue;
      }
      store.createCard({ id, kind: 'memo', content: markdownToContent(text) });
      stamp(id, time(data.createdAt), time(data.updatedAt));
      report.memos++;
    } catch (err) {
      report.problems.push(`memos/${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ------------------------------------------------------------------- docs
  const walk = (rel: string): string[] =>
    existsSync(join(source, rel))
      ? readdirSync(join(source, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : e.name.endsWith('.md') ? [`${rel}/${e.name}`] : []))
      : [];
  for (const rel of walk('docs').sort()) {
    try {
      const { data, body } = parseFrontMatter(read(join(source, rel)));
      const parts = rel.split('/').slice(1);
      const title = str(data.title).trim() || (parts.at(-1) ?? rel).replace(/\.md$/, '');
      const id = stableId('doc', rel);
      if (exists(id)) {
        report.skipped++;
        continue;
      }
      // Folders like `docs/pbq7nc--research/seo/…` belong to a project; their names become tags.
      const folders = parts.slice(0, -1).flatMap((f, i) => {
        const m = i === 0 ? /^([a-z0-9]+)--(.+)$/.exec(f) : null;
        return m ? [...projectTag(m[1]!), slug(m[2]!)] : [slug(f)];
      });
      const file = parts.at(-1)!;
      const fileProject = /^([a-z0-9]{6})--/.exec(file)?.[1];
      store.createCard({ id, kind: 'note', title, content: markdownToContent(body.trim()) });
      addTags(id, [...list(data.tags), ...folders, ...(fileProject ? projectTag(fileProject) : [])]);
      stamp(id, time(data.createdAt), time(data.updatedAt));
      report.docs++;
    } catch (err) {
      report.problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Restore the original times last: every write above stamps "now".
  store.tx(() => {
    for (const s of stamps) {
      const fields: Record<string, number> = {};
      if (s.created !== null) fields.created_at = s.created;
      if (s.updated !== null) fields.updated_at = s.updated;
      if (s.completed !== undefined) fields.completed_at = s.completed;
      if (Object.keys(fields).length) store.commit([{ entity: 'card', id: s.id, fields }]);
    }
  });
  return report;
}
