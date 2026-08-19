'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDshPorts } = require('../src/main/detect-local');

test('finds explicit ports on dsh command lines, both invocation shapes', () => {
  const ps = [
    '  123 node /opt/homebrew/bin/dsh --profile web --host 127.0.0.1 --port 3080 --trusted-host x',
    ' 4567 /Applications/dsh Desktop.app/Contents/MacOS/dsh Desktop --expose-internals /Applications/dsh Desktop.app/Contents/Resources/dsh/lib/bin.js --profile desktop --host 127.0.0.1 --port 52094',
  ].join('\n');
  assert.deepEqual(parseDshPorts(ps), [
    { pid: 123, port: 3080 },
    { pid: 4567, port: 52094 },
  ]);
});

test('skips port 0, duplicates, and non-dsh processes', () => {
  const ps = [
    ' 1 node /opt/homebrew/bin/dsh --profile x --port 0',
    ' 2 nginx --port 8080',
    ' 3 node /opt/homebrew/bin/dsh --profile a --port 3080',
    ' 4 node /opt/homebrew/bin/dsh --profile b --port 3080',
  ].join('\n');
  assert.deepEqual(parseDshPorts(ps), [{ pid: 3, port: 3080 }]);
});

test('empty and garbage input yield an empty list', () => {
  assert.deepEqual(parseDshPorts(''), []);
  assert.deepEqual(parseDshPorts('no processes here'), []);
});
