import { contextBridge, ipcRenderer } from 'electron';

// The page's whole view of the system: named requests, file uploads, and events pushed from the core.
contextBridge.exposeInMainWorld('loom', {
  rpc: (request: unknown): Promise<unknown> => ipcRenderer.invoke('rpc', request),
  upload: (name: string, mime: string, bytes: Uint8Array): Promise<string> => ipcRenderer.invoke('upload', name, mime, bytes),
  onEvent: (listener: (event: { channel: string; payload: unknown }) => void): (() => void) => {
    const wrapped = (_e: unknown, event: { channel: string; payload: unknown }): void => listener(event);
    ipcRenderer.on('loom-event', wrapped);
    return () => ipcRenderer.removeListener('loom-event', wrapped);
  },
});
