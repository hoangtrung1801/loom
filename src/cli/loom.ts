import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `loom`: a small client for the running app's local API. Scripts and agents use it to search,
 * read cards as markdown, and capture notes, memos, tasks and links without touching the database.
 * Turn the API on in Loom → Settings → Local API first.
 */

const HELP = `Usage: loom <command> [options]

Read
  search <query> [--limit N]            Full-text search
  cards [--kind K] [--tag T] [--inbox] [--limit N]
  read <id> | read --title "Title"      A card as markdown
  journal [--date YYYY-MM-DD]           A day's journal (today by default)
  tasks [--status S] [--priority P] [--assignee A] [--label L] [--all] [--overdue]
  links [--tag T] [--query Q]
  tags
  boards                                Whiteboards
  board <id>                            A whiteboard's objects and connections

Capture (text can also come from stdin)
  note <title> [--body MD] [--tag T]... [--no-inbox]
  append <id> [--body MD]               Add markdown to the end of a card
  journal add [text] [--date D]         Add to a day's journal
  memo [text]
  task add <title> [--priority P] [--status S] [--due D] [--assignee A] [--label L]...
  task set <id> [--status S] [--priority P] [--due D] [--assignee A] [--title T]
  link <url> [--note N] [--tag T]...
  tag <id> <tag>

Other
  health                                Is Loom reachable?
  ops                                   List every operation with its input schema
  op <name> [json]                      Run any operation with a JSON input

Options
  --json                                Print raw JSON
  LOOM_SERVER_FILE / LOOM_DATA_DIR      Where to find the running app's connection file`;

const REPEATABLE = new Set(['tag', 'label']);
const BOOLEAN = new Set(['json', 'inbox', 'no-inbox', 'all', 'overdue', 'help']);

interface Args {
  pos: string[];
  flags: Record<string, string | true>;
  lists: Record<string, string[]>;
}

function parse(argv: string[]): Args {
  const out: Args = { pos: [], flags: {}, lists: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      out.pos.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out.pos.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (BOOLEAN.has(key)) {
      out.flags[key] = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Usage(`--${key} needs a value.`);
    if (REPEATABLE.has(key)) (out.lists[key] ??= []).push(value);
    else out.flags[key] = value;
  }
  return out;
}

class Usage extends Error {}

function connection(): { port: number; token: string } {
  const file =
    process.env.LOOM_SERVER_FILE ?? (process.env.LOOM_DATA_DIR ? join(process.env.LOOM_DATA_DIR, 'local-server.json') : join(homedir(), '.loom', 'local-server.json'));
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string };
    if (!Number.isInteger(info.port) || typeof info.token !== 'string') throw new Error('bad file');
    return info;
  } catch {
    throw new Error(`Loom's local API isn't running (no ${file}). Open Loom and turn it on in Settings → Local API.`);
  }
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const { port, token } = connection();
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach Loom on port ${port}. Is the app still running?`);
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `Loom answered ${res.status}.`);
  return data;
}

const run = (name: string, input: Record<string, unknown> = {}): Promise<unknown> =>
  request('POST', `/operations/${name}`, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));

async function stdinText(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trimEnd();
}

/** Text from the arguments, else --body, else whatever was piped in. */
async function text(args: Args, from: number): Promise<string> {
  const inline = args.pos.slice(from).join(' ');
  return inline || (typeof args.flags.body === 'string' ? args.flags.body : '') || (await stdinText());
}

const num = (v: string | true | undefined): number | undefined => (typeof v === 'string' ? Number(v) : undefined);
const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

type Row = Record<string, unknown>;
function table(rows: Row[], cols: string[]): string {
  if (!rows.length) return '(nothing)';
  return rows.map((r) => cols.map((c) => (Array.isArray(r[c]) ? (r[c] as string[]).map((t) => `#${t}`).join(' ') : String(r[c] ?? ''))).filter(Boolean).join('  ')).join('\n');
}

