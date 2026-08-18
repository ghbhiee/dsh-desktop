'use strict';

const { test, expect } = require('@playwright/test');
const { launchApp, cleanupLaunched } = require('./helpers');

// M2 checks, mechanically: geometry survives a restart, the Edit menu exists
// with working accelerators, and off-origin navigation goes to the system
// browser (recorded, in e2e mode, instead of actually opening one).

test.afterEach(cleanupLaunched);

test('M2: window geometry survives a restart', async () => {
  const first = await launchApp({ toUi: false });
  await first.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ x: 80, y: 80, width: 1024, height: 700 });
  });
  // The save is debounced; give it a beat.
  await first.win.waitForTimeout(1000);
  await first.app.close();

  const second = await launchApp({ toUi: false });
  const bounds = await second.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  );
  await second.app.close();
  expect(bounds.width).toBe(1024);
  expect(bounds.height).toBe(700);
  expect(bounds.x).toBe(80);
  expect(bounds.y).toBe(80);
});

test('M2: the Edit menu carries the clipboard roles', async () => {
  const { app, win } = await launchApp();

  // On macOS, Cmd+C/V only work when an Edit menu with these roles exists —
  // Electron ships none by default. The keystrokes themselves route through
  // the OS first-responder chain, which needs real window focus a test
  // runner cannot win reliably; asserting the roles is the app's half of
  // the contract. (One-time human check: Cmd+C/V in the composer.)
  const editRoles = await app.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu()
      .items.find((item) => item.label === 'Edit' || item.role === 'editmenu');
    return edit ? edit.submenu.items.map((item) => item.role) : [];
  });
  expect(editRoles).toEqual(
    expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'])
  );

  // And the field itself takes edits. The search field starts collapsed; its
  // button expands it.
  await win.getByRole('button', { name: 'Search sessions' }).click({ timeout: 15_000 });
  const box = win.getByRole('textbox', { name: /search sessions/i });
  await box.click({ timeout: 5000 });
  await box.fill('typing-lands');
  await expect(box).toHaveValue('typing-lands');

  await app.close();
});

test('the dsh origin is stable across relaunches (settings survive)', async () => {
  const first = await launchApp();
  const port1 = new URL(first.win.url()).port;
  await first.app.close();

  const second = await launchApp();
  const port2 = new URL(second.win.url()).port;
  await second.app.close();

  expect(port2).toBe(port1);
});

test('M2: off-origin navigation is sent to the system browser', async () => {
  const { app, win } = await launchApp();

  await win.evaluate(() => window.open('https://example.com/external'));
  await win.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.org/link';
    a.textContent = 'ext';
    document.body.append(a);
    a.click();
  });

  await expect
    .poll(async () => app.evaluate(() => global.__externalOpens || []), { timeout: 5000 })
    .toEqual(['https://example.com/external', 'https://example.org/link']);

  // The window itself stayed on the dsh origin.
  expect(win.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

  await app.close();
});
