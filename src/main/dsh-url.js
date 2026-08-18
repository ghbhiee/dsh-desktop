'use strict';

// dsh, started with --port 0, takes a free port from the OS and announces it
// with exactly one stdout line: `dsh web: http://127.0.0.1:64196`. That line
// is the only source of truth for where the server lives — never a hardcoded
// port. The loose fallback tolerates wording drift across dsh versions but
// only ever matches loopback addresses, so a URL quoted inside some error
// message cannot send the window somewhere remote.

const URL_LINE = /^dsh web:\s+(https?:\/\/\S+)\s*$/m;
const LOOPBACK_URL = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+/;

function findDshUrl(text) {
  // stdout arrives in arbitrary chunks; a match inside an unterminated line
  // could be a truncated URL (e.g. `http://127.0` with the rest still in
  // flight). Only lines already ended by a newline are considered.
  const complete = text.slice(0, text.lastIndexOf('\n') + 1);
  if (!complete) return null;
  const line = URL_LINE.exec(complete);
  if (line) return line[1];
  const loose = LOOPBACK_URL.exec(complete);
  return loose ? loose[0] : null;
}

module.exports = { findDshUrl };
