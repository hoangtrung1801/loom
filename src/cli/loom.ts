import { appBackend, directBackend, serverInfoFile, type Backend } from './backend.js';

/**
 * `loom`: a command-line client for scripts and agents. It searches, reads, creates, edits and deletes every kind
 * of object in a library: cards of each kind, whiteboards and their objects, connections, tags and their database
 * properties, chats. By default it talks to the running app's local API (Loom → Settings → Local API);
 * with --data-dir it opens a library directly. `loom mcp` serves the same operations to AI agents over MCP.
 */

const HELP = `Usage: loom [--data-dir DIR] <command> [options]

Find and read (any object type)
  find <query> [--type T]... [--kind K] [--sort time] [--limit N]
                                        Search cards, whiteboards, board text, chats and tags
  get <id>                              Any object by id: card, whiteboard, board object,
                                        connection, chat, property, or a tag name
  search <query> [--limit N]            Full-text search over cards only
  cards [--kind K] [--tag T] [--inbox] [--sort updated|created|title] [--limit N]
  read <id> | read --title "Title"      A card as markdown
  journal [--date YYYY-MM-DD]           A day's journal (today by default)
  tasks [--status S] [--priority P] [--assignee A] [--label L] [--all] [--overdue]
  links [--tag T] [--query Q]
  tags                                  Tags with counts
  props <tag>                           A tag as a database: properties and values
  boards                                Whiteboards
  board <id>                            A whiteboard's objects and connections
  chats | chat <id>                     AI chats
  trash                                 Trashed cards and whiteboards

Create (text can also come from stdin)
  create <kind> [title] [--body MD] [--tag T]... [--prop tag.name=value]... [--board ID]
         [--status S] [--priority P] [--due D] [--assignee A] [--parent ID] [--url U] [--date D]
                                        kind: note, memo, task, journal, link, web, highlight
  note <title> [--body MD] [--tag T]... [--no-inbox]
  memo [text]
  task add <title> [--priority P] [--status S] [--due D] [--assignee A] [--label L]...
  link <url> [--note N] [--tag T]...
  journal add [text] [--date D]         Add to a day's journal
  board new <name> [--parent ID]
  board place <board> <card> [--x N --y N] [--section ID]
  board text <board> <text> | board section <board> <title>   [--x N --y N --color C]
  connect <board> <from-object> <to-object> [--label L]
  prop add <tag> <name> [--type T] [--option O]...

Edit
  update <card> [--title T] [--body MD|-] [--kind note|memo|task] [--inbox | --no-inbox]
         [--status S] [--priority P] [--due D] [--assignee A] [--parent ID] [--url U]
         [--add-tag T]... [--remove-tag T]... [--prop tag.name=value]...
                                        --body replaces the whole body ("-" reads stdin)
  append <id> [--body MD]               Add markdown to the end of a card
  task set <id> [--status S] [--priority P] [--due D] [--assignee A] [--title T]
  tag <id> <tag> | untag <id> <tag>
  prop set <card> <tag> <name> <value>  value is text, a number, true/false or a JSON list
  prop rm <tag> <name>
  board rename <id> <name>

Delete
  trash <id>                            Card or whiteboard to the trash
  restore <id>                          Back from the trash

Agents
  mcp [--read-only]                     Serve every operation as MCP tools on stdio
  serve [--init]                        Run the local API without the app (needs --data-dir)
  ops                                   List every operation with its input schema
  op <name> [json]                      Run any operation with a JSON input
  health                                Is Loom reachable?

Options
  --json                                Print raw JSON
  --data-dir DIR                        Work on the library in DIR directly instead of through
                                        the running app (not while the app has it open)
  LOOM_SERVER_FILE / LOOM_DATA_DIR      Where to find the running app's connection file`;
const REPEATABLE = new Set(['tag', 'label', 'type', 'option', 'prop', 'add-tag', 'remove-tag']);
const BOOLEAN = new Set(['json', 'inbox', 'no-inbox', 'all', 'overdue', 'help', 'read-only', 'init']);

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

