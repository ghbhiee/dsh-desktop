'use strict';

const http = require('node:http');
const https = require('node:https');

// Remote-mode plumbing against the dsh auth gateway. Two operations:
//
//   sessionIsLive(origin, cookie) — does this stored session cookie still
//     open the dsh UI (200 + boot marker), or has it expired back to /auth?
//   claimPairCode(origin, code)   — swap a one-time pairing code (shown in
//     the system browser after a passkey login) for a fresh session cookie.
//
// Same deliberate plain node:http as probe.js: explicit timeout, no
// redirects, nothing clever.

const DSH_MARKER = '__DSH_BOOT__';

function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
        if (text.length > 512 * 1024) res.destroy();
      });
      const finish = () =>
        resolve({ status: res.statusCode, headers: res.headers, body: text });
      res.on('end', finish);
      res.on('error', finish);
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function sessionIsLive(origin, cookie, { requestFn = request } = {}) {
  if (!cookie) return false;
  try {
    const res = await requestFn(origin + '/', {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });
    return res.status === 200 && res.body.includes(DSH_MARKER);
  } catch {
    return false;
  }
}

// Returns { name, value, expires } (expires: epoch seconds or null).
async function claimPairCode(origin, code, { requestFn = request } = {}) {
  const res = await requestFn(origin + '/auth/pair/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: String(code || '').trim() }),
  });
  let parsed = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {}
  if (res.status !== 200 || !parsed.ok || !parsed.cookie?.value) {
    throw new Error(parsed.error || `配对失败（HTTP ${res.status}）`);
  }
  return {
    name: parsed.cookie.name || 'dsh_auth',
    value: parsed.cookie.value,
    expires: parsed.cookie.expires ?? null,
  };
}

module.exports = { sessionIsLive, claimPairCode };
