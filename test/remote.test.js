'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sessionIsLive, claimPairCode } = require('../src/main/remote');

test('sessionIsLive: 200 with the boot marker means live', async () => {
  const requestFn = async (url, opts) => {
    assert.equal(url, 'https://x.test/');
    assert.equal(opts.headers.cookie, 'dsh_auth=abc');
    return { status: 200, headers: {}, body: '<script>window.__DSH_BOOT__={}</script>' };
  };
  assert.equal(
    await sessionIsLive('https://x.test', { name: 'dsh_auth', value: 'abc' }, { requestFn }),
    true
  );
});

test('sessionIsLive: a bounce back to /auth or an error means dead', async () => {
  const bounced = async () => ({ status: 302, headers: { location: '/auth' }, body: '' });
  assert.equal(
    await sessionIsLive('https://x.test', { name: 'dsh_auth', value: 'old' }, { requestFn: bounced }),
    false
  );
  const failing = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(
    await sessionIsLive('https://x.test', { name: 'dsh_auth', value: 'x' }, { requestFn: failing }),
    false
  );
  assert.equal(await sessionIsLive('https://x.test', null), false);
});

test('claimPairCode: success returns the cookie triple', async () => {
  const requestFn = async (url, opts) => {
    assert.equal(url, 'https://x.test/auth/pair/claim');
    assert.equal(opts.method, 'POST');
    assert.deepEqual(JSON.parse(opts.body), { code: 'ABCD1234' });
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({ ok: true, cookie: { name: 'dsh_auth', value: 'sid.sig', expires: 123 } }),
    };
  };
  assert.deepEqual(await claimPairCode('https://x.test', ' abcd1234 '.toUpperCase().trim(), { requestFn }), {
    name: 'dsh_auth',
    value: 'sid.sig',
    expires: 123,
  });
});

test('claimPairCode: server errors surface as thrown messages', async () => {
  const requestFn = async () => ({
    status: 400,
    headers: {},
    body: JSON.stringify({ error: '配对码无效或已过期' }),
  });
  await assert.rejects(() => claimPairCode('https://x.test', 'NOPE', { requestFn }), /配对码无效/);
  const junk = async () => ({ status: 500, headers: {}, body: 'not json' });
  await assert.rejects(() => claimPairCode('https://x.test', 'X', { requestFn: junk }), /HTTP 500/);
});
