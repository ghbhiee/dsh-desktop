'use strict';

const { BrowserWindow, ipcMain, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { normalizePluginSpec, buildInstallCommand } = require('./plugin-spec');
const { listInstalledPluginDetails, installPlugin } = require('./plugins');
const { ensureProfile } = require('./profile');

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

  ipcMain.handle('pm:state', () => {
    const { runtime, profileDir, backendType } = getContext();
    return {
      installed: listInstalledPluginDetails(profileDir),
      runtimeType: runtime?.type ?? 'unknown',
      backendType: backendType ?? 'managed',
    };
  });

  ipcMain.handle('pm:preview', (_event, input) => {
    const { runtime, dshHome, profileName } = getContext();
    const norm = normalizePluginSpec(input);
    if (norm.error) return norm;
    return {
      ...validateLocal(norm),
      command: buildInstallCommand({ runtime, dshHome, profileName, spec: norm.spec }),
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
        error: '当前连接的是外部 dsh 实例——插件属于那个实例的 profile，请在运行它的机器上安装。',
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
