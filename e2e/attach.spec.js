'use strict';

const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dshPids, launchApp, cleanupLaunched, windowAt } = require('./helpers');
const { findDshUrl } = require('../src/main/dsh-url');

test.afterEach(cleanupLaunched);

// Attach mode: the app connects to a dsh that is already running (the
// launchd service in real life; a scratch instance here) — no child process
// of its own, no auth, and switching back to managed spawns one again.

function startExternalDsh() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-ext-home-'));
  const profileDir = path.join(home, 'profiles', 'desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-desktop',
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })
  );
  fs.writeFileSync(path.join(profileDir, 'cordis.yml'), '[]\n');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '[]\n');

  const child = spawn('/opt/homebrew/bin/dsh', ['--profile', 'desktop', '--host', '127.0.0.1', '--port', '0'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('external dsh never announced: ' + output)), 60_000);
    const onData = (chunk) => {
      output += chunk;
      const found = findDshUrl(output);
      if (found) {
        clearTimeout(timer);
        resolve(found.replace(/\/$/, ''));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => reject(new Error('external dsh exited: ' + output)));
  });
  return { child, url, home };
}

test('attach：连接外部 dsh（零子进程），切回托管模式恢复自管', async () => {
  test.setTimeout(300_000);
  const external = startExternalDsh();
  const extUrl = await external.url;

  try {
    // Pre-seed the app config to attach on startup.
    const userdata = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-attach-ud-'));
    fs.writeFileSync(
      path.join(userdata, 'config.json'),
      JSON.stringify({ backend: { type: 'attach', url: extUrl } })
    );

    const { app } = await launchApp({
      env: { DSH_DESKTOP_USERDATA: userdata },
      toUi: false,
    });
    const extPattern = new RegExp('^' + extUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
    await windowAt(app, extPattern);

    // Attached: the window is on the external origin and the app spawned
    // nothing of its own.
    expect(dshPids()).toEqual([]);

    // Switch back to managed through the picker UI.
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu().getMenuItemById('backend-picker').click();
    });
    const picker = await windowPromise;
    await picker.waitForLoadState('domcontentloaded');
    await expect(picker.locator('#status')).not.toContainText('加载中', { timeout: 15_000 });
    await picker.check('#managed');
    await picker.click('#connect');
    await expect(picker.locator('#status')).toContainText('已连接', { timeout: 240_000 });

    await expect
      .poll(
        () => {
          const urls = app.windows().map((page) => page.url());
          return urls.some(
            (u) => /^http:\/\/127\.0\.0\.1:\d+\//.test(u) && !extPattern.test(u)
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    expect(dshPids().length).toBe(1);

    // And the choice persisted as managed.
    const saved = JSON.parse(fs.readFileSync(path.join(userdata, 'config.json'), 'utf8'));
    expect(saved.backend.type).toBe('managed');

    await app.close();
    expect(dshPids()).toEqual([]);
    fs.rmSync(userdata, { recursive: true, force: true });
  } finally {
    external.child.kill('SIGTERM');
    fs.rmSync(external.home, { recursive: true, force: true });
  }
});

test('attach：插件窗口仍可输入，命令指向被连的那个实例', async () => {
  test.setTimeout(300_000);
  const external = startExternalDsh();
  const extUrl = await external.url;

  try {
    const userdata = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-attach-pm-'));
    fs.writeFileSync(
      path.join(userdata, 'config.json'),
      JSON.stringify({ backend: { type: 'attach', url: extUrl } })
    );
    const { app } = await launchApp({
      env: { DSH_DESKTOP_USERDATA: userdata },
      toUi: false,
    });
    const extPattern = new RegExp('^' + extUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
    await windowAt(app, extPattern);

    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu().getMenuItemById('manage-plugins').click();
    });
    const pm = await windowPromise;
    await pm.waitForLoadState('domcontentloaded');

    // Typing stays possible — the copyable command is the only useful thing
    // here, and disabling the field used to take it away with it.
    await expect(pm.locator('#spec')).toBeEnabled({ timeout: 10_000 });
    await pm.fill('#spec', 'snake');
    await expect(pm.locator('#cmd')).toContainText('dsh-plugin-snake', { timeout: 5000 });

    // …and it targets the attached instance's own DSH_HOME and profile,
    // not the app's managed one.
    await expect(pm.locator('#cmd')).toContainText(external.home);
    await expect(pm.locator('#cmd')).toContainText('--profile desktop');

    // Installing is the part that is off — the app cannot restart an
    // instance it does not manage — and the reason is on screen.
    await expect(pm.locator('#install')).toBeDisabled();
    await expect(pm.locator('#scope')).toContainText('无权重启');

    await app.close();
    fs.rmSync(userdata, { recursive: true, force: true });
  } finally {
    external.child.kill('SIGTERM');
    fs.rmSync(external.home, { recursive: true, force: true });
  }
});
