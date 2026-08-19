'use strict';

const { BrowserWindow, ipcMain, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { normalizePluginSpec, buildInstallCommand } = require('./plugin-spec');
const { listInstalledPluginDetails, installPlugin, parseBootPlugins } = require('./plugins');
const { ensureProfile } = require('./profile');
const { inspectPort, readDshHome } = require('./detect-local');

// The plugin-manager window: an app-owned page (not dsh's web UI), sandboxed
// with a preload that exposes exactly four calls. Installation reuses the
// same machinery as startup; success restarts the dsh child in place — the
// window and the app stay up.

let managerWindow = null;
let handlersRegistered = false;

function profileDependencyNames(profileDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    return Object.keys(pkg.dependencies || {});
  } catch {
    return [];
  }
}

// Only dependencies that declare a real dsh.bundle may enter the bundle
// stack — dsh's loader hard-fails the whole boot on a row whose package
// doesn't (verified: `declares no dsh.bundle in its package.json`), so an
// unfiltered union would brick the profile on the next restart.
function loadableBundleNames(profileDir) {
  return profileDependencyNames(profileDir).filter((name) => {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(profileDir, 'node_modules', name, 'package.json'), 'utf8')
      );
      return Boolean(pkg.dsh?.bundle) && Object.keys(pkg.dsh.bundle).length > 0;
    } catch {
      return false;
    }
  });
}

// Which dsh a copyable command should target, and whether the app may run it
// itself. Managed: our own child, ours to install into and restart. Attach:
// somebody else's local instance — its profile and DSH_HOME are readable
// from the process table, so the command can be exact, but the app neither
// writes into a profile it does not own nor restarts a service it does not
// manage (the launchd dsh-web is explicitly off limits). Remote: the work
// belongs on the other host entirely.
async function commandTarget(context) {
  const { runtime, dshHome, profileName, backendType, backendUrl } = context;
  if (backendType === 'attach' && backendUrl) {
    const port = Number(new URL(backendUrl).port);
    const found = await inspectPort(port);
    if (found) {
      const home = await readDshHome(found.pid);
      return {
        kind: 'attach',
        canInstall: false,
        runtime: { type: 'system', bin: 'dsh' },
        dshHome: home || '$HOME/.dsh',
        profileName: found.profile || '<profile>',
        pid: found.pid,
        note: home
          ? null
          : '该实例未设置 DSH_HOME，用的是 dsh 默认位置 ~/.dsh。',
      };
    }
    return {
      kind: 'attach',
      canInstall: false,
      runtime: { type: 'system', bin: 'dsh' },
      dshHome: '$HOME/.dsh',
      profileName: '<profile>',
      note: '没能在进程表里认出这个实例，命令里的 profile 需要你自己填。',
    };
  }
  if (backendType === 'remote') {
    return {
      kind: 'remote',
      canInstall: false,
      runtime: { type: 'system', bin: 'dsh' },
      dshHome: '$HOME/.dsh',
      profileName: '<profile>',
      note: '远程实例的插件要在那台主机上安装。',
    };
  }
  return { kind: 'managed', canInstall: true, runtime, dshHome, profileName };
}

// The plugin list must describe the instance the window is pointed at — not
// the app's own profile, which is not even running in attach/remote mode.
// Three sources, in order of fidelity:
//   own      the app's profile directory (managed)
//   attached that instance's profile directory, located via its own env
//   boot     the served page's __DSH_BOOT__ payload (all we can see of a
//            remote host; client-visible plugins only)
async function connectedPlugins(context, target) {
  if (target.kind === 'managed') {
    return { source: 'own', list: listInstalledPluginDetails(context.profileDir) };
  }

  if (target.kind === 'attach' && target.dshHome && !target.dshHome.startsWith('$')) {
    const dir = path.join(target.dshHome, 'profiles', target.profileName);
    if (fs.existsSync(path.join(dir, 'node_modules'))) {
      return { source: 'attached', detail: dir, list: listInstalledPluginDetails(dir) };
    }
  }

  const origin = context.backendUrl;
  if (origin && context.fetchPage) {
    try {
      const html = await context.fetchPage(origin + '/');
      const list = parseBootPlugins(html);
      if (list) return { source: 'boot', detail: origin, list };
    } catch {
      // fall through to the honest empty answer below
    }
  }
  return { source: 'unknown', detail: origin || null, list: [] };
}