async function main(argv: string[]): Promise<string | unknown> {
  const args = parse(argv);
  const [cmd, sub] = args.pos;
  const f = args.flags;
  if (!cmd || f.help || cmd === 'help') return HELP;

  switch (cmd) {
    case 'health':
      return request('GET', '/health');
    case 'ops':
      return f.json ? request('GET', '/operations') : table((await request('GET', '/operations')) as Row[], ['name', 'description']);
    case 'op': {
      if (!sub) throw new Usage('op needs an operation name.');
      const raw = args.pos.slice(2).join(' ') || (await stdinText()) || '{}';
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new Usage('The input must be JSON.');
      }
      return request('POST', `/operations/${sub}`, input);
    }
    case 'search': {
      const query = args.pos.slice(1).join(' ');
      if (!query) throw new Usage('search needs a query.');
      const hits = (await run('search', { query, limit: num(f.limit) })) as Row[];
      return f.json ? hits : table(hits, ['id', 'title', 'snippet']);
    }
    case 'cards': {
      const rows = (await run('listCards', { kind: str(f.kind), tag: str(f.tag), inbox: f.inbox ? true : undefined, limit: num(f.limit) })) as Row[];
      return f.json ? rows : table(rows, ['id', 'kind', 'title', 'tags']);
    }
    case 'read': {
      const card = (await run('readCard', sub ? { id: sub } : { title: str(f.title) })) as Row;
      return f.json ? card : `# ${card.title || 'Untitled'}\n\n${card.markdown}`;
    }
    case 'journal': {
      if (sub === 'add') {
        const body = await text(args, 2);
        if (!body) throw new Usage('journal add needs some text.');
        return run('appendToJournal', { date: str(f.date), markdown: body });
      }
      const day = (await run('readJournal', { date: str(f.date) })) as Row;
      return f.json ? day : day.markdown || `(nothing written on ${day.journalDate})`;
    }
    case 'tasks': {
      const rows = (await run('listTasks', { status: str(f.status), priority: str(f.priority), assignee: str(f.assignee), label: args.lists.label?.[0], includeDone: f.all ? true : undefined, overdue: f.overdue ? true : undefined })) as Row[];
      return f.json ? rows : table(rows, ['id', 'status', 'priority', 'due', 'title', 'labels']);
    }
    case 'links': {
      const rows = (await run('listLinks', { tag: str(f.tag), query: str(f.query) })) as Row[];
      return f.json ? rows : table(rows, ['id', 'title', 'url', 'tags']);
    }
    case 'tags':
      return f.json ? run('listTags') : table((await run('listTags')) as Row[], ['tag', 'count']);
    case 'boards':
      return f.json ? run('listWhiteboards') : table((await run('listWhiteboards')) as Row[], ['id', 'name']);
    case 'board': {
      if (!sub) throw new Usage('board needs a whiteboard id.');
      return run('readWhiteboard', { id: sub });
    }
    case 'note': {
      if (!sub) throw new Usage('note needs a title.');
      const body = typeof f.body === 'string' ? f.body : await stdinText();
      return run('createNote', { title: sub, markdown: body || undefined, tags: args.lists.tag, inbox: f['no-inbox'] ? false : undefined });
    }
    case 'append': {
      if (!sub) throw new Usage('append needs a card id.');
      const body = await text(args, 2);
      if (!body) throw new Usage('append needs some markdown.');
      return run('appendToCard', { id: sub, markdown: body });
    }
    case 'memo': {
      const body = await text(args, 1);
      if (!body) throw new Usage('memo needs some text.');
      return run('addMemo', { text: body });
    }
    case 'task': {
      const common = { status: str(f.status), priority: str(f.priority), due: str(f.due), assignee: str(f.assignee) };
      if (sub === 'add') {
        const title = args.pos.slice(2).join(' ');
        if (!title) throw new Usage('task add needs a title.');
        return run('createTask', { title, ...common, labels: args.lists.label, description: str(f.body) });
      }
      if (sub === 'set') {
        const id = args.pos[2];
        if (!id) throw new Usage('task set needs a task id.');
        return run('updateTask', { id, title: str(f.title), ...common });
      }
      throw new Usage('Use "task add" or "task set".');
    }
    case 'link': {
      if (!sub) throw new Usage('link needs an address.');
      return run('saveLink', { url: sub, note: str(f.note), tags: args.lists.tag });
    }
    case 'tag': {
      const tag = args.pos[2];
      if (!sub || !tag) throw new Usage('tag needs a card id and a tag.');
      return run('addTag', { id: sub, tag });
    }
    default:
      throw new Usage(`Unknown command "${cmd}".`);
  }
}

main(process.argv.slice(2)).then(
  (out) => {
    process.stdout.write(`${typeof out === 'string' ? out : JSON.stringify(out, null, 2)}\n`);
  },
  (err: unknown) => {
    process.stderr.write(`loom: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Usage) process.stderr.write('Run "loom help" for the commands.\n');
    process.exitCode = err instanceof Usage ? 2 : 1;
  },
);
