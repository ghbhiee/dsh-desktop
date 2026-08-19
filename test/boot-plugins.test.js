'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBootPlugins } = require('../src/main/plugins');

// Shape taken from a real dsh page: one long script assignment, core
// packages under @deepseek-ai plus whatever plugins the profile loaded.
function page(ids) {
  const entries = ids.map((id) => `{"id":"${id}","url":"/plugins/${id}/client.js","inject":[]}`);
  return `<!doctype html><html><head><script>window.__DSH_BOOT__ = {"rev":"abc","entries":[${entries.join(',')}]}</script></head><body></body></html>`;
}

test('lists profile plugins and drops the @deepseek-ai core', () => {
  const html = page([
    '@deepseek-ai/dsh-client-runtime',
    'dsh-plugin-workbench',
    '@deepseek-ai/dsh-client-ui-layout',
    'dsh-plugin-mobile-shell',
  ]);
  assert.deepEqual(parseBootPlugins(html), [
    { name: 'dsh-plugin-mobile-shell', version: null, linkTarget: null },
    { name: 'dsh-plugin-workbench', version: null, linkTarget: null },
  ]);
});

test('duplicates collapse and order is stable', () => {
  const html = page(['dsh-plugin-snake', 'dsh-plugin-snake', 'dsh-plugin-alpha']);
  assert.deepEqual(
    parseBootPlugins(html).map((p) => p.name),
    ['dsh-plugin-alpha', 'dsh-plugin-snake']
  );
});

test('a page with no plugins yields an empty list, not null', () => {
  assert.deepEqual(parseBootPlugins(page(['@deepseek-ai/dsh-client-runtime'])), []);
});

test('null when the payload is absent or unparseable — caller must not guess', () => {
  assert.equal(parseBootPlugins('<html>no boot here</html>'), null);
  assert.equal(parseBootPlugins('<script>window.__DSH_BOOT__ = {broken</script>'), null);
  assert.equal(parseBootPlugins(''), null);
});
