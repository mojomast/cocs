// eslint-disable-next-line @typescript-eslint/no-require-imports -- sandboxed preload scripts cannot use ESM imports; Electron requires CommonJS here
const { contextBridge, ipcRenderer } = require('electron');

const steam = Object.freeze({
  available: false,
  invoke: (method, params) =>
    ipcRenderer.invoke('cocs:steam:invoke', { method: String(method), params: params ?? null }),
});

const api = Object.freeze({
  platform: typeof process !== 'undefined' ? process.platform : null,
  getVersion: () => ipcRenderer.invoke('cocs:app:version'),
  ping: () => ipcRenderer.invoke('cocs:app:ping'),
  getPlatform: () => ipcRenderer.invoke('cocs:app:platform'),
  steam,
});

contextBridge.exposeInMainWorld('cocs', api);
