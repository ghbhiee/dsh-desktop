'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backendAPI', {
  state: () => ipcRenderer.invoke('bp:state'),
  probe: (url) => ipcRenderer.invoke('bp:probe', url),
  connect: (backend) => ipcRenderer.invoke('bp:connect', backend),
});
