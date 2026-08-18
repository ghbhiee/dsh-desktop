'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The plugin-manager page's entire capability surface. Nothing else from
// Node or Electron reaches the renderer.
contextBridge.exposeInMainWorld('pluginAPI', {
  state: () => ipcRenderer.invoke('pm:state'),
  preview: (input) => ipcRenderer.invoke('pm:preview', input),
  install: (input) => ipcRenderer.invoke('pm:install', input),
  copy: (text) => ipcRenderer.invoke('pm:copy', text),
});
