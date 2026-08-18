'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { dshInvocation } = require('./dsh-command');

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

// Works with either runtime shape — the system dsh binary or the bundled
// copy on Electron-as-Node. Both still need pnpm on the child's PATH, since
// `dsh plugin` forwards to it.
function installPlugin({ runtime, env, profileName, spec, timeoutMs = 120_000 }) {
  const inv = dshInvocation(runtime, ['plugin', '--profile', profileName, 'add', spec], {
    baseEnv: env,
  });
  return new Promise((resolve) => {
    execFile(inv.command, inv.args, { env: inv.env, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve(
        err
          ? { ok: false, spec, error: `${err.message}\n${stderr}`, output: `${stdout}\n${stderr}` }
          : { ok: true, spec, output: `${stdout}\n${stderr}`.trim() }
      );
    });
  });
}

// Installs whatever is missing, one at a time (pnpm and the profile's
// package.json do not take concurrent writers). Never throws — the app boots
// with what it has; failures are returned for reporting.
async function installMissingPlugins({ runtime, env, profileName, profileDir, plugins = DEFAULT_PLUGINS, onProgress = () => {} }) {
  const results = [];
  for (const plugin of missingPlugins(profileDir, plugins)) {
    const spec = resolveSpec(plugin);
    onProgress(`Installing ${plugin.name}…`);
    results.push(await installPlugin({ runtime, env, profileName, spec }));
  }
  return results;
}

// What the plugin-manager UI lists: every dsh-plugin-* in the profile, with
// its version and (for link: installs) where the symlink actually points.
function listInstalledPluginDetails(profileDir) {
  const nm = path.join(profileDir, 'node_modules');
  if (!fs.existsSync(nm)) return [];
  return fs
    .readdirSync(nm)
    .filter((name) => name.startsWith('dsh-plugin-'))
    .map((name) => {
      const dir = path.join(nm, name);
      let version = null;
      let linkTarget = null;
      try {
        version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
      } catch {}
      try {
        if (fs.lstatSync(dir).isSymbolicLink()) linkTarget = fs.realpathSync(dir);
      } catch {}
      return { name, version, linkTarget };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  DEFAULT_PLUGINS,
  missingPlugins,
  installedPlugins,
  resolveSpec,
  installPlugin,
  installMissingPlugins,
  listInstalledPluginDetails,
  expandHome,
};
