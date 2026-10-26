import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export type MenuCommand = 'new-card' | 'new-tab' | 'close-tab' | 'search' | 'palette' | 'clip' | 'save-link' | 'new-task' | 'sync' | 'settings';

/**
 * The application menu. Without one, macOS binds Cmd+W to "Close Window" and Cmd+N to nothing, so tab and
 * card shortcuts never reach the page. On macOS the menu owns these keys and tells the page which command ran;
 * elsewhere the accelerator is display-only (`registerAccelerator: false`) and the page's own key handler runs it,
 * so a shortcut never fires twice.
 */
export function installMenu(send: (command: MenuCommand) => void, options: { dev: boolean }): void {
  const mac = process.platform === 'darwin';
  const item = (label: string, accelerator: string | undefined, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: mac,
    click: () => send(command),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, item('Settings…', 'CmdOrCtrl+,', 'settings'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        item('New Card', 'CmdOrCtrl+N', 'new-card'),
        item('New Tab', 'CmdOrCtrl+T', 'new-tab'),
        item('Close Tab', 'CmdOrCtrl+W', 'close-tab'),
        { type: 'separator' },
        item('New Task', undefined, 'new-task'),
        item('Save Link…', undefined, 'save-link'),
        item('Clip Web Page…', undefined, 'clip'),
        item('Sync Now', undefined, 'sync'),
        ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, item('Settings', undefined, 'settings'), { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Go',
      submenu: [item('Search Everything…', 'CmdOrCtrl+O', 'search'), item('Command Palette…', 'CmdOrCtrl+K', 'palette')],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
        ...(options.dev ? [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
