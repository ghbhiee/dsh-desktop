'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadBackendConfig, saveBackendConfig, sanitizeBackend } = require('../src/main/backend-config');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bc-'));
}

test('save then load round-trips attach and remote', () => {
  const dir = tmp();
  saveBackendConfig(dir, { type: 'attach', url: 'http://127.0.0.1:3080/some/path' });
  assert.deepEqual(loadBackendConfig(dir), { type: 'attach', url: 'http://127.0.0.1:3080' });
  saveBackendConfig(dir, { type: 'remote', url: 'https://ds.tokencv.com' });
  assert.deepEqual(loadBackendConfig(dir), { type: 'remote', url: 'https://ds.tokencv.com' });
});

test('missing, corrupt or malformed configs degrade to managed', () => {
  assert.deepEqual(loadBackendConfig(tmp()), { type: 'managed' });
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
  assert.deepEqual(loadBackendConfig(dir), { type: 'managed' });
  assert.deepEqual(sanitizeBackend({ type: 'attach', url: 'ftp://x' }), { type: 'managed' });
  assert.deepEqual(sanitizeBackend({ type: 'attach' }), { type: 'managed' });
  assert.deepEqual(sanitizeBackend({ type: 'weird', url: 'http://x' }), { type: 'managed' });
});

test('saving preserves unrelated config keys', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ other: 1 }));
  saveBackendConfig(dir, { type: 'attach', url: 'http://127.0.0.1:9' });
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(config.other, 1);
  assert.equal(config.backend.type, 'attach');
});
