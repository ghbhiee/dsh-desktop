'use strict';

const http = require('node:http');
const https = require('node:https');

// What is listening at a URL? Classified from real signatures (verified
// 2026-08-18 against this machine's deployments):
//
//   dsh web:  200, HTML whose head opens with `window.__DSH_BOOT__`
//   gateway:  30x to /auth; the /auth page titles itself DeepSeek Harness
//   unknown:  reachable but neither
//   unreachable: connect/timeout failure
//
// Plain node:http on purpose — undici's fetch has stalled indefinitely in
// the Electron main process under test load; this path has explicit
// timeout, destroy and no redirect following.

const DSH_MARKER = '__DSH_BOOT__';
const GATEWAY_MARKER = 'DeepSeek Harness';
const BODY_CAP = 512 * 1024;

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      const finish = () => resolve({
        status: res.statusCode,
        location: res.headers.location || '',
        body,
      });
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > BODY_CAP) {
          res.destroy();
          finish();
        }
      });
      res.on('end', finish);
      res.on('error', finish); // whatever arrived is enough to classify
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

async function classifyBackendUrl(rawUrl, { timeoutMs = 5000, requestFn = httpGet } = {}) {
  let origin;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
    origin = url.origin;
  } catch {
    return { kind: 'invalid' };
  }

  let root;
  try {
    root = await requestFn(origin + '/', timeoutMs);
  } catch (err) {
    return { kind: 'unreachable', detail: String(err?.message || err) };
  }

  if (root.status === 200 && root.body.includes(DSH_MARKER)) return { kind: 'dsh', origin };

  if (root.status >= 300 && root.status < 400 && root.location.startsWith('/auth')) {
    try {
      const auth = await requestFn(origin + '/auth', timeoutMs);
      if (auth.status === 200 && auth.body.includes(GATEWAY_MARKER)) {
        return { kind: 'gateway', origin };
      }
    } catch {}
  }

  return { kind: 'unknown', origin };
}

module.exports = { classifyBackendUrl };
