'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const { classifyBackendUrl } = require('./probe');
const { scanLocalDshPorts } = require('./detect-local');

// The backend picker window: managed (our own dsh), a detected local dsh,
// or a typed URL. Same shape as the plugin manager — sandboxed page, a
// preload exposing exactly three calls.

let pickerWindow = null;
let handlersRegistered = false;

// getContext(): { currentBackend, managedChildPid, applyBackend }
function registerBackendPicker(getContext) {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('bp:state', async () => {
    const { currentBackend, managedChildPid } = getContext();
    const candidates = await scanLocalDshPorts({
      excludePids: managedChildPid ? [managedChildPid] : [],
    });
    const detected = [];
    for (const candidate of candidates) {
      const url = `http://127.0.0.1:${candidate.port}`;
      const probe = await classifyBackendUrl(url, { timeoutMs: 2000 });
      if (probe.kind === 'dsh') detected.push({ url, port: candidate.port, pid: candidate.pid });
    }
    return { current: currentBackend, detected };
  });

  ipcMain.handle('bp:probe', (_event, url) => classifyBackendUrl(url));

  ipcMain.handle('bp:connect', async (_event, backend) => {
    const { applyBackend } = getContext();
    return applyBackend(backend);
  });
}

function openBackendPickerWindow(parent) {
  if (pickerWindow) {
    pickerWindow.focus();
    return pickerWindow;
  }
  const E2E = process.env.DSH_DESKTOP_E2E === '1';
  pickerWindow = new BrowserWindow({
    width: 620,
    height: 560,
    parent: parent ?? undefined,
    title: '连接后端',
    show: !E2E,
    webPreferences: {
      backgroundThrottling: !E2E,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'backend-picker.js'),
    },
  });
  pickerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'backend-picker.html'));
  pickerWindow.on('closed', () => {
    pickerWindow = null;
  });
  return pickerWindow;
}

module.exports = { registerBackendPicker, openBackendPickerWindow };