/** A property value typed on the command line: JSON when it parses (numbers, true/false, lists, null), text otherwise. */
function propValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** `--prop tag.name=value`, repeatable, into `{ tag: { name: value } }`. */
function props(list: string[] | undefined): Record<string, Record<string, unknown>> | undefined {
  if (!list?.length) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const item of list) {
    const m = /^#?([^.=]+)\.([^=]+)=(.*)$/s.exec(item);
    if (!m) throw new Usage(`--prop looks like tag.property=value (got "${item}").`);
    (out[m[1]!.trim()] ??= {})[m[2]!.trim()] = propValue(m[3]!);
  }
  return out;
}

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

  const dataDir = str(f['data-dir']);
  if (cmd === 'serve') {
    if (!dataDir) throw new Usage('serve needs --data-dir (the app serves its own library from Settings → Local API).');
    const backend = await directBackend(dataDir, { init: !!f.init });
    const { serveLocal } = await import('./serve.js');
    await serveLocal(backend, serverInfoFile());
    return undefined;
  }
  const backend: Backend = dataDir ? await directBackend(dataDir, { init: !!f.init }) : appBackend();
  try {
    if (cmd === 'mcp') {
      const { serveMcp } = await import('./mcp.js');
      await serveMcp(backend, { readOnly: !!f['read-only'] });
      return undefined;
    }
    return await command(backend, args, cmd, sub, f);
  } finally {
    await backend.close();
  }
}

