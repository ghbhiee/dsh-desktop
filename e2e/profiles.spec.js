'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dshPids, clearGreetingDialogs, launchApp, cleanupLaunched } = require('./helpers');

test.afterEach(cleanupLaunched);

// M3 checks, mechanically: a wrong dsh path yields an explanation (not a
// blank window), and a fresh profile directory ends with the workbench panel
// and its terminal working — the app assembling the profile and installing
// the plugins itself.

test('M3: a wrong dsh path gets an explanation, not a blank window', async () => {
  const { app, win } = await launchApp({
    env: { DSH_DESKTOP_DSH_BIN: '/nonexistent/dsh' },
    toUi: false,
  });

  await expect(win.getByText('dsh not found')).toBeVisible({ timeout: 15_000 });
  await expect(win.getByText(/npm install -g @deepseek-ai\/dsh/)).toBeVisible();
  await win.screenshot({ path: 'e2e/screens/m3-dsh-missing.png' });

  await app.close();
});

test('M3: fresh DSH_HOME — the app assembles the profile, plugins install, terminal works', async () => {
  test.setTimeout(300_000);
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-fresh-home-'));

  const { app, win } = await launchApp({
    env: { DSH_DESKTOP_HOME: freshHome },
    toUi: false,
    uiTimeout: 240_000,
  });
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 240_000 });
  await clearGreetingDialogs(win);

  // The app populated the profile on its own.
  const nm = path.join(freshHome, 'profiles', 'desktop', 'node_modules');
  for (const name of ['dsh-plugin-workbench', 'dsh-plugin-mobile-shell', 'dsh-plugin-snake']) {
    expect(fs.existsSync(path.join(nm, name, 'package.json'))).toBe(true);
  }

  // Workbench reports the desktop defaults (pty on).
  const health = await win.evaluate(() =>
    fetch('/plugins/workbench/api/health').then((r) => r.json())
  );
  expect(health.ok).toBe(true);
  expect(health.ptyEnabled).toBe(true);

  // The workbench panel opens and its terminal mounts.
  await win.getByRole('button', { name: 'Open workbench' }).click({ timeout: 10_000 });
  const panel = win.getByRole('complementary', { name: 'Workbench' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('tab', { name: 'Terminal' }).click();
  await expect(win.locator('.xterm').first()).toBeVisible({ timeout: 20_000 });
  await win.screenshot({ path: 'e2e/screens/m3-fresh-terminal.png' });

  await app.close();
  expect(dshPids()).toEqual([]);
  fs.rmSync(freshHome, { recursive: true, force: true });
});
