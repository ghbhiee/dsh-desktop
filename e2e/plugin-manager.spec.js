'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dshPids, launchApp, cleanupLaunched } = require('./helpers');

test.afterEach(cleanupLaunched);

// The plugin-manager window: install a local plugin through the UI, watch
// the backend restart in place (same origin, same single child, app never
// exits), and check the terminal command preview it offers for copying.

const FIXTURE = path.join(__dirname, 'fixtures', 'dsh-plugin-e2e-probe');

test('插件管理：本地路径安装 → 命令预览 → dsh 热重启', async () => {
  test.setTimeout(300_000);
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-pm-home-'));
  const { app, win } = await launchApp({
    env: { DSH_DESKTOP_HOME: freshHome },
    uiTimeout: 240_000,
  });
  const portBefore = new URL(win.url()).port;

  // Open the manager from the app menu.
  const windowPromise = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().getMenuItemById('manage-plugins').click();
  });
  const pm = await windowPromise;
  await pm.waitForLoadState('domcontentloaded');

  // Installed list shows the defaults.
  await expect(pm.locator('#installed')).toContainText('dsh-plugin-workbench', {
    timeout: 10_000,
  });

  // Typing a source previews the equivalent terminal command.
  await pm.fill('#spec', FIXTURE);
  await expect(pm.locator('#cmd')).toContainText('plugin --profile desktop add', {
    timeout: 5000,
  });
  await expect(pm.locator('#cmd')).toContainText('dsh-plugin-e2e-probe');

  // Install; the backend restarts without the app exiting. Re-fill first —
  // hidden windows make stray real-keyboard input impossible, but a cheap
  // guard keeps this test honest anyway.
  await pm.fill('#spec', FIXTURE);
  await expect(pm.locator('#spec')).toHaveValue(FIXTURE);
  await pm.click('#install');
  await expect(pm.locator('#status')).toContainText('已安装', { timeout: 180_000 });
  await expect(pm.locator('#installed')).toContainText('dsh-plugin-e2e-probe');

  // Profile really has it, and bundles list it.
  const profileDir = path.join(freshHome, 'profiles', 'desktop');
  expect(
    fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-plugin-e2e-probe', 'package.json'))
  ).toBe(true);
  const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  expect(pkg.dsh.profile.bundles).toContain('dsh-plugin-e2e-probe');

  // Main window is back on the same origin (port preserved), one child only.
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  expect(new URL(win.url()).port).toBe(portBefore);
  expect(dshPids().length).toBe(1);

  await app.close();
  expect(dshPids()).toEqual([]);
  fs.rmSync(freshHome, { recursive: true, force: true });
});
