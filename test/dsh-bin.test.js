'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDshRuntime } = require('../src/main/dsh-bin');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bin-'));
}

function makeBundle(dir) {
  fs.mkdirSync(path.join(dir, 'dsh', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dsh', 'lib', 'bin.js'), '');
  return dir;
}

test('override wins and is always a system runtime', () => {
  const bin = path.join(tmp(), 'dsh');
  fs.writeFileSync(bin, '');
  const bundled = makeBundle(tmp());
  assert.deepEqual(resolveDshRuntime({ override: bin, bundledDir: bundled }), {
    type: 'system',
    bin,
  });
});

test('a missing override resolves to nothing — never a silent fallback', () => {
  assert.equal(
    resolveDshRuntime({ override: '/no/such/dsh', bundledDir: makeBundle(tmp()) }),
    null
  );
});

test('bundled outranks system candidates', () => {
  const sysBin = path.join(tmp(), 'dsh');
  fs.writeFileSync(sysBin, '');
  const bundled = makeBundle(tmp());
  const runtime = resolveDshRuntime({ bundledDir: bundled, candidates: [sysBin] });
  assert.equal(runtime.type, 'bundled');
  assert.equal(runtime.script, path.join(bundled, 'dsh', 'lib', 'bin.js'));
  assert.equal(runtime.templateDir, path.join(bundled, 'profile-template'));
});

test('system candidates in order when nothing is bundled', () => {
  const dir = tmp();
  const second = path.join(dir, 'dsh2');
  fs.writeFileSync(second, '');
  const runtime = resolveDshRuntime({
    bundledDir: tmp(), // exists but has no dsh tree
    candidates: [path.join(dir, 'dsh1-missing'), second],
  });
  assert.deepEqual(runtime, { type: 'system', bin: second });
});

test('nothing anywhere: null', () => {
  assert.equal(resolveDshRuntime({ bundledDir: tmp(), candidates: [] }), null);
});
