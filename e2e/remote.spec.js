'use strict';

const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, cleanupLaunched, windowAt } = require('./helpers');

test.afterEach(cleanupLaunched);

// Remote mode against a fake gateway that speaks the real one's dialect:
// 302→/auth without a session, a login page titled DeepSeek Harness, a
// one-time pair/claim endpoint, and a dsh-marker page once the cookie is
// good. The passkey ceremony itself belongs to the real gateway; what the
// app owns — detection, browser hand-off, code claim, cookie persistence,
// reconnect-without-reauth — is all exercised here.

const GOOD_COOKIE = 'sid123.signature';
const PAIR_CODE = 'TESTCODE';

function startFakeGateway() {
  let pairCodeUsed = false;
  const hits = { auth: 0, claim: 0, app: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cookie = req.headers.cookie || '';
    if (url.pathname === '/auth') {
      hits.auth += 1;
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<title>DeepSeek Harness · 登录</title><h1>login here</h1>');
    }
    if (url.pathname === '/auth/pair/claim' && req.method === 'POST') {
      hits.claim += 1;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const code = JSON.parse(body || '{}').code;
        if (code !== PAIR_CODE || pairCodeUsed) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: '配对码无效或已过期' }));
        }
        pairCodeUsed = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            cookie: {
              name: 'dsh_auth',
              value: GOOD_COOKIE,
              expires: Math.floor(Date.now() / 1000) + 3600,
            },
          })
        );
      });
      return;
    }
    if (cookie.includes(`dsh_auth=${GOOD_COOKIE}`)) {
      hits.app += 1;
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<script>window.__DSH_BOOT__={}</script><h1 id="fake-dsh">dsh behind gateway</h1>');
    }
    res.writeHead(302, { location: '/auth' });
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, hits });
    });
  });
}

test('remote：网关检测 → 浏览器认证 → 配对码换会话 → 重启免认证', async () => {
  test.setTimeout(300_000);
  const gateway = await startFakeGateway();
  const userdata = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-ud-'));
  fs.writeFileSync(
    path.join(userdata, 'config.json'),
    JSON.stringify({ backend: { type: 'remote', url: gateway.origin } })
  );

  try {
    // First launch: no session → the system browser gets the auth URL and
    // the window asks for the pairing code.
    const first = await launchApp({ env: { DSH_DESKTOP_USERDATA: userdata }, toUi: false });
    const pairingPage = await windowAt(first.app, /^data:.*%E9%85%8D%E5%AF%B9/, {
      timeoutMs: 30_000,
    });
    await expect
      .poll(() => first.app.evaluate(() => global.__externalOpens || []), { timeout: 10_000 })
      .toContain(`${gateway.origin}/auth?pair=1`);

    // Wrong code first: the page comes back with the error, then the right
    // code connects.
    await pairingPage.fill('input[name=code]', 'WRONG1');
    await pairingPage.click('button');
    const retryPage = await windowAt(first.app, /^data:.*%E6%97%A0%E6%95%88/, { timeoutMs: 20_000 });
    await retryPage.fill('input[name=code]', PAIR_CODE);
    await retryPage.click('button');

    const appPage = await windowAt(
      first.app,
      new RegExp('^' + gateway.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'),
      { timeoutMs: 30_000 }
    );
    await expect(appPage.locator('#fake-dsh')).toBeVisible({ timeout: 10_000 });
    await first.app.close();

    // Second launch: the persisted cookie reconnects with no new browser
    // hand-off and no new claim.
    const claimsBefore = gateway.hits.claim;
    const second = await launchApp({ env: { DSH_DESKTOP_USERDATA: userdata }, toUi: false });
    const reconnected = await windowAt(
      second.app,
      new RegExp('^' + gateway.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'),
      { timeoutMs: 30_000 }
    );
    await expect(reconnected.locator('#fake-dsh')).toBeVisible({ timeout: 10_000 });
    const opens = await second.app.evaluate(() => global.__externalOpens || []);
    expect(opens).toEqual([]);
    expect(gateway.hits.claim).toBe(claimsBefore);
    await second.app.close();
  } finally {
    gateway.server.close();
    fs.rmSync(userdata, { recursive: true, force: true });
  }
});
