'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPreferredPort, savePreferredPort } = require('../src/main/port-store');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-port-'));
}

test('save then load round-trips per profile', () => {
  const home = tmp();
  savePreferredPort(home, 'desktop', 52366);
  savePreferredPort(home, 'other', 40000);
  assert.equal(loadPreferredPort(home, 'desktop'), 52366);
  assert.equal(loadPreferredPort(home, 'other'), 40000);
});

test('missing store or profile yields null', () => {
  assert.equal(loadPreferredPort(tmp(), 'desktop'), null);
  const home = tmp();
  savePreferredPort(home, 'other', 40000);
  assert.equal(loadPreferredPort(home, 'desktop'), null);
});

test('garbage is never returned or stored', () => {
  const home = tmp();
  fs.writeFileSync(path.join(home, 'preferred-ports.json'), '{broken');
  assert.equal(loadPreferredPort(home, 'desktop'), null);

  savePreferredPort(home, 'desktop', 0);
  savePreferredPort(home, 'desktop', 99999);
  savePreferredPort(home, 'desktop', 1.5);
  assert.equal(loadPreferredPort(home, 'desktop'), null);
});
