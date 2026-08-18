'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDshVersion,
  compareDshVersions,
  isSupportedDshVersion,
} = require('../src/main/version');

test('parses plain and rc versions', () => {
  assert.deepEqual(parseDshVersion('0.1.0-rc.7'), { major: 0, minor: 1, patch: 0, rc: 7 });
  assert.deepEqual(parseDshVersion('1.2.3'), { major: 1, minor: 2, patch: 3, rc: Infinity });
  assert.equal(parseDshVersion('not a version'), null);
});

test('rc ordering: releases outrank every rc of the same triple', () => {
  assert.ok(compareDshVersions('0.1.0-rc.7', '0.1.0-rc.8') < 0);
  assert.ok(compareDshVersions('0.1.0-rc.10', '0.1.0-rc.9') > 0);
  assert.ok(compareDshVersions('0.1.0', '0.1.0-rc.99') > 0);
  assert.equal(compareDshVersions('0.1.0-rc.7', '0.1.0-rc.7'), 0);
});

test('the supported floor is 0.1.0-rc.7', () => {
  assert.ok(isSupportedDshVersion('0.1.0-rc.7'));
  assert.ok(isSupportedDshVersion('0.1.0'));
  assert.ok(isSupportedDshVersion('0.2.0-rc.1'));
  assert.ok(!isSupportedDshVersion('0.1.0-rc.6'));
  assert.ok(!isSupportedDshVersion('0.0.9'));
  assert.ok(!isSupportedDshVersion('garbage'));
});

test('version embedded in longer output still parses', () => {
  assert.ok(isSupportedDshVersion('dsh version 0.1.0-rc.7 (darwin-arm64)'));
});
