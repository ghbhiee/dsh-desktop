'use strict';

const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dshPids, clearGreetingDialogs, launchApp, cleanupLaunched } = require('./helpers');

test.afterEach(cleanupLaunched);

// M4's check, mechanically: with no reachable system dsh and no pnpm (PATH
// stripped to the OS basics), the app runs its bundled dsh on Electron's own
// Node and populates the profile from the shipped template — and the
// terminal works. Requires `npm run bundle` first; skipped otherwise.

const BUNDLE_DIR = path.join(__dirname, '..', 'build', 'bundle');
const bundleStaged = fs.existsSync(path.join(BUNDLE_DIR, 'dsh', 'lib', 'bin.js'));

test('M4: bundled dsh + shipped profile template, no system dsh, no pnpm', async () => {
  test.skip(!bundleStaged, 'run `npm run bundle` first');
  test.setTimeout(300_000);
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bundled-home-'));

  const { app, win } = await launchApp({
    env: {
      DSH_DESKTOP_HOME: freshHome,
      DSH_DESKTOP_BUNDLED_DIR: BUNDLE_DIR,
      // No homebrew, no pnpm, no global dsh reachable — the mode A machine.
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
    toUi: false,
    uiTimeout: 120_000,
  });
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  await clearGreetingDialogs(win);

  // The profile came from the template, not pnpm: real directories, and a
  // pnpm-free environment could not have installed them any other way.
  const nm = path.join(freshHome, 'profiles', 'desktop', 'node_modules');
  for (const name of ['dsh-plugin-workbench', 'dsh-plugin-mobile-shell', 'dsh-plugin-snake']) {
    expect(fs.existsSync(path.join(nm, name, 'package.json'))).toBe(true);
    expect(fs.lstatSync(path.join(nm, name)).isSymbolicLink()).toBe(false);
  }

  const health = await win.evaluate(() =>
    fetch('/plugins/workbench/api/health').then((r) => r.json())
  );
  expect(health.ok).toBe(true);
  expect(health.ptyEnabled).toBe(true);

  // The terminal is the part that dies when packaging breaks native bits
  // (pty.node prebuild, spawn-helper execute bit) — it must actually mount.
  await win.getByRole('button', { name: 'Open workbench' }).click({ timeout: 10_000 });
  const panel = win.getByRole('complementary', { name: 'Workbench' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('tab', { name: 'Terminal' }).click();
  await expect(win.locator('.xterm').first()).toBeVisible({ timeout: 20_000 });
  await win.screenshot({ path: 'e2e/screens/m4-bundled-terminal.png' });

  await app.close();
  expect(dshPids()).toEqual([]);
  fs.rmSync(freshHome, { recursive: true, force: true });
});

// The same check against the real .app — resources laid out by
// electron-builder, native bits having survived packaging. Requires
// `npm run pack`; skipped otherwise.
const PACKAGED_BIN = path.join(
  __dirname,
  '..',
  'dist',
  'mac-arm64',
  'dsh Desktop.app',
  'Contents',
  'MacOS',
  'dsh Desktop'
);
const PACKAGED_RESOURCES = path.join(
  __dirname,
  '..',
  'dist',
  'mac-arm64',
  'dsh Desktop.app',
  'Contents',
  'Resources',
  'dsh'
);

test('M4: the packaged .app is self-contained — terminal works with no dsh, no pnpm', async () => {
  test.skip(
    !fs.existsSync(PACKAGED_BIN) || !fs.existsSync(PACKAGED_RESOURCES),
    'run `npm run pack` first'
  );
  test.setTimeout(300_000);
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-packaged-home-'));

  const app = await _electron.launch({
    executablePath: PACKAGED_BIN,
    args: [],
    env: {
      HOME: freshHome,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME || process.env.USER,
      TMPDIR: os.tmpdir() + '/',
      DSH_DESKTOP_HOME: path.join(freshHome, 'dsh-home'),
      // macOS resolves Application Support via the directory service, not
      // $HOME — without an explicit userData the packaged app would contend
      // for the real instance's single-instance lock.
      DSH_DESKTOP_USERDATA: path.join(freshHome, 'userdata'),
      DSH_DESKTOP_E2E: '1',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
  });
  const win = await app.firstWindow();
  await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  await clearGreetingDialogs(win);

  await win.getByRole('button', { name: 'Open workbench' }).click({ timeout: 10_000 });
  const panel = win.getByRole('complementary', { name: 'Workbench' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('tab', { name: 'Terminal' }).click();
  await expect(win.locator('.xterm').first()).toBeVisible({ timeout: 20_000 });
  await win.screenshot({ path: 'e2e/screens/m4-packaged-terminal.png' });

  await app.close();
  expect(dshPids()).toEqual([]);
  fs.rmSync(freshHome, { recursive: true, force: true });
});
