'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { DshProcess } = require('../src/main/dsh-process');

// A fake dsh: prints the announcement line, then stays alive like a server.
function fakeServer() {
  return new DshProcess({
    command: process.execPath,
    args: ['-e', 'console.log("dsh web: http://127.0.0.1:12345"); setInterval(() => {}, 1000)'],
    env: process.env,
  });
}

test('emits url parsed from stdout', async () => {
  const proc = fakeServer().start();
  const [url] = await once(proc, 'url');
  assert.equal(url, 'http://127.0.0.1:12345');
  await proc.stop();
});

test('stop() ends the child and marks the exit expected', async () => {
  const proc = fakeServer().start();
  await once(proc, 'url');
  const exited = once(proc, 'exit');
  await proc.stop();
  const [info] = await exited;
  assert.equal(info.expected, true);
  assert.equal(proc.running, false);
});

test('a child that dies on its own reports an unexpected exit', async () => {
  const proc = new DshProcess({
    command: process.execPath,
    args: ['-e', 'console.error("boom"); process.exit(3)'],
    env: process.env,
  }).start();
  const [info] = await once(proc, 'exit');
  assert.equal(info.expected, false);
  assert.equal(info.code, 3);
  assert.match(proc.recentOutput, /boom/);
});

test('spawn failure emits error, not a crash', async () => {
  const proc = new DshProcess({
    command: '/nonexistent/definitely-not-dsh',
    args: [],
    env: process.env,
  }).start();
  const [err] = await once(proc, 'error');
  assert.ok(err instanceof Error);
});
