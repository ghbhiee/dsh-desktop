'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMenuTemplate, REPO_URL } = require('../src/main/menu');

test('the template carries an Edit menu — Cmd+C/V depend on it', () => {
  const template = buildMenuTemplate({ openExternal: () => {} });
  assert.ok(template.some((item) => item.role === 'editMenu'));
});

test('help links out through the injected opener, not directly', () => {
  const opened = [];
  const template = buildMenuTemplate({ openExternal: (url) => opened.push(url) });
  const help = template.find((item) => item.role === 'help');
  help.submenu[0].click();
  assert.deepEqual(opened, [REPO_URL]);
});
