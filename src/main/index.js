'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { ensureProfile } = require('./profile');
const { buildDshEnv } = require('./dsh-env');
const { resolveDshBin } = require('./dsh-bin');
const { DshProcess } = require('./dsh-process');
const { installMissingPlugins, installedPlugins, missingPlugins } = require('./plugins');
const { isSupportedDshVersion, MIN_DSH_VERSION } = require('./version');
const {
  backendDownHtml,
  restartingHtml,
  loadingHtml,
  startupErrorHtml,
  toDataUrl,
  ACTION_SCHEME,
} = require('./error-page');
const { buildMenuTemplate } = require('./menu');
const { loadWindowState, trackWindowState } = require('./window-state');

const URL_TIMEOUT_MS = 45_000;
// Smoke mode: launch, wait for the dsh UI to load, print a verdict, quit.
// Exists so a session can verify "the window shows dsh" without a human.
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1';
// e2e mode records external-link opens instead of launching a real browser.
const E2E = process.env.DSH_DESKTOP_E2E === '1';

let mainWindow = null;
let dsh = null;
let dshBin = null;
let dshOrigin = null;
let quitting = false;

function openExternal(url) {
  if (E2E) {
    (global.__externalOpens ??= []).push(url);
    return;
  }
  shell.openExternal(url);
}

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
  app.whenReady().then(startUp).catch((err) => {
    console.error('dsh-desktop failed to start', err);
    startupError('dsh-desktop failed to start', String(err?.stack || err));
  });
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

// Everything the backend needs to run, derived once. DSH_DESKTOP_HOME and
// DSH_DESKTOP_PROFILE exist for tests and unusual setups; the default is an
// app-owned DSH_HOME under userData — the user's ~/.dsh (and the launchd
// service's web profile on port 3080) are never touched.
function backendPaths() {
  const dshHome = process.env.DSH_DESKTOP_HOME || path.join(app.getPath('userData'), 'dsh-home');
  const profileName = process.env.DSH_DESKTOP_PROFILE || 'desktop';
  return {
    dshHome,
    profileName,
    profileDir: path.join(dshHome, 'profiles', profileName),
    env: buildDshEnv({
      baseEnv: process.env,
      dshHome,
      extraPathDirs: ['/opt/homebrew/bin', '/usr/local/bin'],
    }),
  };
}

async function startUp() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ openExternal })));
  createShellWindow();

  dshBin = resolveDshBin({ override: process.env.DSH_DESKTOP_DSH_BIN });
  if (!dshBin) {
    return startupError(
      'dsh not found',
      'No dsh binary at /opt/homebrew/bin/dsh or /usr/local/bin/dsh' +
        (process.env.DSH_DESKTOP_DSH_BIN
          ? ` (and DSH_DESKTOP_DSH_BIN=${process.env.DSH_DESKTOP_DSH_BIN} does not exist).`
          : '.') +
        '\nInstall dsh with: npm install -g @deepseek-ai/dsh'
    );
  }

  const { profileName, profileDir, env } = backendPaths();

  let version;
  try {
    version = await dshVersion(dshBin, env);
  } catch (err) {
    return startupError('dsh failed to run', String(err?.message || err));
  }
  if (version === null) {
    return startupError('dsh failed to run', `${dshBin} --version produced no version.`);
  }
  if (!isSupportedDshVersion(version)) {
    return startupError(
      'dsh too old',
      `This app needs dsh ${MIN_DSH_VERSION} or newer; ${dshBin} is ${version}.\n` +
        'Upgrade with: npm install -g @deepseek-ai/dsh@latest'
    );
  }

  ensureProfile(profileDir);
  if (missingPlugins(profileDir).length > 0) {
    const results = await installMissingPlugins({
      dshBin,
      env,
      profileName,
      profileDir,
      onProgress: (message) => showPage(loadingHtml(message)),
    });
    for (const result of results.filter((r) => !r.ok)) {
      // Boot proceeds with whatever installed; a missing plugin degrades the
      // UI, it does not brick it.
      console.warn(`plugin install failed for ${result.spec}:\n${result.error}`);
    }
    // Self-heal bundles for anything present but not yet listed (an earlier
    // interrupted install, a hand-copied plugin).
    ensureProfile(profileDir, { pluginNames: installedPlugins(profileDir).map((p) => p.name) });
  }

  showPage(loadingHtml('Starting dsh…'));
  const url = await spawnDsh();
  navigateToDsh(url);
}

function dshVersion(bin, env) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], { env, timeout: 15_000 }, (err, stdout) => {
      if (err) reject(new Error(`${bin} --version failed: ${err.message}`));
      else resolve(stdout.trim() || null);
    });
  });
}

// Spawns dsh and resolves with the URL it announces.
function spawnDsh() {
  const { profileName, profileDir, env } = backendPaths();
  ensureProfile(profileDir);

  dsh = new DshProcess({
    command: dshBin,
    args: ['--profile', profileName, '--host', '127.0.0.1', '--port', '0'],
    env,
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
  showPage(backendDownHtml(info, output.slice(-4000)));
}

async function retryBackend() {
  if (!mainWindow) return;
  showPage(restartingHtml());
  try {
    const url = await spawnDsh();
    if (mainWindow) navigateToDsh(url);
  } catch (err) {
    showPage(backendDownHtml({ code: null, signal: null }, String(err?.message || err)));
  }
}

function createShellWindow() {
  const stateDir = app.getPath('userData');
  mainWindow = new BrowserWindow({
    ...loadWindowState(stateDir),
    webPreferences: {
      // The renderer is dsh's web app plus every plugin's client bundle;
      // none of them get Node. Anything needing privilege belongs in this
      // process behind a narrow IPC call.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  trackWindowState(mainWindow, stateDir);

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isExternal(target)) openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    // The app's own action links (from the in-window status pages).
    if (target.startsWith(ACTION_SCHEME)) {
      event.preventDefault();
      const action = target.slice(ACTION_SCHEME.length);
      if (action === 'retry') retryBackend();
      else if (action === 'quit') app.quit();
      return;
    }
    if (isExternal(target)) {
      event.preventDefault();
      openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (SMOKE) {
    // Verdict on the first http(s) page that loads — the data: status pages
    // before it are not the destination.
    mainWindow.webContents.on('did-finish-load', () => {
      const where = mainWindow.webContents.getURL();
      if (!where.startsWith('http')) return;
      console.log(
        dshOrigin && where.startsWith(dshOrigin) ? `SMOKE OK ${where}` : `SMOKE FAIL loaded ${where}`
      );
      app.quit();
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
      if (failedUrl && !failedUrl.startsWith('http')) return;
      console.log(`SMOKE FAIL did-fail-load ${code} ${desc}`);
      app.quit();
    });
  }

  showPage(loadingHtml('Starting dsh…'));
}

function navigateToDsh(url) {
  dshOrigin = new URL(url).origin;
  mainWindow.loadURL(url);
}

function showPage(html) {
  if (mainWindow) mainWindow.loadURL(toDataUrl(html));
}

function startupError(title, message) {
  console.error(`${title}: ${message}`);
  if (SMOKE) {
    console.log(`SMOKE FAIL ${title}: ${message}`.replace(/\n/g, ' | '));
    return app.quit();
  }
  if (!mainWindow) return app.quit();
  showPage(startupErrorHtml(title, message));
}

// External means: leaves the dsh origin and is not one of the app's own
// pages (data: status pages, action links).
function isExternal(target) {
  if (target.startsWith('data:') || target.startsWith(ACTION_SCHEME)) return false;
  try {
    return new URL(target).origin !== dshOrigin;
  } catch {
    return false;
  }
}
