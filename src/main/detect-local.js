'use strict';

const { execFile } = require('node:child_process');

// Finds dsh instances already running on this machine by reading the
// process table: every long-lived dsh carries an explicit `--port N` (the
// launchd service does; our own managed child does too once a preferred
// port exists). Port 0 lines are booting children whose real port is
// unknowable from here — skipped.

const DSH_LINE = /\bdsh\b|\bdsh\/lib\/bin\.js\b/;
const PORT_FLAG = /--port[= ](\d+)/;

function parseDshPorts(psOutput) {
  const seen = new Set();
  const found = [];
  for (const line of String(psOutput).split('\n')) {
    if (!DSH_LINE.test(line)) continue;
    const pidMatch = /^\s*(\d+)\s/.exec(line);
    const portMatch = PORT_FLAG.exec(line);
    if (!pidMatch || !portMatch) continue;
    const port = Number(portMatch[1]);
    if (port <= 0 || seen.has(port)) continue;
    seen.add(port);
    found.push({ pid: Number(pidMatch[1]), port });
  }
  return found;
}

function scanLocalDshPorts({ excludePids = [] } = {}) {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(parseDshPorts(stdout).filter((entry) => !excludePids.includes(entry.pid)));
    });
  });
}

module.exports = { parseDshPorts, scanLocalDshPorts };
