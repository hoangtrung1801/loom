import { contextBridge, ipcRenderer } from 'electron';

// The only capability the page gets: send a named request to the main process.
contextBridge.exposeInMainWorld('loom', {
  rpc: (request: unknown): Promise<unknown> => ipcRenderer.invoke('rpc', request),
});
