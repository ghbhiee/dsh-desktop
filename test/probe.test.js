'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyBackendUrl } = require('../src/main/probe');

function fakeRequest(routes) {
  return async (url) => {
    const route = routes[new URL(url).pathname];
    if (!route) throw new Error('ECONNREFUSED');
    return { status: route.status, location: route.location || '', body: route.body || '' };
  };
}

test('a dsh web root classifies as dsh', async () => {
  const requestFn = fakeRequest({
    '/': { status: 200, body: '<script>window.__DSH_BOOT__ = {}</script>' },
  });
  assert.deepEqual(await classifyBackendUrl('http://127.0.0.1:3080', { requestFn }), {
    kind: 'dsh',
    origin: 'http://127.0.0.1:3080',
  });
});

test('a 302-to-/auth with the login page classifies as gateway', async () => {
  const requestFn = fakeRequest({
    '/': { status: 302, location: '/auth' },
    '/auth': { status: 200, body: '<title>DeepSeek Harness · 登录</title>' },
  });
  assert.equal((await classifyBackendUrl('https://ds.tokencv.com', { requestFn })).kind, 'gateway');
});

test('reachable but foreign servers are unknown', async () => {
  const requestFn = fakeRequest({ '/': { status: 200, body: '<html>hello</html>' } });
  assert.equal((await classifyBackendUrl('http://127.0.0.1:8080', { requestFn })).kind, 'unknown');
  const redirectElsewhere = fakeRequest({ '/': { status: 302, location: '/login' } });
  assert.equal(
    (await classifyBackendUrl('http://x.test', { requestFn: redirectElsewhere })).kind,
    'unknown'
  );
});

test('connection failures and junk input classify accordingly', async () => {
  const requestFn = fakeRequest({});
  assert.equal((await classifyBackendUrl('http://127.0.0.1:1', { requestFn })).kind, 'unreachable');
  assert.equal((await classifyBackendUrl('not a url', { requestFn })).kind, 'invalid');
  assert.equal((await classifyBackendUrl('ftp://x/y', { requestFn })).kind, 'invalid');
});

test('paths and queries are stripped to the origin before probing', async () => {
  const seen = [];
  const requestFn = async (url) => {
    seen.push(url);
    return { status: 200, location: '', body: '__DSH_BOOT__' };
  };
  await classifyBackendUrl('http://127.0.0.1:3080/some/deep/page?q=1', { requestFn });
  assert.deepEqual(seen, ['http://127.0.0.1:3080/']);
});

test('the real transport classifies a live local dsh', async (t) => {
  // Integration sanity against the machine's launchd dsh when it is up;
  // skipped silently when it is not.
  const result = await classifyBackendUrl('http://127.0.0.1:3080', { timeoutMs: 3000 });
  if (result.kind === 'unreachable') return t.skip('no local dsh on :3080');
  assert.equal(result.kind, 'dsh');
});
