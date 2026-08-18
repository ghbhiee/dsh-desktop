'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ensureProfile,
  copyTemplateNodeModules,
  BASE_BUNDLES,
  DEFAULT_PATCH,
} = require('../src/main/profile');

function tmpProfileDir() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-test-')), 'desktop');
}

function readPkg(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

test('creates the three profile files plus node_modules', () => {
  const dir = ensureProfile(tmpProfileDir());
  assert.deepEqual(readPkg(dir).dsh.profile.bundles, BASE_BUNDLES);
  assert.equal(fs.readFileSync(path.join(dir, 'cordis.yml'), 'utf8'), '[]\n');
  assert.equal(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), DEFAULT_PATCH);
  assert.ok(fs.statSync(path.join(dir, 'node_modules')).isDirectory());
});

test('plugin names land in bundles after the base stack', () => {
  const dir = ensureProfile(tmpProfileDir(), { pluginNames: ['dsh-plugin-workbench'] });
  assert.deepEqual(readPkg(dir).dsh.profile.bundles, [...BASE_BUNDLES, 'dsh-plugin-workbench']);
});

test('preserves dependencies and bundles written by dsh plugin add', () => {
  const dir = ensureProfile(tmpProfileDir());
  const pkgFile = path.join(dir, 'package.json');
  const pkg = readPkg(dir);
  pkg.dependencies = { 'dsh-plugin-workbench': 'github:ghbhiee/dsh-plugin-workbench' };
  pkg.dsh.profile.bundles.push('dsh-plugin-workbench');
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));

  ensureProfile(dir);
  const after = readPkg(dir);
  assert.equal(after.dependencies['dsh-plugin-workbench'], 'github:ghbhiee/dsh-plugin-workbench');
  assert.ok(after.dsh.profile.bundles.includes('dsh-plugin-workbench'));
});

test('bundle union keeps base bundles first and drops duplicates', () => {
  const dir = ensureProfile(tmpProfileDir(), { pluginNames: ['dsh-plugin-snake'] });
  ensureProfile(dir, { pluginNames: ['dsh-plugin-snake', 'dsh-plugin-workbench'] });
  assert.deepEqual(readPkg(dir).dsh.profile.bundles, [
    ...BASE_BUNDLES,
    'dsh-plugin-snake',
    'dsh-plugin-workbench',
  ]);
});

test('never clobbers a cordis.patch.yml with real content', () => {
  const dir = tmpProfileDir();
  ensureProfile(dir);
  const patchFile = path.join(dir, 'cordis.patch.yml');
  fs.writeFileSync(patchFile, '- id: workbench\n  config:\n    writeEnabled: true\n');
  ensureProfile(dir);
  assert.match(fs.readFileSync(patchFile, 'utf8'), /writeEnabled: true/);
});

test('upgrades a patch file that is still the empty list', () => {
  const dir = tmpProfileDir();
  ensureProfile(dir, { defaultPatch: '[]\n' });
  ensureProfile(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), DEFAULT_PATCH);
});

test('template node_modules copy overwrites plugins, spares the patch file', () => {
  const template = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-tpl-'));
  const pluginDir = path.join(template, 'node_modules', 'dsh-plugin-x');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'package.json'), '{"name":"dsh-plugin-x"}');

  const dir = ensureProfile(tmpProfileDir());
  const patchFile = path.join(dir, 'cordis.patch.yml');
  fs.writeFileSync(patchFile, '- id: mine\n');

  assert.equal(copyTemplateNodeModules(template, dir), true);
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'dsh-plugin-x', 'package.json')));
  assert.equal(fs.readFileSync(patchFile, 'utf8'), '- id: mine\n');
});

test('a template without node_modules is a no-op, not an error', () => {
  const dir = ensureProfile(tmpProfileDir());
  assert.equal(copyTemplateNodeModules('/no/such/template', dir), false);
});

test('recovers from a corrupt profile package.json', () => {
  const dir = tmpProfileDir();
  ensureProfile(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
  ensureProfile(dir);
  assert.deepEqual(readPkg(dir).dsh.profile.bundles, BASE_BUNDLES);
});
