'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Which dsh runs, in priority order:
//
//   1. DSH_DESKTOP_DSH_BIN — explicit override, always a system binary.
//   2. The bundled copy under the app's resources (mode A) — a packaged app
//      is deterministic about its own backend.
//   3. The machine's dsh by absolute path (mode B) — Finder-launched apps
//      cannot rely on PATH containing /opt/homebrew/bin.
//
// Returns { type: 'system', bin } or { type: 'bundled', script, templateDir }
// (script = the package's lib/bin.js; templateDir = the pre-populated
// profile shipped beside it), or null when nothing is found.

const CANDIDATES = ['/opt/homebrew/bin/dsh', '/usr/local/bin/dsh'];

function resolveDshRuntime({ override, bundledDir, candidates = CANDIDATES } = {}) {
  if (override) return fs.existsSync(override) ? { type: 'system', bin: override } : null;
  if (bundledDir) {
    const script = path.join(bundledDir, 'dsh', 'lib', 'bin.js');
    if (fs.existsSync(script)) {
      return { type: 'bundled', script, templateDir: path.join(bundledDir, 'profile-template') };
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { type: 'system', bin: candidate };
  }
  return null;
}

module.exports = { resolveDshRuntime, CANDIDATES };
