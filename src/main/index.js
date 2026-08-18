'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');

const { ensureProfile } = require('./profile');
const { buildDshEnv } = require('./dsh-env');
const { resolveDshBin } = require('./dsh-bin');
const { DshProcess } = require('./dsh-process');

const URL_TIMEOUT_MS = 45_000;
// Smoke mode: launch, wait for the dsh UI to load, print a verdict, quit.
// Exists so a session can verify "the window shows dsh" without a human.
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1';

let mainWindow = null;
let dsh = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  main();
}

function main() {
  app.whenReady().then(startUp).catch((err) => fatal('dsh-desktop failed to start', err));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting) return;
    if (dsh && dsh.running) {
      event.preventDefault();
      quitting = true;
      dsh.stop().then(() => app.quit());
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.quit());
  }
}

async function startUp() {
  const dshBin = resolveDshBin({ override: process.env.DSH_DESKTOP_DSH_BIN });
  if (!dshBin) {
    return fatal(
      'dsh not found',
      new Error(
        'No dsh binary at /opt/homebrew/bin/dsh or /usr/local/bin/dsh.\n' +
          'Install dsh (npm install -g @deepseek-ai/dsh) or set DSH_DESKTOP_DSH_BIN.'
      )
    );
  }
  const url = await spawnDsh(dshBin);
  createWindow(url);
}

// Spawns dsh and resolves with the URL it announces. The app owns a private
// DSH_HOME under userData — the user's ~/.dsh (and the launchd service's web
// profile on port 3080) are never touched.
function spawnDsh(dshBin) {
  const dshHome = path.join(app.getPath('userData'), 'dsh-home');
  const profileName = process.env.DSH_DESKTOP_PROFILE || 'desktop';
  ensureProfile(path.join(dshHome, 'profiles', profileName));

  dsh = new DshProcess({
    command: dshBin,
    args: ['--profile', profileName, '--host', '127.0.0.1', '--port', '0'],
    env: buildDshEnv({
      baseEnv: process.env,
      dshHome,
      extraPathDirs: ['/opt/homebrew/bin', '/usr/local/bin'],
    }),
  });

  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `dsh did not announce a URL within ${URL_TIMEOUT_MS / 1000}s.\n\nRecent output:\n${dsh.recentOutput}`
        )
      );
    }, URL_TIMEOUT_MS);
    dsh.once('url', (url) => {
      clearTimeout(timer);
      resolve(url);
    });
    dsh.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  dsh.on('exit', (info) => {
    if (!info.expected && !quitting) onUnexpectedExit(dshBin, info);
  });

  dsh.start();
  return urlPromise;
}

// dsh died under us: never a blank window — say what happened, offer a retry.
async function onUnexpectedExit(dshBin, info) {
  const detail =
    `dsh exited (code ${info.code}, signal ${info.signal}).\n\n` +
    `Recent output:\n${(dsh?.recentOutput || '').slice(-2000)}`;
  if (SMOKE) {
    console.log('SMOKE FAIL dsh exited early: ' + detail.replace(/\n/g, ' | '));
    return app.quit();
  }
  const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'error',
    message: 'dsh exited unexpectedly',
    detail,
    buttons: ['Restart dsh', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    try {
      const url = await spawnDsh(dshBin);
      if (mainWindow) mainWindow.loadURL(url);
      else createWindow(url);
    } catch (err) {
      fatal('dsh failed to restart', err);
    }
  } else {
    app.quit();
  }
}

function createWindow(url) {
  const dshOrigin = new URL(url).origin;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // The renderer is dsh's web app plus every plugin's client bundle;
      // none of them get Node. Anything needing privilege belongs in this
      // process behind a narrow IPC call.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (safeOrigin(target) !== dshOrigin) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (safeOrigin(target) !== dshOrigin) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => {
      const where = mainWindow.webContents.getURL();
      console.log(where.startsWith(dshOrigin) ? `SMOKE OK ${where}` : `SMOKE FAIL loaded ${where}`);
      app.quit();
    });
    mainWindow.webContents.once('did-fail-load', (_e, code, desc) => {
      console.log(`SMOKE FAIL did-fail-load ${code} ${desc}`);
      app.quit();
    });
  }

  mainWindow.loadURL(url);
}

function safeOrigin(target) {
  try {
    return new URL(target).origin;
  } catch {
    return null;
  }
}

async function fatal(message, err) {
  if (SMOKE) {
    console.log(`SMOKE FAIL ${message}: ${err?.message || err}`.replace(/\n/g, ' | '));
  } else {
    dialog.showErrorBox(message, String(err?.message || err));
  }
  if (dsh) await dsh.stop().catch(() => {});
  app.quit();
}
