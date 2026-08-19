'use strict';

const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { ensureProfile, copyTemplateNodeModules } = require('./profile');
const { buildDshEnv } = require('./dsh-env');
const { resolveDshRuntime } = require('./dsh-bin');
const { dshInvocation } = require('./dsh-command');
const { DshProcess } = require('./dsh-process');
const { installMissingPlugins, installedPlugins, missingPlugins } = require('./plugins');
const { registerPluginManager, openPluginManagerWindow } = require('./plugin-manager');
const { registerBackendPicker, openBackendPickerWindow } = require('./backend-picker');
const { loadBackendConfig, saveBackendConfig } = require('./backend-config');
const { classifyBackendUrl } = require('./probe');
const { sessionIsLive, claimPairCode } = require('./remote');
const { isSupportedDshVersion, MIN_DSH_VERSION } = require('./version');
const {
  backendDownHtml,
  restartingHtml,
  loadingHtml,
  startupErrorHtml,
  pairingHtml,
  toDataUrl,
  ACTION_SCHEME,
} = require('./error-page');
const { buildMenuTemplate } = require('./menu');
const { loadWindowState, trackWindowState } = require('./window-state');
const { loadPreferredPort, savePreferredPort } = require('./port-store');

const URL_TIMEOUT_MS = 45_000;
// Smoke mode: launch, wait for the dsh UI to load, print a verdict, quit.
// Exists so a session can verify "the window shows dsh" without a human.
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1';
// e2e mode records external-link opens instead of launching a real browser.
const E2E = process.env.DSH_DESKTOP_E2E === '1';

let mainWindow = null;
let dsh = null;
let dshRuntime = null;
let dshOrigin = null;
let quitting = false;
let currentBackend = { type: 'managed' };

// Breadcrumbs for backend transitions — cheap, and the only way to see
// where a headless flow stalled (tests read global.__backendTrace).
function trace(entry) {
  (global.__backendTrace ??= []).push(`${Date.now() % 1e7} ${entry}`);
  console.log('[backend]', entry);
}

function openExternal(url) {
  if (E2E) {
    (global.__externalOpens ??= []).push(url);
    return;
  }
  shell.openExternal(url);
}

// An alternate userData relocates everything derived from it — the
// single-instance lock, window state, and the default DSH_HOME — so tests
// (and any parallel deployment) can coexist with a running instance.
if (process.env.DSH_DESKTOP_USERDATA) {
  app.setPath('userData', process.env.DSH_DESKTOP_USERDATA);
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
    // The flag flips on the first quit no matter how far startup got: any
    // still-pending async startup step checks it before spawning.
    quitting = true;
    if (dsh && dsh.running) {
      event.preventDefault();
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        openExternal,
        onManagePlugins: () => openPluginManagerWindow(mainWindow),
        onRestartBackend: () => restartBackend(),
        onBackendPicker: () => openBackendPickerWindow(mainWindow),
      })
    )
  );
  registerPluginManager(() => ({
    runtime: dshRuntime,
    backendType: currentBackend.type,
    ...backendPaths(),
    restartBackend,
  }));
  registerBackendPicker(() => ({
    currentBackend,
    managedChildPid: dsh?.child?.pid ?? null,
    applyBackend,
  }));
  createShellWindow();

  currentBackend = loadBackendConfig(app.getPath('userData'));
  await applyBackend(currentBackend, { persist: false });
}

