'use strict';

// electron-builder afterPack hook: copy the staged mode-A bundle into the
// app's Resources. extraResources cannot do this — its filter machinery
// silently drops node_modules directories, and the dsh tree is mostly
// node_modules. rsync -a keeps file modes, so node-pty's spawn-helper stays
// executable. Runs before signing, so the resources are sealed into the
// signature.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BUNDLE = path.join(__dirname, '..', 'build', 'bundle');

module.exports = async function afterPack(context) {
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resources = path.join(context.appOutDir, appName, 'Contents', 'Resources');
  for (const part of ['dsh', 'profile-template']) {
    const from = path.join(BUNDLE, part);
    if (!fs.existsSync(from)) {
      throw new Error(`bundle part missing: ${from} — run \`npm run bundle\` first`);
    }
    execFileSync('rsync', ['-a', '--delete', from + '/', path.join(resources, part) + '/']);
  }
  const helper = path.join(
    resources,
    'dsh',
    'node_modules',
    'node-pty',
    'prebuilds',
    'darwin-arm64',
    'spawn-helper'
  );
  if (!fs.existsSync(helper)) throw new Error('spawn-helper missing after copy');
  fs.chmodSync(helper, 0o755);
  console.log(`  • bundled dsh + profile template into ${appName}`);
};