function validateLocal(norm) {
  if (norm.kind === 'local' && !fs.existsSync(path.join(norm.spec, 'package.json'))) {
    return { ...norm, warning: '路径不存在或缺少 package.json' };
  }
  return norm;
}

// getContext(): { runtime, env, dshHome, profileName, profileDir, restartBackend }
function registerPluginManager(getContext) {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('pm:state', async () => {
    const context = getContext();
    const target = await commandTarget(context);
    const inventory = await connectedPlugins(context, target);
    return {
      installed: inventory.list,
      inventory: { source: inventory.source, detail: inventory.detail },
      runtimeType: context.runtime?.type ?? 'unknown',
      backendType: context.backendType ?? 'managed',
      target,
    };
  });

  ipcMain.handle('pm:preview', async (_event, input) => {
    const context = getContext();
    const norm = normalizePluginSpec(input);
    if (norm.error) return norm;
    const target = await commandTarget(context);
    return {
      ...validateLocal(norm),
      command: buildInstallCommand({
        runtime: target.runtime,
        dshHome: target.dshHome,
        profileName: target.profileName,
        spec: norm.spec,
      }),
      target,
    };
  });

  ipcMain.handle('pm:copy', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('pm:install', async (_event, input) => {
    const { runtime, env, profileName, profileDir, restartBackend, backendType } = getContext();
    if (backendType && backendType !== 'managed') {
      return {
        ok: false,
        error:
          '当前窗口连的是应用管不到的 dsh 实例，装完也无权重启它。' +
          '请复制上面的命令自己执行，然后重启那个实例。',
      };
    }
    const norm = normalizePluginSpec(input);
    if (norm.error) return { ok: false, error: norm.error };
    if (norm.kind === 'local' && !fs.existsSync(path.join(norm.spec, 'package.json'))) {
      return { ok: false, error: `本地路径无效（需要包含 package.json）：${norm.spec}` };
    }
    const depsBefore = new Set(profileDependencyNames(profileDir));
    const result = await installPlugin({ runtime, env, profileName, spec: norm.spec });
    if (!result.ok) return { ok: false, error: result.error };
    // Union every loadable dependency into the bundle stack (dsh plugin add
    // usually does this itself; partial states self-heal here), then restart
    // the backend in place — the client keeps running.
    const loadable = loadableBundleNames(profileDir);
    ensureProfile(profileDir, { pluginNames: loadable });
    const added = profileDependencyNames(profileDir).filter((n) => !depsBefore.has(n));
    const rejected = added.filter((n) => !loadable.includes(n));
    await restartBackend();
    return {
      ok: true,
      spec: norm.spec,
      output: result.output,
      warning: rejected.length
        ? `已安装到 profile，但未声明有效的 dsh.bundle、不会被加载：${rejected.join(', ')}`
        : undefined,
    };
  });
}

function openPluginManagerWindow(parent) {
  if (managerWindow) {
    managerWindow.focus();
    return managerWindow;
  }
  const E2E = process.env.DSH_DESKTOP_E2E === '1';
  managerWindow = new BrowserWindow({
    width: 680,
    height: 640,
    parent: parent ?? undefined,
    title: '插件管理',
    show: !E2E,
    webPreferences: {
      backgroundThrottling: !E2E,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'plugin-manager.js'),
    },
  });
  managerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'plugin-manager.html'));
  managerWindow.on('closed', () => {
    managerWindow = null;
  });
  return managerWindow;
}

module.exports = { registerPluginManager, openPluginManagerWindow };