// Point the window at a backend. Managed spawns our own dsh; attach probes
// an already-running one and connects with no child process at all. The
// choice persists in userData so the next launch goes straight there.
async function applyBackend(backend, { persist = true } = {}) {
  if (quitting) return { ok: false, error: 'quit in progress' };

  if (backend.type === 'managed') {
    currentBackend = backend;
    if (persist) saveBackendConfig(app.getPath('userData'), backend);
    await startManaged();
    return { ok: true };
  }

  if (backend.type === 'attach') {
    trace(`attach:probe-start ${backend.url}`);
    await showPage(loadingHtml(`正在连接 ${backend.url}…`));
    const probe = await classifyBackendUrl(backend.url);
    trace(`attach:probe ${probe.kind} ${probe.detail || ''}`);
    if (probe.kind !== 'dsh') {
      const why =
        probe.kind === 'gateway'
          ? '这个地址是认证网关（远程模式尚未实现）'
          : probe.kind === 'unreachable'
            ? `无法连接：${probe.detail || '目标不可达'}`
            : '目标不是 dsh 服务';
      showPage(startupErrorHtml('无法连接后端', `${backend.url}\n${why}`));
      return { ok: false, error: why };
    }
    currentBackend = { type: 'attach', url: probe.origin };
    if (persist) saveBackendConfig(app.getPath('userData'), currentBackend);
    if (dsh && dsh.running) await dsh.stop();
    dshOrigin = probe.origin;
    trace(`attach:loadURL ${probe.origin}`);
    if (mainWindow) mainWindow.loadURL(probe.origin + '/');
    return { ok: true };
  }

  if (backend.type === 'remote') {
    trace(`remote:start ${backend.url}`);
    await showPage(loadingHtml(`正在连接 ${backend.url}…`));
    const probe = await classifyBackendUrl(backend.url);
    trace(`remote:probe ${probe.kind}`);
    if (probe.kind === 'dsh') {
      // A remote dsh with no auth wrapper behaves exactly like attach.
      return applyBackend({ type: 'attach', url: probe.origin }, { persist });
    }
    if (probe.kind !== 'gateway') {
      const why =
        probe.kind === 'unreachable'
          ? `无法连接：${probe.detail || '目标不可达'}`
          : '目标既不是 dsh 也不是认证网关';
      showPage(startupErrorHtml('无法连接远程后端', `${backend.url}\n${why}`));
      return { ok: false, error: why };
    }

    currentBackend = { type: 'remote', url: probe.origin };
    if (persist) saveBackendConfig(app.getPath('userData'), currentBackend);
    if (dsh && dsh.running) await dsh.stop();

    const stored = await storedRemoteCookie(probe.origin);
    if (stored && (await sessionIsLive(probe.origin, stored))) {
      trace('remote:session-live');
      dshOrigin = probe.origin;
      if (mainWindow) mainWindow.loadURL(probe.origin + '/');
      return { ok: true };
    }
    trace('remote:pairing-needed');
    await startPairing(probe.origin);
    return { ok: true, pairing: true };
  }

  const error = `后端类型 ${backend.type} 尚未实现`;
  showPage(startupErrorHtml('无法连接后端', error));
  return { ok: false, error };
}

// ---- remote pairing ----
// The passkey ceremony cannot happen in Electron (no macOS platform
// authenticator — verified), so it runs in the system browser; the browser
// shows a one-time code, the in-window form collects it, and the claim
// endpoint swaps it for a session cookie of our own, persisted in the
// app's cookie store.

async function storedRemoteCookie(origin) {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: origin, name: 'dsh_auth' });
    return cookies[0] ? { name: cookies[0].name, value: cookies[0].value } : null;
  } catch {
    return null;
  }
}

async function startPairing(origin, { error } = {}) {
  openExternal(origin + '/auth?pair=1');
  await showPage(pairingHtml(origin, { error }));
}

async function completePairing(code) {
  if (currentBackend.type !== 'remote') return;
  const origin = currentBackend.url;
  try {
    const cookie = await claimPairCode(origin, code);
    trace('remote:pair-claimed');
    await session.defaultSession.cookies.set({
      url: origin,
      name: cookie.name,
      value: cookie.value,
      httpOnly: true,
      secure: origin.startsWith('https:'),
      sameSite: 'lax',
      // An explicit expiration makes Electron persist it to disk — that is
      // what survives a relaunch. Fall back to the gateway's 24h.
      expirationDate: cookie.expires || Math.floor(Date.now() / 1000) + 24 * 3600,
    });
    await session.defaultSession.cookies.flushStore().catch(() => {});
    dshOrigin = origin;
    if (mainWindow) mainWindow.loadURL(origin + '/');
  } catch (err) {
    trace(`remote:pair-failed ${err.message}`);
    await showPage(pairingHtml(origin, { error: String(err?.message || err) }));
  }
}

