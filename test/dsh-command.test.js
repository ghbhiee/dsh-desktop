'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dshInvocation } = require('../src/main/dsh-command');

test('system runtime: the binary, verbatim args, untouched env', () => {
  const inv = dshInvocation({ type: 'system', bin: '/x/dsh' }, ['--version'], {
    baseEnv: { PATH: '/a' },
  });
  assert.equal(inv.command, '/x/dsh');
  assert.deepEqual(inv.args, ['--version']);
  assert.equal(inv.env.PATH, '/a');
  assert.equal(inv.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('bundled runtime: electron-as-node with --expose-internals leading', () => {
  const inv = dshInvocation(
    { type: 'bundled', script: '/res/dsh/lib/bin.js' },
    ['--profile', 'desktop'],
    { baseEnv: { PATH: '/a' }, execPath: '/app/Electron' }
  );
  assert.equal(inv.command, '/app/Electron');
  assert.deepEqual(inv.args, ['--expose-internals', '/res/dsh/lib/bin.js', '--profile', 'desktop']);
  assert.equal(inv.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(inv.env.PATH, '/a');
});

test('does not mutate the base env or args', () => {
  const baseEnv = { PATH: '/a' };
  const args = ['--version'];
  dshInvocation({ type: 'bundled', script: '/s' }, args, { baseEnv, execPath: '/e' });
  assert.deepEqual(baseEnv, { PATH: '/a' });
  assert.deepEqual(args, ['--version']);
});
