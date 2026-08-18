'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findDshUrl } = require('../src/main/dsh-url');

test('parses the announced line verbatim', () => {
  assert.equal(findDshUrl('dsh web: http://127.0.0.1:64196\n'), 'http://127.0.0.1:64196');
});

test('finds the line amid other output', () => {
  const out = 'booting...\nsome noise\ndsh web: http://127.0.0.1:55872\nmore noise\n';
  assert.equal(findDshUrl(out), 'http://127.0.0.1:55872');
});

test('accumulating chunks: nothing until the line is complete', () => {
  assert.equal(findDshUrl('dsh web: http://127.0'), null);
  assert.equal(findDshUrl('dsh web: http://127.0.0.1:64196\n rest'), 'http://127.0.0.1:64196');
});

test('loose fallback only accepts loopback', () => {
  assert.equal(findDshUrl('listening on http://127.0.0.1:9999 now\n'), 'http://127.0.0.1:9999');
  assert.equal(findDshUrl('see https://ds.tokencv.com:443 for docs\n'), null);
  assert.equal(findDshUrl('bound http://0.0.0.0:8080\n'), null);
});

test('no URL yields null', () => {
  assert.equal(findDshUrl(''), null);
  assert.equal(findDshUrl('starting up...\n'), null);
});