async function startManaged() {
  dshRuntime = resolveDshRuntime({
    override: process.env.DSH_DESKTOP_DSH_BIN,
    bundledDir: process.env.DSH_DESKTOP_BUNDLED_DIR || process.resourcesPath,
  });
  if (!dshRuntime) {
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
  const dshName = dshRuntime.bin || 'bundled dsh';

  let version;
  try {
    version = await dshVersion(dshRuntime, env);
  } catch (err) {
    return startupError('dsh failed to run', String(err?.message || err));
  }
  if (version === null) {
    return startupError('dsh failed to run', `${dshName} --version produced no version.`);
  }
  if (!isSupportedDshVersion(version)) {
    return startupError(
      'dsh too old',
      `This app needs dsh ${MIN_DSH_VERSION} or newer; ${dshName} is ${version}.\n` +
        'Upgrade with: npm install -g @deepseek-ai/dsh@latest'
    );
  }

  if (quitting) return;
  ensureProfile(profileDir);
  if (missingPlugins(profileDir).length > 0) {
    if (dshRuntime.type === 'bundled') {
      // Mode A machines have neither pnpm nor network guarantees: plugins
      // arrive by copying the pre-populated template shipped in resources.
      showPage(loadingHtml('Setting up plugins…'));
      copyTemplateNodeModules(dshRuntime.templateDir, profileDir);
    } else {
      const results = await installMissingPlugins({
        runtime: dshRuntime,
        env,
        profileName,
        profileDir,
        onProgress: (message) => showPage(loadingHtml(message)),
      });
      for (const result of results.filter((r) => !r.ok)) {
        // Boot proceeds with whatever installed; a missing plugin degrades
        // the UI, it does not brick it.
        console.warn(`plugin install failed for ${result.spec}:\n${result.error}`);
      }
    }
    // Self-heal bundles for anything present but not yet listed (an earlier
    // interrupted install, a hand-copied plugin, the template copy above).
    ensureProfile(profileDir, { pluginNames: installedPlugins(profileDir).map((p) => p.name) });
  }

  if (quitting) return;
  showPage(loadingHtml('Starting dsh…'));
  const url = await spawnBackend();
  if (!quitting) navigateToDsh(url);
}

// Reuse the port dsh got last time so the origin — and the web UI's
// origin-keyed state with it — stays stable across launches. A taken port
// makes dsh exit with EADDRINUSE (verified; it never picks another by
// itself), so that failure falls back to an OS-assigned one.
async function spawnBackend() {
  const { dshHome, profileName } = backendPaths();
  const preferred = loadPreferredPort(dshHome, profileName);
  if (preferred) {
    try {
      return await spawnDsh(preferred);
    } catch (err) {
      if (quitting) throw err;
      console.warn(
        `preferred port ${preferred} unavailable, retrying with an OS-assigned one: ` +
          String(err?.message || err).split('\n')[0]
      );
    }
  }
  return spawnDsh(0);
}

function dshVersion(runtime, env) {
  const inv = dshInvocation(runtime, ['--version'], { baseEnv: env });
  return new Promise((resolve, reject) => {
    execFile(inv.command, inv.args, { env: inv.env, timeout: 15_000 }, (err, stdout) => {
      if (err) reject(new Error(`dsh --version failed: ${err.message}`));
      else resolve(stdout.trim() || null);
    });
  });
}

// Spawns dsh on the given port (0 = OS-assigned) and resolves with the URL
// it announces; the announced port becomes the profile's preference. A death
// before the announcement rejects here (a spawn failure the caller may retry
// differently); one after it is an unexpected exit the window must explain.
// Refuses to spawn into a quit already in progress — an async startup step
// resuming after before-quit ran must not orphan a fresh child.
function spawnDsh(port) {
  if (quitting) return Promise.reject(new Error('quit in progress'));
  const { dshHome, profileName, profileDir, env } = backendPaths();
  ensureProfile(profileDir);

  const inv = dshInvocation(
    dshRuntime,
    ['--profile', profileName, '--host', '127.0.0.1', '--port', String(port)],
    { baseEnv: env }
  );
  const proc = (dsh = new DshProcess({ command: inv.command, args: inv.args, env: inv.env }));

  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `dsh did not announce a URL within ${URL_TIMEOUT_MS / 1000}s.\n\nRecent output:\n${proc.recentOutput}`
        )
      );
    }, URL_TIMEOUT_MS);
    proc.once('url', (url) => {
      clearTimeout(timer);
      savePreferredPort(dshHome, profileName, Number(new URL(url).port));
      resolve(url);
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (info) => {
      if (!proc.url) {
        clearTimeout(timer);
        reject(
          new Error(
            `dsh exited before announcing a URL (code ${info.code}, signal ${info.signal}).\n\n` +
              proc.recentOutput.slice(-1000)
          )
        );
      } else if (!info.expected && !quitting) {
        onUnexpectedExit(info);
      }
    });
  });

  proc.start();
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
  if (currentBackend.type !== 'managed') {
    await applyBackend(currentBackend, { persist: false });
    return;
  }
  showPage(restartingHtml());
  try {
    const url = await spawnBackend();
    if (mainWindow) navigateToDsh(url);
  } catch (err) {
    showPage(backendDownHtml({ code: null, signal: null }, String(err?.message || err)));
  }
}

