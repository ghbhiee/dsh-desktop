'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A dsh profile is just files (verified 2026-08-18 against dsh 0.1.0-rc.7):
// package.json naming the bundle stack, an empty cordis.yml root, and
// cordis.patch.yml for per-deployment overrides. dsh refuses to boot a
// profile that does not exist and will not create one, so the app assembles
// its own — under its own DSH_HOME, never touching ~/.dsh.

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

function profilePackageJson(pluginNames = []) {
  return (
    JSON.stringify(
      {
        name: 'dsh-profile-desktop',
        private: true,
        dsh: { profile: { bundles: [...BASE_BUNDLES, ...pluginNames] } },
      },
      null,
      2
    ) + '\n'
  );
}

function ensureProfile(profileDir, { pluginNames = [], defaultPatch = '[]\n' } = {}) {
  fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), profilePackageJson(pluginNames));
  fs.writeFileSync(path.join(profileDir, 'cordis.yml'), '[]\n');
  // cordis.patch.yml is where the user's own knobs live; write it once and
  // never clobber it afterwards.
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patchFile)) fs.writeFileSync(patchFile, defaultPatch);
  return profileDir;
}

module.exports = { ensureProfile, profilePackageJson, BASE_BUNDLES };
