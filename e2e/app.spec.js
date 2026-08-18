'use strict';

const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { dshPids, clearGreetingDialogs, launchApp, cleanupLaunched, E2E_USERDATA } = require('./helpers');

// Drives the real app: Electron main process, spawned dsh, real profile.
// These are the mechanical forms of the M0/M1 checks — no human eyeballs.

test.afterEach(cleanupLaunched);

test('M0: dsh UI loads, a session renders, workbench opens, clean exit', async () => {
  const { app, win } = await launchApp();

  expect(win.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

  // A session renders: the composer is live.
  await win.getByRole('button', { name: /new session/i }).first().click({ timeout: 15_000 });
  await expect(win.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 15_000 });
  await win.screenshot({ path: 'e2e/screens/m0-session.png' });

  // The workbench panel opens, with its Files and Terminal tabs mounted.
  await win.getByRole('button', { name: 'Open workbench' }).click({ timeout: 10_000 });
  const panel = win.getByRole('complementary', { name: 'Workbench' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('tab', { name: 'Terminal' })).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Files' })).toBeVisible();
  await win.screenshot({ path: 'e2e/screens/m0-workbench.png' });

  await app.close();

  expect(dshPids()).toEqual([]);
});

test('M1: a killed dsh yields an in-window error page, and Retry recovers', async () => {
  const { app, win } = await launchApp();

  const pids = dshPids();
  expect(pids.length).toBe(1);
  process.kill(Number(pids[0]), 'SIGKILL');

  // The window must say what happened — not go blank.
  await expect(win.getByText('dsh exited unexpectedly')).toBeVisible({ timeout: 15_000 });
  await win.screenshot({ path: 'e2e/screens/m1-backend-down.png' });

  await win.getByText('Restart dsh').click();
  await clearGreetingDialogs(win);
  await expect(win.getByRole('button', { name: /new session/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(dshPids().length).toBe(1);

  await app.close();
  expect(dshPids()).toEqual([]);
});

test('M1: a second launch defers to the first — one window, one child', async () => {
  const { app, win } = await launchApp();

  // The second instance must contend for OUR lock (same userData), not the
  // lock of whatever real instance the user may have open.
  execFileSync('node_modules/.bin/electron', ['.'], {
    timeout: 30_000,
    stdio: 'ignore',
    env: { ...process.env, DSH_DESKTOP_E2E: '1', DSH_DESKTOP_USERDATA: E2E_USERDATA },
  });

  expect(dshPids().length).toBe(1);
  expect(win.isClosed()).toBe(false);

  await app.close();
  expect(dshPids()).toEqual([]);
});