// Graceful in-place backend restart (plugin installed, config changed):
// stop the child, spawn again — the preferred port keeps the origin, the
// window reloads, the app never exits.
let restartingBackend = false;
async function restartBackend() {
  if (restartingBackend || quitting) return;
  restartingBackend = true;
  try {
    if (currentBackend.type !== 'managed') {
      // Attached targets are not ours to restart — reconnect instead.
      await applyBackend(currentBackend, { persist: false });
      return;
    }
    if (!dshRuntime) return;
    showPage(restartingHtml());
    if (dsh && dsh.running) await dsh.stop();
    const url = await spawnBackend();
    if (!quitting && mainWindow) navigateToDsh(url);
  } catch (err) {
    showPage(backendDownHtml({ code: null, signal: null }, String(err?.message || err)));
  } finally {
    restartingBackend = false;
  }
}

function createShellWindow() {
  const stateDir = app.getPath('userData');
  mainWindow = new BrowserWindow({
    ...loadWindowState(stateDir),
    // e2e drives windows over CDP; keeping them hidden stops them stealing
    // focus (and collecting the user's keystrokes) mid-test run.
    show: !E2E,
    webPreferences: {
      backgroundThrottling: !E2E,
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
    // The app's own action links and forms (from the in-window status
    // pages) — routed by sentinel-URL path, parameters in the query.
    if (target.startsWith(ACTION_SCHEME)) {
      event.preventDefault();
      const action = new URL(target);
      if (action.pathname === '/retry') retryBackend();
      else if (action.pathname === '/picker') openBackendPickerWindow(mainWindow);
      else if (action.pathname === '/pair') completePairing(action.searchParams.get('code'));
      else if (action.pathname === '/reauth' && currentBackend.type === 'remote')
        startPairing(currentBackend.url);
      else if (action.pathname === '/quit') app.quit();
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
  mainWindow.webContents.on('did-finish-load', () => {
    trace(`nav:finish ${mainWindow?.webContents.getURL().slice(0, 80)}`);
  });
  // A remote session that expires bounces the window to the gateway's
  // /auth page — catch that and run the pairing flow instead of leaving
  // the user on a login page whose passkey ceremony cannot work in-app.
  mainWindow.webContents.on('did-navigate', (_event, navUrl) => {
    if (
      currentBackend.type === 'remote' &&
      dshOrigin &&
      navUrl.startsWith(dshOrigin + '/auth')
    ) {
      trace('remote:session-expired');
      session.defaultSession.cookies.remove(dshOrigin, 'dsh_auth').catch(() => {});
      startPairing(dshOrigin, { error: '会话已过期，请重新认证。' });
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    trace(`nav:fail ${code} ${desc} ${String(failedUrl).slice(0, 80)}`);
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

// Resolves when the page actually finished loading — callers that navigate
// again right away must await it, or the aborted half-loaded data: page
// confuses devtools-protocol clients tracking the window (seen as Playwright
// losing the window entirely on fast attach flows).
function showPage(html) {
  if (!mainWindow) return Promise.resolve();
  return mainWindow.loadURL(toDataUrl(html)).catch(() => {});
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
