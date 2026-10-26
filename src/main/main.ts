import { app, BrowserWindow, ipcMain, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildApp, createRpc, type App } from '../core/rpc.js';
import { serveFile } from '../core/serve-file.js';
import { Store } from '../core/store.js';
import { installMenu } from './menu.js';

const DEV_URL = process.env.LOOM_DEV_URL;
const INDEX = join(__dirname, '../renderer/index.html');
const trustedOrigin = DEV_URL ? new URL(DEV_URL).origin : pathToFileURL(INDEX).href;

// Attachments are served from loom-file://<sha256>. Registered before ready so media can stream and seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'loom-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// A custom data dir (tests, portable installs) gets its own single-instance lock and Chromium profile.
if (process.env.LOOM_DATA_DIR) app.setPath('userData', process.env.LOOM_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();

let store: Store | undefined;
let core: App | undefined;
let mainWindow: BrowserWindow | undefined;

function isExternalUrl(raw: string): boolean {
  try {
    const { protocol: p } = new URL(raw);
    return p === 'https:' || p === 'http:' || p === 'mailto:';
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#1b1c1f',
    title: 'Loom',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  const contents = mainWindow.webContents;

  // Links open in the OS browser; the app window itself never navigates away.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(trustedOrigin)) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(INDEX);
  mainWindow.on('closed', () => (mainWindow = undefined));
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url === trustedOrigin || url.startsWith(`${trustedOrigin}#`) || url.startsWith(`${trustedOrigin}/`) || url.startsWith(`${trustedOrigin}?`);
}

app.whenReady().then(() => {
  const dir = process.env.LOOM_DATA_DIR ?? app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  store = new Store(join(dir, 'loom.db'));
  store.seedIfEmpty();
  core = buildApp(store, {
    filesDir: join(dir, 'files'),
    emit: (channel, payload) => mainWindow?.webContents.send('loom-event', { channel, payload }),
  });
  const rpc = createRpc(core);

  ipcMain.handle('rpc', (event, request: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender.');
    return rpc(request);
  });
  ipcMain.handle('upload', (event, name: unknown, mime: unknown, bytes: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender.');
    if (typeof name !== 'string' || typeof mime !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('Bad upload.');
    return core!.files.put(bytes, { name, mime });
  });

  protocol.handle('loom-file', (request) => {
    const id = new URL(request.url).hostname;
    const res = serveFile(core!.files, id, request.headers.get('range'));
    return new Response(res.body as BodyInit | null, { status: res.status, headers: res.headers });
  });

  installMenu((command) => mainWindow?.webContents.send('loom-event', { channel: 'command', payload: command }), { dev: !!DEV_URL });
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => store?.close());
