import { app, BrowserWindow, ipcMain, protocol, screen, shell, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoreClient } from './core-client.js';
import { LocalServer } from './local-server.js';
import { installMenu } from './menu.js';

const DEV_URL = process.env.LOOM_DEV_URL;
const INDEX = join(__dirname, '../renderer/index.html');
const trustedOrigin = DEV_URL ? new URL(DEV_URL).origin : pathToFileURL(INDEX).href;
// Worker threads load their script straight from disk, so the packaged worker sits outside app.asar.
const WORKER = join(__dirname, 'core-worker.cjs').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

// Attachments are served from loom-file://<sha256>. Registered before ready so media can stream and seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'loom-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// A custom data dir (tests, portable installs) gets its own single-instance lock and Chromium profile.
if (process.env.LOOM_DATA_DIR) app.setPath('userData', process.env.LOOM_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();

let core: CoreClient | undefined;
let localServer: LocalServer | undefined;
let mainWindow: BrowserWindow | undefined;
let rendererReady = false;

// ------------------------------------------------------------------ settings (this device only)

interface Settings {
  window?: { bounds: Rectangle; maximized: boolean };
  localApi?: boolean;
}
const dataDir = (): string => process.env.LOOM_DATA_DIR ?? app.getPath('userData');
const settingsFile = (): string => join(dataDir(), 'settings.json');
function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}
function writeSettings(patch: Partial<Settings>): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch {
    /* settings are a convenience; failing to save them must not break anything */
  }
}

// ------------------------------------------------------------------ deep links: loom://card/<id>

interface DeepLink {
  type: 'card' | 'whiteboard' | 'journal';
  id: string;
}
function parseDeepLink(raw: string | undefined): DeepLink | null {
  if (!raw?.startsWith('loom://')) return null;
  try {
    const url = new URL(raw);
    const type = url.hostname;
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if ((type === 'card' || type === 'whiteboard') && /^[A-Za-z0-9-]{1,100}$/.test(id)) return { type, id };
    if (type === 'journal' && /^\d{4}-\d{2}-\d{2}$/.test(id)) return { type, id };
  } catch {
    /* not a link we understand */
  }
  return null;
}
let pendingLink: DeepLink | null = parseDeepLink(process.argv.find((a) => a.startsWith('loom://')));
function openDeepLink(link: DeepLink | null): void {
  if (!link) return;
  if (!mainWindow || !rendererReady) {
    pendingLink = link;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send('loom-event', { channel: 'open-link', payload: link });
}
if (app.isPackaged || process.env.LOOM_REGISTER_PROTOCOL === '1') app.setAsDefaultProtocolClient('loom');
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLink(parseDeepLink(url));
});

// ------------------------------------------------------------------ local automation API

const localInfoFile = (): string => (process.env.LOOM_DATA_DIR ? join(dataDir(), 'local-server.json') : join(homedir(), '.loom', 'local-server.json'));
interface LocalApiState {
  enabled: boolean;
  port: number | null;
  infoFile: string;
  error: string;
}
let localError = '';
async function setLocalApi(enabled: boolean): Promise<LocalApiState> {
  localError = '';
  try {
    if (enabled) await localServer!.start();
    else await localServer!.stop();
  } catch (err) {
    localError = err instanceof Error ? err.message : String(err);
    enabled = false;
  }
  writeSettings({ localApi: enabled });
  return localApiState();
}
function localApiState(): LocalApiState {
  return { enabled: !!localServer?.running, port: localServer?.running?.port ?? null, infoFile: localInfoFile(), error: localError };
}

// ------------------------------------------------------------------ window

function isExternalUrl(raw: string): boolean {
  try {
    const { protocol: p } = new URL(raw);
    return p === 'https:' || p === 'http:' || p === 'mailto:';
  } catch {
    return false;
  }
}

/** The last size and place, dropping the place if it is on a display that is no longer attached. */
function savedBounds(): { width: number; height: number; x?: number; y?: number; maximized: boolean } | undefined {
  const saved = readSettings().window;
  if (!saved?.bounds) return undefined;
  const b = saved.bounds;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40);
  return { width: b.width, height: b.height, ...(visible ? { x: b.x, y: b.y } : {}), maximized: saved.maximized };
}

function createWindow(): void {
  const saved = savedBounds();
  rendererReady = false;
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#f7f7f5',
    title: 'Loom',
    icon: process.platform === 'darwin' ? undefined : join(__dirname, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow = win;
  if (saved?.maximized) win.maximize();
  const contents = win.webContents;

  // Links open in the OS browser; the app window itself never navigates away.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(trustedOrigin)) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));
  contents.on('did-start-loading', () => (rendererReady = false));

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveBounds = (): void => {
    if (!win.isDestroyed() && !win.isMinimized()) writeSettings({ window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  const saveSoon = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveBounds();
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(INDEX);
  win.on('closed', () => (mainWindow = undefined));
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === trustedOrigin || url.startsWith(`${trustedOrigin}#`) || url.startsWith(`${trustedOrigin}/`) || url.startsWith(`${trustedOrigin}?`);
}
/** Every IPC handler goes through this: only the app's own page may call in. */
function trusted<A extends unknown[], R>(fn: (...args: A) => R) {
  return (event: IpcMainInvokeEvent, ...args: A): R => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender.');
    return fn(...args);
  };
}

app.whenReady().then(async () => {
  mkdirSync(dataDir(), { recursive: true });
  core = new CoreClient(WORKER, dataDir(), (channel, payload) => mainWindow?.webContents.send('loom-event', { channel, payload }));
  localServer = new LocalServer(localInfoFile(), (operation, input) => core!.local(operation, input));

  ipcMain.handle('rpc', trusted((request: unknown) => core!.rpc(request)));
  ipcMain.handle(
    'upload',
    trusted((name: unknown, mime: unknown, bytes: unknown) => {
      if (typeof name !== 'string' || typeof mime !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('Bad upload.');
      return core!.upload(name, mime, bytes);
    }),
  );
  ipcMain.handle('local-api', trusted((enabled: unknown) => (typeof enabled === 'boolean' ? setLocalApi(enabled) : localApiState())));
  // The page says when it can take events; a deep link that arrived during startup is delivered then.
  ipcMain.on('renderer-ready', (event) => {
    if (event.sender !== mainWindow?.webContents || !isTrustedSender(event as unknown as IpcMainInvokeEvent)) return;
    rendererReady = true;
    const link = pendingLink;
    pendingLink = null;
    openDeepLink(link);
  });

  protocol.handle('loom-file', async (request) => {
    const id = new URL(request.url).hostname;
    const res = await core!.file(id, request.headers.get('range'));
    return new Response(res.body as BodyInit | null, { status: res.status, headers: res.headers });
  });

  installMenu((command) => mainWindow?.webContents.send('loom-event', { channel: 'command', payload: command }), { dev: !!DEV_URL });
  createWindow();
  if (readSettings().localApi) await setLocalApi(true);
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
  openDeepLink(parseDeepLink(argv.find((a) => a.startsWith('loom://'))));
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Close the database and remove the API token file before the process goes away.
let quitting = false;
app.on('will-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void Promise.allSettled([localServer?.stop(), core?.close()]).finally(() => app.quit());
});
