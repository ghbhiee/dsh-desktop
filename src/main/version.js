'use strict';

// dsh versions look like 0.1.0-rc.7 — semver with an optional rc prerelease.
// Everything below the verified floor gets a clear message instead of an
// obscure boot failure.

const MIN_DSH_VERSION = '0.1.0-rc.7';

function parseDshVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/.exec(String(text));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    // A release outranks every rc of the same triple; Infinity encodes that.
    rc: m[4] === undefined ? Infinity : Number(m[4]),
  };
}

// negative: a < b, 0: equal, positive: a > b. Null (unparseable) sorts lowest.
function compareDshVersions(a, b) {
  const va = typeof a === 'string' ? parseDshVersion(a) : a;
  const vb = typeof b === 'string' ? parseDshVersion(b) : b;
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  for (const key of ['major', 'minor', 'patch', 'rc']) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  return 0;
}

function isSupportedDshVersion(text, min = MIN_DSH_VERSION) {
  return compareDshVersions(text, min) >= 0;
}

module.exports = { parseDshVersion, compareDshVersions, isSupportedDshVersion, MIN_DSH_VERSION };
