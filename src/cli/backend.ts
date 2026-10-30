import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the CLI and the MCP server send operations. Either the running app's local API
 * (the default: the app stays the only writer), or the library opened directly in this
 * process (`--data-dir`, for machines and agents without the app running).
 */
export interface OperationInfo {
  name: string;
  description: string;
  write: boolean;
  destructive: boolean;
  input: Record<string, unknown>;
}

export interface Backend {
  /** Never throws for refusals from Loom: they come back as a non-2xx status and `{ error }`. */
  call(operation: string, input: unknown): Promise<{ status: number; body: unknown }>;
  operations(): Promise<OperationInfo[]>;
  health(): Promise<unknown>;
  close(): Promise<void>;
  describe: string;
}

export const serverInfoFile = (): string =>
  process.env.LOOM_SERVER_FILE ?? (process.env.LOOM_DATA_DIR ? join(process.env.LOOM_DATA_DIR, 'local-server.json') : join(homedir(), '.loom', 'local-server.json'));

function connection(): { port: number; token: string } {
  const file = serverInfoFile();
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string };
    if (!Number.isInteger(info.port) || typeof info.token !== 'string') throw new Error('bad file');
    return info;
  } catch {
    throw new Error(
      `Loom's local API isn't running (no ${file}). Open Loom and turn it on in Settings → Local API, ` +
        `or work on a library directly with --data-dir (the app keeps it in ${defaultDataDir()}).`,
    );
  }
}

/** Talks to the running app over HTTP on 127.0.0.1. The connection file is read per request, so an app restart is picked up. */
export function appBackend(): Backend {
  const send = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
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
    return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
  };
  const must = async (method: 'GET' | 'POST', path: string): Promise<unknown> => {
    const out = await send(method, path);
    if (out.status >= 400) throw new Error((out.body as { error?: string } | null)?.error ?? `Loom answered ${out.status}.`);
    return out.body;
  };
  return {
    describe: 'the running Loom app',
    call: (operation, input) => send('POST', `/operations/${operation}`, input ?? {}),
    operations: async () => (await must('GET', '/operations')) as OperationInfo[],
    health: () => must('GET', '/health'),
    close: async () => undefined,
  };
}

/** The data directory the desktop app uses on this machine (packaged builds are "Loom", development runs "loom"). */
export function defaultDataDir(): string {
  if (process.env.LOOM_DATA_DIR) return process.env.LOOM_DATA_DIR;
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  const candidates = [join(base, 'Loom'), join(base, 'loom')];
  return candidates.find((d) => existsSync(join(d, 'library', 'loom.json'))) ?? candidates[0]!;
}

/**
 * Electron's single-instance lock leaves `SingletonLock -> <host>-<pid>` in the data directory while the app runs
 * (Linux and macOS). Two writers on one library would overwrite each other's files, so the direct mode backs off.
 */
export function appHoldsLibrary(dataDir: string): number | null {
  try {
    const pid = Number(/-(\d+)$/.exec(readlinkSync(join(dataDir, 'SingletonLock')))?.[1]);
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Opens the library in this process. Loaded lazily so the plain HTTP client never pulls in the database. */
export async function directBackend(dataDir: string, options: { init?: boolean } = {}): Promise<Backend> {
  const pid = appHoldsLibrary(dataDir);
  if (pid) {
    throw new Error(`Loom is running on ${dataDir} (pid ${pid}). Use the app's local API instead (drop --data-dir), or quit the app first.`);
  }
  const hasLibrary = existsSync(join(dataDir, 'library', 'loom.json')) || existsSync(join(dataDir, 'loom.db'));
  if (!hasLibrary && !options.init) {
    throw new Error(`No Loom library in ${dataDir}. Pass --init to create one there.`);
  }
  // Node flags its built-in SQLite as experimental on first load; that line is noise in a CLI's output.
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (!String(warning instanceof Error ? warning.message : warning).includes('SQLite')) (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  const { openHeadless } = await import('./headless.js');
  const core = openHeadless(dataDir);
  return {
    describe: `the library in ${dataDir}`,
    call: core.call,
    operations: async () => core.operations() as OperationInfo[],
    health: async () => ({ ok: true, app: 'loom', mode: 'direct', dataDir }),
    close: async () => core.close(),
  };
}
