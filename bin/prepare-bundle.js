#!/usr/bin/env node
'use strict';

// Build step for mode A: stage everything the packaged app ships beside its
// own code. bin/after-pack.js then copies build/bundle/* into the app's
// Contents/Resources — electron-builder's own extraResources cannot, its
// filter machinery silently drops node_modules and the dsh tree is mostly
// node_modules.
//
//   build/bundle/dsh/               the dsh package tree, rsynced from this
//                                   machine's global install (~306 MB; keeps
//                                   file modes, so node-pty's spawn-helper
//                                   stays executable — losing that bit makes
//                                   every terminal spawn die with a bare
//                                   `posix_spawnp failed.`)
//   build/bundle/profile-template/  a ready profile: package.json bundle
//                                   stack + the plugins installed flat by
//                                   npm from packed tarballs — real files,
//                                   no pnpm store, no symlinks pointing at
//                                   this machine.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_PATCH, BASE_BUNDLES } = require('../src/main/profile');
const { DEFAULT_PLUGINS, resolveSpec } = require('../src/main/plugins');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'build', 'bundle');
const DSH_BIN = process.env.DSH_DESKTOP_DSH_BIN || '/opt/homebrew/bin/dsh';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function stageDshTree() {
  // /opt/homebrew/bin/dsh -> ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js
  const binReal = fs.realpathSync(DSH_BIN);
  const packageRoot = path.dirname(path.dirname(binReal));
  const dest = path.join(BUNDLE, 'dsh');
  fs.mkdirSync(dest, { recursive: true });
  console.log(`staging dsh tree from ${packageRoot}`);
  run('rsync', ['-a', '--delete', packageRoot + '/', dest + '/']);

  const helpers = run('find', [dest, '-name', 'spawn-helper'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const helper of helpers) fs.chmodSync(helper, 0o755);
  console.log(`spawn-helper execute bit ensured on ${helpers.length} file(s)`);

  const version = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version;
  console.log(`bundled dsh ${version}`);
}

function stageProfileTemplate() {
  const dest = path.join(BUNDLE, 'profile-template');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, 'node_modules'), { recursive: true });

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-pack-'));
  const tarballs = [];
  for (const plugin of DEFAULT_PLUGINS) {
    const spec = resolveSpec(plugin);
    console.log(`packing ${plugin.name} from ${spec}`);
    const out = run('npm', ['pack', spec, '--pack-destination', packDir], { encoding: 'utf8' });
    tarballs.push(path.join(packDir, out.trim().split('\n').pop()));
  }

  fs.writeFileSync(
    path.join(dest, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-desktop', private: true }, null, 2) + '\n'
  );
  console.log('installing plugins into the template (flat, offline-capable)');
  run('npm', ['install', '--prefix', dest, '--omit=dev', '--no-audit', '--no-fund', ...tarballs], {
    encoding: 'utf8',
  });

  // npm rewrote package.json with tarball paths as dependencies; the shipped
  // template needs the bundle stack and no machine-local paths.
  fs.writeFileSync(
    path.join(dest, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-profile-desktop',
        private: true,
        dsh: { profile: { bundles: [...BASE_BUNDLES, ...DEFAULT_PLUGINS.map((p) => p.name)] } },
      },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(path.join(dest, 'cordis.yml'), '[]\n');
  fs.writeFileSync(path.join(dest, 'cordis.patch.yml'), DEFAULT_PATCH);
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.rmSync(path.join(dest, 'package-lock.json'), { force: true });

  const installed = fs
    .readdirSync(path.join(dest, 'node_modules'))
    .filter((name) => !name.startsWith('.'));
  console.log(`template node_modules: ${installed.join(', ')}`);
}

stageDshTree();
stageProfileTemplate();
console.log('bundle staged at build/bundle');
