'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Which backend the window points at, persisted in userData:
//
//   { type: 'managed' }                       spawn our own dsh (default)
//   { type: 'attach', url }                   a dsh already running locally
//   { type: 'remote', url }                   dsh behind the auth gateway
//
// Anything malformed degrades to managed — the mode that needs no input.

const CONFIG_FILE = 'config.json';
const MANAGED = { type: 'managed' };

function sanitizeBackend(raw) {
  if (!raw || typeof raw !== 'object') return { ...MANAGED };
  if (raw.type === 'managed') return { ...MANAGED };
  if ((raw.type === 'attach' || raw.type === 'remote') && typeof raw.url === 'string') {
    try {
      const url = new URL(raw.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { type: raw.type, url: url.origin };
      }
    } catch {}
  }
  return { ...MANAGED };
}

function loadBackendConfig(dir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG_FILE), 'utf8'));
    return sanitizeBackend(config.backend);
  } catch {
    return { ...MANAGED };
  }
}

function saveBackendConfig(dir, backend) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, CONFIG_FILE);
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    config.backend = sanitizeBackend(backend);
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  } catch {
    // Losing the preference only costs a picker visit.
  }
}

module.exports = { loadBackendConfig, saveBackendConfig, sanitizeBackend };
