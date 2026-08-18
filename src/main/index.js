'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const { ensureProfile } = require('./profile');
const { buildDshEnv } = require('./dsh-env');
const { resolveDshBin } = require('./dsh-bin');
const { DshProcess } = require('./dsh-process');
const { backendDownHtml, restartingHtml, toDataUrl, ACTION_SCHEME } = require('./error-page');

const URL_TIMEOUT_MS = 45_000;
// Smoke mode: launch, wait for the dsh UI to load, print a verdict, quit.
// Exists so a session can verify "the window shows dsh" without a human.
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1';

let mainWindow = null;
let dsh = null;
let dshBin = null;
let dshOrigin = null;
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
  // A main-process crash must still not leave a stray dsh behind.
  process.on('uncaughtException', (err) => {
    console.error('uncaught exception in main:', err);
    const finish = () => app.exit(1);
    if (dsh && dsh.running) dsh.stop().then(finish, finish);
    else finish();
  });
}

async function startUp() {
  dshBin = resolveDshBin({ override: process.env.DSH_DESKTOP_DSH_BIN });
  if (!dshBin) {
    return fatal(
      'dsh not found',
      new Error(
        'No dsh binary at /opt/homebrew/bin/dsh or /usr/local/bin/dsh.\n' +
          'Install dsh (npm install -g @deepseek-ai/dsh) or set DSH_DESKTOP_DSH_BIN.'
      )
    );
  }
  const url = await spawnDsh();
  createWindow(url);
}

// Spawns dsh and resolves with the URL it announces. The app owns a private
// DSH_HOME under userData — the user's ~/.dsh (and the launchd service's web
// profile on port 3080) are never touched.
function spawnDsh() {
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
    if (!info.expected && !quitting) onUnexpectedExit(info);
  });

  dsh.start();
  return urlPromise;
}

// dsh died under us: never a blank window — the window itself says what
// happened and offers a restart.
function onUnexpectedExit(info) {
  const output = dsh?.recentOutput || '';
  if (SMOKE) {
    console.log(
      `SMOKE FAIL dsh exited early (code ${info.code}, signal ${info.signal}): ` +
        output.slice(-500).replace(/\n/g, ' | ')
    );
    return app.quit();
  }
  if (!mainWindow) return app.quit();
  mainWindow.loadURL(toDataUrl(backendDownHtml(info, output.slice(-4000))));
}

async function retryBackend() {
  if (!mainWindow) return;
  mainWindow.loadURL(toDataUrl(restartingHtml()));
  try {
    const url = await spawnDsh();
    if (!mainWindow) return;
    dshOrigin = new URL(url).origin;
    mainWindow.loadURL(url);
  } catch (err) {
    if (!mainWindow) return;
    mainWindow.loadURL(
      toDataUrl(backendDownHtml({ code: null, signal: null }, String(err?.message || err)))
    );
  }
}

function createWindow(url) {
  dshOrigin = new URL(url).origin;
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
    if (isExternal(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    // The app's own action links (from the in-window error pages).
    if (target.startsWith(ACTION_SCHEME)) {
      event.preventDefault();
      const action = target.slice(ACTION_SCHEME.length);
      if (action === 'retry') retryBackend();
      else if (action === 'quit') app.quit();
      return;
    }
    if (isExternal(target)) {
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

// External means: leaves the dsh origin and is not one of the app's own
// pages (data: error pages, dshdesk: actions).
function isExternal(target) {
  if (target.startsWith('data:') || target.startsWith(ACTION_SCHEME)) return false;
  try {
    return new URL(target).origin !== dshOrigin;
  } catch {
    return false;
  }
}

async function fatal(message, err) {
  console.error(message, err);
  if (SMOKE) {
    console.log(`SMOKE FAIL ${message}: ${err?.message || err}`.replace(/\n/g, ' | '));
  } else {
    const { dialog } = require('electron');
    dialog.showErrorBox(message, String(err?.message || err));
  }
  if (dsh) await dsh.stop().catch(() => {});
  app.quit();
}
