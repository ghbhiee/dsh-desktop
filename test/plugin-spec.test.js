'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizePluginSpec, buildInstallCommand } = require('../src/main/plugin-spec');

test('local paths: tilde, absolute, relative', () => {
  assert.deepEqual(normalizePluginSpec('~/dsh/dsh-plugin-x', { home: '/Users/u' }), {
    kind: 'local',
    spec: '/Users/u/dsh/dsh-plugin-x',
  });
  assert.deepEqual(normalizePluginSpec('/abs/dsh-plugin-x'), {
    kind: 'local',
    spec: '/abs/dsh-plugin-x',
  });
  assert.equal(normalizePluginSpec('./rel-plugin').spec, path.resolve('./rel-plugin'));
});

test('github URL forms normalize to github:owner/repo', () => {
  for (const input of [
    'https://github.com/ghbhiee/dsh-plugin-snake',
    'https://github.com/ghbhiee/dsh-plugin-snake.git',
    'https://github.com/ghbhiee/dsh-plugin-snake/',
    'https://github.com/ghbhiee/dsh-plugin-snake/tree/main',
    'http://github.com/ghbhiee/dsh-plugin-snake#main',
  ]) {
    assert.deepEqual(normalizePluginSpec(input), {
      kind: 'github',
      spec: 'github:ghbhiee/dsh-plugin-snake',
    });
  }
});

test('github: passthrough and owner/repo shorthand', () => {
  assert.equal(normalizePluginSpec('github:o/r').spec, 'github:o/r');
  assert.equal(normalizePluginSpec('someone/dsh-plugin-y').spec, 'github:someone/dsh-plugin-y');
});

test('bare names default to ghbhiee with the dsh-plugin- prefix', () => {
  assert.equal(normalizePluginSpec('dsh-plugin-snake').spec, 'github:ghbhiee/dsh-plugin-snake');
  assert.equal(normalizePluginSpec('snake').spec, 'github:ghbhiee/dsh-plugin-snake');
});

test('empty and garbage inputs return errors, never a spec', () => {
  assert.ok(normalizePluginSpec('').error);
  assert.ok(normalizePluginSpec('  ').error);
  assert.ok(normalizePluginSpec('a b c').error);
  assert.ok(normalizePluginSpec('https://gitlab.com/o/r').error);
});

test('system-runtime command names the binary and quotes the spaced home', () => {
  const cmd = buildInstallCommand({
    runtime: { type: 'system', bin: '/opt/homebrew/bin/dsh' },
    dshHome: '/Users/u/Library/Application Support/dsh-desktop/dsh-home',
    profileName: 'desktop',
    spec: 'github:ghbhiee/dsh-plugin-snake',
  });
  assert.equal(
    cmd,
    "DSH_HOME='/Users/u/Library/Application Support/dsh-desktop/dsh-home' " +
      '/opt/homebrew/bin/dsh plugin --profile desktop add github:ghbhiee/dsh-plugin-snake'
  );
});

test('bundled-runtime command runs electron-as-node with the flag leading', () => {
  const cmd = buildInstallCommand({
    runtime: { type: 'bundled', script: '/App/Resources/dsh/lib/bin.js' },
    dshHome: '/h',
    profileName: 'desktop',
    spec: '/tmp/dsh-plugin-x',
    execPath: '/App/MacOS/App Shell',
  });
  assert.equal(
    cmd,
    "DSH_HOME=/h ELECTRON_RUN_AS_NODE=1 '/App/MacOS/App Shell' --expose-internals " +
      '/App/Resources/dsh/lib/bin.js plugin --profile desktop add /tmp/dsh-plugin-x'
  );
});
