'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDshEnv } = require('../src/main/dsh-env');

test('appends missing PATH dirs without duplicating present ones', () => {
  const env = buildDshEnv({
    baseEnv: { PATH: '/usr/bin:/opt/homebrew/bin' },
    dshHome: '/x/dsh-home',
    extraPathDirs: ['/opt/homebrew/bin', '/usr/local/bin'],
  });
  assert.equal(env.PATH, '/usr/bin:/opt/homebrew/bin:/usr/local/bin');
});

test('builds a PATH even when the base env has none (Finder launch)', () => {
  const env = buildDshEnv({ baseEnv: {}, dshHome: '/x', extraPathDirs: ['/opt/homebrew/bin'] });
  assert.equal(env.PATH, '/opt/homebrew/bin');
});

test('sets DSH_HOME and preserves other base vars', () => {
  const env = buildDshEnv({
    baseEnv: { HOME: '/Users/u', DSH_DISCORD_TOKEN: 't' },
    dshHome: '/x/dsh-home',
  });
  assert.equal(env.DSH_HOME, '/x/dsh-home');
  assert.equal(env.HOME, '/Users/u');
  assert.equal(env.DSH_DISCORD_TOKEN, 't');
});

test('does not mutate the base env', () => {
  const base = { PATH: '/usr/bin' };
  buildDshEnv({ baseEnv: base, dshHome: '/x', extraPathDirs: ['/a'] });
  assert.equal(base.PATH, '/usr/bin');
});
