import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRpc } from '../core/rpc.js';
import { Store } from '../core/store.js';

const DEV_URL = process.env.LOOM_DEV_URL;
const INDEX = join(__dirname, '../renderer/index.html');
const trustedOrigin = DEV_URL ? new URL(DEV_URL).origin : pathToFileURL(INDEX).href;

// A custom data dir (tests, portable installs) gets its own single-instance lock and Chromium profile.
if (process.env.LOOM_DATA_DIR) app.setPath('userData', process.env.LOOM_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();

let store: Store | undefined;
let mainWindow: BrowserWindow | undefined;

function isExternalUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 760,
    minHeight: 480,
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
  const rpc = createRpc(store);

  ipcMain.handle('rpc', (event, request: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender.');
    return rpc(request);
  });

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
