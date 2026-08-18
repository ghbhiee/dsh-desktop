'use strict';

const { test, expect, _electron } = require('@playwright/test');
const { execSync } = require('node:child_process');

// Drives the real app: Electron main process, spawned dsh, real profile.
// This is the mechanical form of M0's check — no human eyeballs required:
// the window is on dsh's announced loopback URL, a session composer renders,
// the workbench panel opens, and no dsh outlives the app.

function strayDshProcesses() {
  try {
    return execSync('pgrep -fl -- "--profile desktop"', { encoding: 'utf8' }).trim();
  } catch {
    return ''; // pgrep exits 1 when nothing matches
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

test('M0: dsh UI loads, a session renders, workbench opens, clean exit', async () => {
  const app = await _electron.launch({ args: ['.'] });
  const win = await app.firstWindow();

  await win.waitForLoadState('domcontentloaded');
  expect(win.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

  await clearGreetingDialogs(win);

  // A session renders: the composer is live (send control present, workspace
  // picker mounted).
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

  expect(strayDshProcesses()).toBe('');
});
