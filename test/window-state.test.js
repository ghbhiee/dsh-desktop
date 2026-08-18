'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadWindowState,
  saveWindowState,
  sanitizeBounds,
} = require('../src/main/window-state');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-ws-'));
}

test('save then load round-trips bounds', () => {
  const dir = tmpDir();
  saveWindowState(dir, { width: 999, height: 654, x: 12, y: 34 });
  assert.deepEqual(loadWindowState(dir), { width: 999, height: 654, x: 12, y: 34 });
});

test('missing or corrupt state falls back to defaults', () => {
  assert.deepEqual(loadWindowState(tmpDir()), { width: 1200, height: 800 });
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'window-state.json'), '{nope');
  assert.deepEqual(loadWindowState(dir), { width: 1200, height: 800 });
});

test('implausible sizes are rejected, not applied', () => {
  const out = sanitizeBounds({ width: 3, height: -50, x: 10, y: 20 });
  assert.equal(out.width, 1200);
  assert.equal(out.height, 800);
  assert.equal(out.x, 10);
});

test('position is only kept as a complete finite pair', () => {
  assert.equal(sanitizeBounds({ width: 800, height: 600, x: 10 }).x, undefined);
  assert.equal(sanitizeBounds({ width: 800, height: 600, x: NaN, y: 5 }).x, undefined);
});
