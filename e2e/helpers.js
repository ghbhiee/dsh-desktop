'use strict';

const { _electron } = require('@playwright/test');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// One isolated userData per test run: its own single-instance lock, window
// state and default DSH_HOME. Without this, e2e collides with a packaged
// app the user has open — the lock makes launches exit instantly, and pid
// sweeps would count (or kill!) the user's own dsh.
const E2E_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-e2e-userdata-'));

// Only processes carrying the e2e env marker are ours to count or reap. The
// user's real instance never has it.
function dshPids() {
  let candidates;
  try {
    candidates = execSync('pgrep -f -- "--profile desktop"', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
  return candidates.filter((pid) => {
    try {
      return execSync(`ps eww -o command= -p ${pid}`, { encoding: 'utf8' }).includes(
        'DSH_DESKTOP_E2E=1'
      );
    } catch {
      return false; // already gone
    }
  });
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
// Every app launched in a test, so a failed assertion cannot leak it: when a
// test dies before its own close(), Playwright hard-kills the Electron
// process, before-quit never runs, and the dsh child would outlive the run —
// poisoning every later pid assertion. Specs register cleanupLaunched as an
// afterEach.
const launched = [];

async function cleanupLaunched() {
  while (launched.length > 0) {
    await launched.pop().close().catch(() => {});
  }
  // Belt and braces: a child that survived anyway is killed so one failure
  // cannot cascade — each test's own asserts have already run by now.
  for (const pid of dshPids()) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {}
  }
}

async function launchApp({ env = {}, toUi = true, uiTimeout = 90_000 } = {}) {
  const app = await _electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      DSH_DESKTOP_E2E: '1',
      DSH_DESKTOP_USERDATA: E2E_USERDATA,
      ...env,
    },
  });
  launched.push(app);
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  if (toUi) {
    // The window starts on a data: loading page (profile assembly, plugin
    // installs) and navigates to dsh's loopback URL when the backend is up.
    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: uiTimeout });
    await clearGreetingDialogs(win);
  }
  return { app, win };
}

module.exports = { dshPids, clearGreetingDialogs, launchApp, cleanupLaunched, E2E_USERDATA };