async function command(backend: Backend, args: Args, cmd: string, sub: string | undefined, f: Args['flags']): Promise<unknown> {
  const run = async (name: string, input: Record<string, unknown> = {}): Promise<unknown> => {
    const out = await backend.call(name, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    if (out.status >= 400) throw new Error((out.body as { error?: string } | null)?.error ?? `Loom answered ${out.status}.`);
    return out.body;
  };

  switch (cmd) {
    case 'health':
      return backend.health();
    case 'ops': {
      const ops = await backend.operations();
      return f.json ? ops : table(ops.map((o) => ({ ...o, name: o.write ? o.name : `${o.name} (read)` })), ['name', 'description']);
    }
    case 'op': {
      if (!sub) throw new Usage('op needs an operation name.');
      const raw = args.pos.slice(2).join(' ') || (await stdinText()) || '{}';
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        throw new Usage('The input must be JSON.');
      }
      return run(sub, input as Record<string, unknown>);
    }

    // ------------------------------------------------------------- read
    case 'find': {
      const query = args.pos.slice(1).join(' ');
      if (!query) throw new Usage('find needs a query.');
      const hits = (await run('searchAll', { query, types: args.lists.type, kinds: f.kind ? [str(f.kind)] : undefined, sort: str(f.sort), limit: num(f.limit) })) as Row[];
      return f.json ? hits : table(hits, ['type', 'id', 'kind', 'title', 'snippet']);
    }
    case 'get': {
      if (!sub) throw new Usage('get needs an id.');
      const obj = (await run('getObject', { id: sub })) as Row;
      return !f.json && obj.type === 'card' ? `# ${obj.title || 'Untitled'}\n\n${obj.markdown}` : obj;
    }
    case 'search': {
      const query = args.pos.slice(1).join(' ');
      if (!query) throw new Usage('search needs a query.');
      const hits = (await run('search', { query, limit: num(f.limit) })) as Row[];
      return f.json ? hits : table(hits, ['id', 'title', 'snippet']);
    }
    case 'cards': {
      const rows = (await run('listCards', { kind: str(f.kind), tag: str(f.tag) ?? args.lists.tag?.[0], inbox: f.inbox ? true : undefined, sort: str(f.sort), limit: num(f.limit) })) as Row[];
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
      const rows = (await run('listLinks', { tag: str(f.tag) ?? args.lists.tag?.[0], query: str(f.query) })) as Row[];
      return f.json ? rows : table(rows, ['id', 'title', 'url', 'tags']);
    }
    case 'tags':
      return f.json ? run('listTags') : table((await run('listTags')) as Row[], ['tag', 'count']);
    case 'props': {
      if (!sub) throw new Usage('props needs a tag.');
      return run('readTag', { tag: sub });
    }
    case 'boards':
      return f.json ? run('listWhiteboards') : table((await run('listWhiteboards')) as Row[], ['id', 'name']);
    case 'chats':
      return f.json ? run('listChats') : table((await run('listChats')) as Row[], ['id', 'title', 'preview']);
    case 'chat': {
      if (!sub) throw new Usage('chat needs a chat id.');
      return run('readChat', { id: sub });
    }

    // ----------------------------------------------------------- create
    case 'create': {
      if (!sub) throw new Usage('create needs a kind: note, memo, task, journal, link, web or highlight.');
      const rest = args.pos.slice(2).join(' ');
      const body = typeof f.body === 'string' ? f.body : await stdinText();
      const titleless = sub === 'memo' || sub === 'journal';
      return run('createCard', {
        kind: sub,
        title: titleless ? undefined : rest || str(f.title),
        markdown: (titleless ? rest || body : body) || undefined,
        url: sub === 'link' ? rest || str(f.url) : str(f.url),
        tags: args.lists.tag,
        properties: props(args.lists.prop),
        whiteboardId: str(f.board),
        status: str(f.status),
        priority: str(f.priority),
        due: str(f.due),
        assignee: str(f.assignee),
        parentId: str(f.parent),
        date: str(f.date),
        inbox: f['no-inbox'] ? false : undefined,
      });
    }
    case 'note': {
      if (!sub) throw new Usage('note needs a title.');
      const body = typeof f.body === 'string' ? f.body : await stdinText();
      return run('createNote', { title: sub, markdown: body || undefined, tags: args.lists.tag, inbox: f['no-inbox'] ? false : undefined });
    }
    case 'memo': {
      const body = await text(args, 1);
      if (!body) throw new Usage('memo needs some text.');
      return run('addMemo', { text: body });
    }
    case 'link': {
      if (!sub) throw new Usage('link needs an address.');
      return run('saveLink', { url: sub, note: str(f.note), tags: args.lists.tag });
    }
    case 'connect': {
      const [, board, from, to] = args.pos;
      if (!board || !from || !to) throw new Usage('connect needs a whiteboard id and two object ids.');
      return run('createConnection', { whiteboardId: board, from, to, label: str(f.label) });
    }
    case 'board':
      return boardCommand(run, args, sub, f);
    case 'prop':
      return propCommand(run, args, sub, f);

    // ------------------------------------------------------------- edit
    case 'update': {
      if (!sub) throw new Usage('update needs a card id.');
      const body = f.body === '-' ? await stdinText() : str(f.body);
      return run('updateCard', {
        id: sub,
        title: str(f.title),
        markdown: body,
        kind: str(f.kind),
        inbox: f.inbox ? true : f['no-inbox'] ? false : undefined,
        status: str(f.status),
        priority: str(f.priority),
        due: str(f.due),
        assignee: str(f.assignee),
        parentId: str(f.parent),
        url: str(f.url),
        description: str(f.description),
        addTags: args.lists['add-tag'],
        removeTags: args.lists['remove-tag'],
        properties: props(args.lists.prop),
      });
    }
    case 'append': {
      if (!sub) throw new Usage('append needs a card id.');
      const body = await text(args, 2);
      if (!body) throw new Usage('append needs some markdown.');
      return run('appendToCard', { id: sub, markdown: body });
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
    case 'tag':
    case 'untag': {
      const tag = args.pos[2];
      if (!sub || !tag) throw new Usage(`${cmd} needs a card id and a tag.`);
      return run(cmd === 'tag' ? 'addTag' : 'removeTag', { id: sub, tag });
    }

    // ----------------------------------------------------------- delete
    case 'trash': {
      if (!sub) {
        const t = (await run('listTrash')) as { cards: Row[]; whiteboards: Row[] };
        return f.json ? t : `Cards\n${table(t.cards, ['id', 'kind', 'title'])}\n\nWhiteboards\n${table(t.whiteboards, ['id', 'name'])}`;
      }
      const obj = (await run('getObject', { id: sub })) as Row;
      if (obj.type === 'card') return run('trashCard', { id: sub });
      if (obj.type === 'whiteboard') return run('trashWhiteboard', { id: sub });
      throw new Usage(`"${sub}" is a ${String(obj.type)}; only cards and whiteboards go to the trash. Use "op" for the others (ops lists them).`);
    }
    case 'restore': {
      if (!sub) throw new Usage('restore needs an id.');
      const trash = (await run('listTrash')) as { cards: Row[]; whiteboards: Row[] };
      if (trash.whiteboards.some((w) => w.id === sub)) return run('restoreWhiteboard', { id: sub });
      return run('restoreCard', { id: sub });
    }
    default:
      throw new Usage(`Unknown command "${cmd}".`);
  }
}

type RunOp = (name: string, input?: Record<string, unknown>) => Promise<unknown>;

async function boardCommand(run: RunOp, args: Args, sub: string | undefined, f: Args['flags']): Promise<unknown> {
  const [, , a, b] = args.pos;
  const place = { x: num(f.x), y: num(f.y), color: str(f.color) };
  switch (sub) {
    case undefined:
      throw new Usage('board needs a whiteboard id, or new / place / text / section / rename.');
    case 'new':
      if (!a) throw new Usage('board new needs a name.');
      return run('createWhiteboard', { name: args.pos.slice(2).join(' '), parentId: str(f.parent) });
    case 'rename':
      if (!a || !b) throw new Usage('board rename needs a whiteboard id and a name.');
      return run('updateWhiteboard', { id: a, name: args.pos.slice(3).join(' ') });
    case 'place':
      if (!a || !b) throw new Usage('board place needs a whiteboard id and a card id.');
      return run('addCardToWhiteboard', { whiteboardId: a, cardId: b, x: place.x, y: place.y, sectionId: str(f.section) });
    case 'text':
    case 'section': {
      const body = args.pos.slice(3).join(' ');
      if (!a || !body) throw new Usage(`board ${sub} needs a whiteboard id and some text.`);
      return run('addWhiteboardObject', { whiteboardId: a, kind: sub, text: body, ...place });
    }
    default:
      return run('readWhiteboard', { id: sub });
  }
}

async function propCommand(run: RunOp, args: Args, sub: string | undefined, f: Args['flags']): Promise<unknown> {
  const [, , a, b, c, ...rest] = args.pos;
  switch (sub) {
    case 'add':
      if (!a || !b) throw new Usage('prop add needs a tag and a property name.');
      return run('addTagProperty', { tag: a, name: args.pos.slice(3).join(' '), type: str(f.type) ?? args.lists.type?.[0], options: args.lists.option });
    case 'set':
      if (!a || !b || !c || !rest.length) throw new Usage('prop set needs a card id, a tag, a property name and a value.');
      return run('setCardProperty', { id: a, tag: b, property: c, value: propValue(rest.join(' ')) });
    case 'rm':
      if (!a || !b) throw new Usage('prop rm needs a tag and a property name.');
      return run('removeTagProperty', { tag: a, property: args.pos.slice(3).join(' ') });
    default:
      throw new Usage('Use "prop add", "prop set" or "prop rm".');
  }
}

main(process.argv.slice(2)).then(
  (out) => {
    if (out !== undefined) process.stdout.write(`${typeof out === 'string' ? out : JSON.stringify(out, null, 2)}\n`);
  },
  (err: unknown) => {
    process.stderr.write(`loom: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Usage) process.stderr.write('Run "loom help" for the commands.\n');
    process.exitCode = err instanceof Usage ? 2 : 1;
  },
);
