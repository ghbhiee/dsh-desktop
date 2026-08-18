'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Window geometry, persisted across launches. Storage is one JSON file in
// userData; anything malformed or implausible falls back to defaults rather
// than opening a 3-pixel window off-screen.

const STATE_FILE = 'window-state.json';
const DEFAULTS = { width: 1200, height: 800 };
const MIN_SIZE = 200;

function sanitizeBounds(raw, defaults = DEFAULTS) {
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const out = { ...defaults };
  if (Number.isFinite(raw.width) && raw.width >= MIN_SIZE) out.width = Math.round(raw.width);
  if (Number.isFinite(raw.height) && raw.height >= MIN_SIZE) out.height = Math.round(raw.height);
  // x/y only together, and only as finite numbers — otherwise let the OS place
  // the window.
  if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
    out.x = Math.round(raw.x);
    out.y = Math.round(raw.y);
  }
  return out;
}

function loadWindowState(dir, defaults = DEFAULTS) {
  try {
    return sanitizeBounds(JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')), defaults);
  } catch {
    return { ...defaults };
  }
}

function saveWindowState(dir, bounds) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(sanitizeBounds(bounds)) + '\n');
  } catch {
    // Persisting geometry is best-effort; never let it break the app.
  }
}

// Attach to a BrowserWindow: save on move/resize (debounced) and on close.
function trackWindowState(win, dir, { debounceMs = 500 } = {}) {
  let timer = null;
  const save = () => saveWindowState(dir, win.getBounds());
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(save, debounceMs);
    timer.unref?.();
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });
}

module.exports = { loadWindowState, saveWindowState, trackWindowState, sanitizeBounds, STATE_FILE };
