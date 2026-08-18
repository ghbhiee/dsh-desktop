'use strict';

const path = require('node:path');
const os = require('node:os');

// What the user may type into the plugin-install box, normalized to a spec
// pnpm understands:
//
//   ~/dsh/dsh-plugin-x  /abs/path  ./rel        → local path (link: install)
//   https://github.com/owner/repo[.git][/...]   → github:owner/repo
//   github:owner/repo                           → as-is
//   owner/repo                                  → github:owner/repo
//   dsh-plugin-x  |  x                          → github:ghbhiee/dsh-plugin-x

const DEFAULT_OWNER = 'ghbhiee';

function normalizePluginSpec(raw, { home = os.homedir() } = {}) {
  const input = String(raw ?? '').trim();
  if (!input) return { error: '请输入插件来源' };

  if (/^(~\/|\.{1,2}\/|\/)/.test(input)) {
    const abs = input.startsWith('~/') ? path.join(home, input.slice(2)) : path.resolve(input);
    return { kind: 'local', spec: abs };
  }

  const url = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(input);
  if (url) return { kind: 'github', spec: `github:${url[1]}/${url[2]}` };

  if (/^github:[\w.-]+\/[\w.-]+$/.test(input)) return { kind: 'github', spec: input };

  if (/^[\w.-]+\/[\w.-]+$/.test(input)) return { kind: 'github', spec: `github:${input}` };

  if (/^[\w.-]+$/.test(input)) {
    const name = input.startsWith('dsh-plugin-') ? input : `dsh-plugin-${input}`;
    return { kind: 'github', spec: `github:${DEFAULT_OWNER}/${name}` };
  }

  return { error: `无法识别的插件来源：${input}` };
}

function shellQuote(text) {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${String(text).replaceAll("'", `'\\''`)}'`;
}

// The terminal command equivalent of what the app itself would run — shown
// in the UI for users who prefer to install by hand.
function buildInstallCommand({ runtime, dshHome, profileName, spec, execPath = process.execPath }) {
  const parts = [`DSH_HOME=${shellQuote(dshHome)}`];
  if (runtime.type === 'bundled') {
    parts.push('ELECTRON_RUN_AS_NODE=1', shellQuote(execPath), '--expose-internals', shellQuote(runtime.script));
  } else {
    parts.push(shellQuote(runtime.bin));
  }
  parts.push('plugin', '--profile', shellQuote(profileName), 'add', shellQuote(spec));
  return parts.join(' ');
}

module.exports = { normalizePluginSpec, buildInstallCommand, shellQuote, DEFAULT_OWNER };
