'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// The desktop profile's plugins, and how the app obtains them. Two sources,
// per the build brief, and they are not exclusive: a local clone when one
// exists (dev machines — installs as link:, offline, instant), else the
// GitHub spec (lib/ is committed in every plugin repo, so no build step).
// Installation itself is `dsh plugin add`, which forwards to pnpm inside the
// profile — so pnpm must be on the child's PATH; when it is not, the app
// boots without the missing plugins rather than failing.
//
// Deliberately absent: dsh-plugin-discord (host-only bridge; running a
// second bot on the token the launchd web profile already uses would double
// every response) and dsh-plugin-cli-session (headless-only — in a web
// profile it hijacks the command line, per its own docs).

const DEFAULT_PLUGINS = [
  { name: 'dsh-plugin-workbench', clone: '~/dsh/dsh-plugin-workbench' },
  { name: 'dsh-plugin-mobile-shell', clone: '~/dsh/dsh-plugin-mobile-shell' },
  { name: 'dsh-plugin-snake', clone: '~/dsh/dsh-plugin-snake' },
];

function expandHome(p, home = os.homedir()) {
  return p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

function isInstalled(profileDir, pluginName) {
  return fs.existsSync(path.join(profileDir, 'node_modules', pluginName, 'package.json'));
}

function missingPlugins(profileDir, plugins = DEFAULT_PLUGINS) {
  return plugins.filter((plugin) => !isInstalled(profileDir, plugin.name));
}

function installedPlugins(profileDir, plugins = DEFAULT_PLUGINS) {
  return plugins.filter((plugin) => isInstalled(profileDir, plugin.name));
}

function resolveSpec(plugin, { home } = {}) {
  const clone = expandHome(plugin.clone, home);
  if (fs.existsSync(path.join(clone, 'package.json'))) return clone;
  return `github:ghbhiee/${plugin.name}`;
}

function installPlugin({ dshBin, env, profileName, spec, timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    execFile(
      dshBin,
      ['plugin', '--profile', profileName, 'add', spec],
      { env, timeout: timeoutMs },
      (err, stdout, stderr) => {
        resolve(err ? { ok: false, spec, error: `${err.message}\n${stderr}` } : { ok: true, spec });
      }
    );
  });
}

// Installs whatever is missing, one at a time (pnpm and the profile's
// package.json do not take concurrent writers). Never throws — the app boots
// with what it has; failures are returned for reporting.
async function installMissingPlugins({ dshBin, env, profileName, profileDir, plugins = DEFAULT_PLUGINS, onProgress = () => {} }) {
  const results = [];
  for (const plugin of missingPlugins(profileDir, plugins)) {
    const spec = resolveSpec(plugin);
    onProgress(`Installing ${plugin.name}…`);
    results.push(await installPlugin({ dshBin, env, profileName, spec }));
  }
  return results;
}

module.exports = {
  DEFAULT_PLUGINS,
  missingPlugins,
  installedPlugins,
  resolveSpec,
  installMissingPlugins,
  expandHome,
};
