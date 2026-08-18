'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The OS assigns dsh's port on first boot (--port 0); remembering it per
// profile keeps the origin stable across launches, which is what lets the
// dsh web UI's origin-keyed state (settings, the one-time notice flag)
// survive a restart. Never a hardcoded port: the stored value is only ever a
// port dsh actually announced, and a taken port falls back to --port 0.
//
// The store lives inside DSH_HOME, beside profiles/ — backend state travels
// with the backend.

const STORE_FILE = 'preferred-ports.json';

function loadPreferredPort(dshHome, profileName) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(dshHome, STORE_FILE), 'utf8'));
    const port = store[profileName];
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

function savePreferredPort(dshHome, profileName, port) {
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return;
  try {
    let store = {};
    try {
      store = JSON.parse(fs.readFileSync(path.join(dshHome, STORE_FILE), 'utf8'));
    } catch {}
    store[profileName] = port;
    fs.mkdirSync(dshHome, { recursive: true });
    fs.writeFileSync(path.join(dshHome, STORE_FILE), JSON.stringify(store, null, 2) + '\n');
  } catch {
    // Best-effort: losing the preference only costs origin stability.
  }
}

module.exports = { loadPreferredPort, savePreferredPort, STORE_FILE };
