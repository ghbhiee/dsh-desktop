'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureProfile, BASE_BUNDLES } = require('../src/main/profile');

function tmpProfileDir() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-test-')), 'desktop');
}

test('creates the three profile files plus node_modules', () => {
  const dir = ensureProfile(tmpProfileDir());
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dsh.profile.bundles, BASE_BUNDLES);
  assert.equal(fs.readFileSync(path.join(dir, 'cordis.yml'), 'utf8'), '[]\n');
  assert.equal(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), '[]\n');
  assert.ok(fs.statSync(path.join(dir, 'node_modules')).isDirectory());
});

test('plugin names land in bundles after the base stack', () => {
  const dir = ensureProfile(tmpProfileDir(), { pluginNames: ['dsh-plugin-workbench'] });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dsh.profile.bundles, [...BASE_BUNDLES, 'dsh-plugin-workbench']);
});

test('never clobbers an existing cordis.patch.yml', () => {
  const dir = tmpProfileDir();
  ensureProfile(dir);
  const patchFile = path.join(dir, 'cordis.patch.yml');
  fs.writeFileSync(patchFile, '- id: workbench\n  config:\n    ptyEnabled: true\n');
  ensureProfile(dir);
  assert.match(fs.readFileSync(patchFile, 'utf8'), /ptyEnabled: true/);
});

test('rewrites package.json to keep bundles in sync', () => {
  const dir = tmpProfileDir();
  ensureProfile(dir);
  ensureProfile(dir, { pluginNames: ['dsh-plugin-snake'] });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.dsh.profile.bundles.includes('dsh-plugin-snake'));
});
