'use strict';

const { test, expect, _electron } = require('@playwright/test');
const { execSync, execFileSync } = require('node:child_process');

// Drives the real app: Electron main process, spawned dsh, real profile.
// These are the mechanical forms of the M0/M1 checks — no human eyeballs.

function dshPids() {
  try {
    return execSync('pgrep -f -- "--profile desktop"', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

// A fresh-origin launch greets with up to two modals: the testing notice,
// then the API-key onboarding dialog. Both are optional (the OS assigns a new
// port per run, so origin-keyed localStorage decides), both must be cleared
// before the UI takes clicks.
async function clearGreetingDialogs(win) {
  const notice = win.getByText('Internal Testing Notice');
  try {
    await notice.waitFor({ state: 'visible', timeout: 8000 });
    await win.getByText('Continue', { exact: true }).click();
    await notice.waitFor({ state: 'hidden', timeout: 5000 });
  } catch {}
  const apiKeyDialog = win.getByRole('dialog', { name: /add an api key/i });
  try {
    await apiKeyDialog.waitFor({ state: 'visible', timeout: 5000 });
    await win.getByRole('button', { name: 'Configure later' }).click();
    await apiKeyDialog.waitFor({ state: 'hidden', timeout: 5000 });
  } catch {}
}

async function launchToUi() {
  const app = await _electron.launch({ args: ['.'] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await clearGreetingDialogs(win);
  return { app, win };
}

test('M0: dsh UI loads, a session renders, workbench opens, clean exit', async () => {
  const { app, win } = await launchToUi();

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
  const { app, win } = await launchToUi();

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
  const { app, win } = await launchToUi();

  // The second instance should exit on its own (single-instance lock).
  execFileSync('node_modules/.bin/electron', ['.'], { timeout: 30_000, stdio: 'ignore' });

  expect(dshPids().length).toBe(1);
  expect(win.isClosed()).toBe(false);

  await app.close();
  expect(dshPids()).toEqual([]);
});
