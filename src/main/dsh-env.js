'use strict';

const path = require('node:path');

// A GUI app launched from Finder gets launchd's minimal environment, not the
// user's shell — no ~/.zshrc, so PATH may lack /opt/homebrew/bin and any
// profile env vars are absent. The child's environment is therefore built
// deliberately rather than trusted to be complete.

function buildDshEnv({ baseEnv = {}, dshHome, extraPathDirs = [] }) {
  const env = { ...baseEnv };
  const pathDirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of extraPathDirs) {
    if (!pathDirs.includes(dir)) pathDirs.push(dir);
  }
  env.PATH = pathDirs.join(path.delimiter);
  if (dshHome) env.DSH_HOME = dshHome;
  return env;
}

module.exports = { buildDshEnv };
