'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  missingPlugins,
  installedPlugins,
  resolveSpec,
  expandHome,
} = require('../src/main/plugins');

function profileWith(installedNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-pl-'));
  for (const name of installedNames) {
    const pluginDir = path.join(dir, 'node_modules', name);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'package.json'), '{}');
  }
  return dir;
}

const PLUGINS = [
  { name: 'dsh-plugin-a', clone: '~/nowhere/dsh-plugin-a' },
  { name: 'dsh-plugin-b', clone: '~/nowhere/dsh-plugin-b' },
];

test('missing/installed split on node_modules presence', () => {
  const dir = profileWith(['dsh-plugin-a']);
  assert.deepEqual(missingPlugins(dir, PLUGINS).map((p) => p.name), ['dsh-plugin-b']);
  assert.deepEqual(installedPlugins(dir, PLUGINS).map((p) => p.name), ['dsh-plugin-a']);
});

test('an empty node_modules entry (no package.json) counts as missing', () => {
  const dir = profileWith([]);
  fs.mkdirSync(path.join(dir, 'node_modules', 'dsh-plugin-a'), { recursive: true });
  assert.deepEqual(missingPlugins(dir, PLUGINS).map((p) => p.name), [
    'dsh-plugin-a',
    'dsh-plugin-b',
  ]);
});

test('spec resolution prefers an existing local clone, else GitHub', () => {
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-clone-'));
  fs.writeFileSync(path.join(cloneDir, 'package.json'), '{}');
  assert.equal(resolveSpec({ name: 'dsh-plugin-x', clone: cloneDir }), cloneDir);
  assert.equal(
    resolveSpec({ name: 'dsh-plugin-x', clone: '/definitely/not/there' }),
    'github:ghbhiee/dsh-plugin-x'
  );
});

test('expandHome only rewrites a leading ~/', () => {
  assert.equal(expandHome('~/x/y', '/Users/u'), path.join('/Users/u', 'x/y'));
  assert.equal(expandHome('/abs/path', '/Users/u'), '/abs/path');
});
