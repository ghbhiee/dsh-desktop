'use strict';

const { execFile } = require('node:child_process');

// Finds dsh instances already running on this machine by reading the
// process table: every long-lived dsh carries an explicit `--port N` (the
// launchd service does; our own managed child does too once a preferred
// port exists). Port 0 lines are booting children whose real port is
// unknowable from here — skipped.

const DSH_LINE = /\bdsh\b|\bdsh\/lib\/bin\.js\b/;
const PORT_FLAG = /--port[= ](\d+)/;
const PROFILE_FLAG = /--profile[= ]([\w.-]+)/;

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
    const profileMatch = PROFILE_FLAG.exec(line);
    found.push({
      pid: Number(pidMatch[1]),
      port,
      profile: profileMatch ? profileMatch[1] : null,
    });
  }
  return found;
}

// A running dsh's DSH_HOME, read from its own environment. Absent means it
// is using dsh's default (~/.dsh) — which is exactly what the caller needs
// to know to write a correct command line for that instance.
function readDshHome(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['eww', '-o', 'command=', '-p', String(pid)], (err, stdout) => {
      if (err) return resolve(null);
      const match = /(?:^|\s)DSH_HOME=(\S+)/.exec(stdout);
      resolve(match ? match[1] : null);
    });
  });
}

// Who is listening on a port, and with what profile. Asking the kernel via
// lsof rather than pattern-matching the command line, because an instance
// started with `--port 0` never carries its real port there — the launchd
// service does, an ad-hoc `dsh` does not.
function inspectPort(port) {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { timeout: 5000 },
      (err, stdout) => {
        const pid = Number(String(stdout).trim().split('\n')[0]);
        if (err || !Number.isInteger(pid) || pid <= 0) return resolve(null);
        execFile('ps', ['-o', 'command=', '-p', String(pid)], (psErr, psOut) => {
          if (psErr) return resolve({ pid, profile: null });
          const match = PROFILE_FLAG.exec(psOut);
          resolve({ pid, profile: match ? match[1] : null });
        });
      }
    );
  });
}

function scanLocalDshPorts({ excludePids = [] } = {}) {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(parseDshPorts(stdout).filter((entry) => !excludePids.includes(entry.pid)));
    });
  });
}

module.exports = { parseDshPorts, scanLocalDshPorts, readDshHome, inspectPort };
