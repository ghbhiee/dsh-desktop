'use strict';

const fs = require('node:fs');

// Finder-launched apps cannot rely on PATH containing /opt/homebrew/bin, so
// dsh is resolved by absolute path. The override exists for tests and for
// machines that install dsh somewhere unusual.

const CANDIDATES = ['/opt/homebrew/bin/dsh', '/usr/local/bin/dsh'];

function resolveDshBin({ override, candidates = CANDIDATES } = {}) {
  if (override) return fs.existsSync(override) ? override : null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = { resolveDshBin, CANDIDATES };
