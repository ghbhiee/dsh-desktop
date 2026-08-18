'use strict';

const { _electron } = require('@playwright/test');
const { execSync } = require('node:child_process');

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

// Launch the real app. `env` merges over the parent environment;
// DSH_DESKTOP_E2E=1 makes the app record external-link opens instead of
// opening a real browser.
async function launchApp({ env = {}, toUi = true } = {}) {
  const app = await _electron.launch({
    args: ['.'],
    env: { ...process.env, DSH_DESKTOP_E2E: '1', ...env },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  if (toUi) await clearGreetingDialogs(win);
  return { app, win };
}

module.exports = { dshPids, clearGreetingDialogs, launchApp };
