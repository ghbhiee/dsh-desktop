'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A dsh profile is just files (verified 2026-08-18 against dsh 0.1.0-rc.7):
// package.json naming the bundle stack, an empty cordis.yml root, and
// cordis.patch.yml for per-deployment overrides. dsh refuses to boot a
// profile that does not exist and will not create one, so the app assembles
// its own — under its own DSH_HOME, never touching ~/.dsh.
//
// `dsh plugin add` (pnpm underneath) writes dependencies and bundle entries
// into the profile's package.json, so ensureProfile merges rather than
// rewrites: bundles are unioned, every other field is preserved.

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

// The patch written into a fresh profile. A desktop app wants the browser
// terminal, so workbench's ptyEnabled is on from the start.
const DEFAULT_PATCH = `# dsh-desktop profile overrides. Edit freely — the app rewrites this file
# only while it is empty ([]).
- id: workbench
  config:
    ptyEnabled: true
`;

const EMPTY_PATCH = '[]\n';

function ensureProfile(profileDir, { pluginNames = [], defaultPatch = DEFAULT_PATCH } = {}) {
  fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });

  const pkgFile = path.join(profileDir, 'package.json');
  let pkg = { name: 'dsh-profile-desktop', private: true };
  if (fs.existsSync(pkgFile)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    } catch {
      // Corrupt profile package.json: fall through to a clean skeleton.
    }
  }
  const existing = pkg?.dsh?.profile?.bundles ?? [];
  const bundles = [...BASE_BUNDLES];
  for (const name of [...existing, ...pluginNames]) {
    if (!bundles.includes(name)) bundles.push(name);
  }
  pkg.dsh = { ...(pkg.dsh || {}), profile: { ...(pkg.dsh?.profile || {}), bundles } };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

  fs.writeFileSync(path.join(profileDir, 'cordis.yml'), '[]\n');

  // cordis.patch.yml is the user's file. It is written when missing or still
  // the empty list; any real content is never touched.
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  if (!fs.existsSync(patchFile) || fs.readFileSync(patchFile, 'utf8') === EMPTY_PATCH) {
    fs.writeFileSync(patchFile, defaultPatch);
  }
  return profileDir;
}

module.exports = { ensureProfile, BASE_BUNDLES, DEFAULT_PATCH };
