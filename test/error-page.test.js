'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backendDownHtml, restartingHtml, toDataUrl, escapeHtml } = require('../src/main/error-page');

test('backend-down page names the exit and offers retry and quit', () => {
  const html = backendDownHtml({ code: 3, signal: null }, 'boom happened');
  assert.match(html, /exit code 3/);
  assert.match(html, /boom happened/);
  assert.match(html, /href="https:\/\/dshdesk\.invalid\/retry"/);
  assert.match(html, /href="https:\/\/dshdesk\.invalid\/quit"/);
});

test('a signal death is reported as the signal', () => {
  const html = backendDownHtml({ code: null, signal: 'SIGKILL' }, '');
  assert.match(html, /signal SIGKILL/);
});

test('child output is HTML-escaped, not interpreted', () => {
  const html = backendDownHtml({ code: 1, signal: null }, '<script>alert(1)</script>');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('escapeHtml covers the five specials', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('pages round-trip through the data: URL encoding', () => {
  const url = toDataUrl(restartingHtml());
  assert.ok(url.startsWith('data:text/html;charset=utf-8,'));
  assert.match(decodeURIComponent(url), /Restarting dsh/);
});
