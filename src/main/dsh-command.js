'use strict';

// How to invoke dsh, given a resolved runtime. Two shapes:
//
// - system: the machine's own dsh binary, invoked directly (mode B).
// - bundled: the dsh package shipped inside the app, run on Electron's own
//   embedded Node via ELECTRON_RUN_AS_NODE (mode A) — no separate Node
//   runtime to ship. Verified 2026-08-18: dsh 0.1.0-rc.7 boots fully this
//   way provided --expose-internals is on the argv (its HMR service demands
//   the flag, and NODE_OPTIONS refuses it, so it must lead the arguments).

function dshInvocation(runtime, args, { baseEnv = {}, execPath = process.execPath } = {}) {
  if (runtime.type === 'bundled') {
    return {
      command: execPath,
      args: ['--expose-internals', runtime.script, ...args],
      env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  return { command: runtime.bin, args: [...args], env: { ...baseEnv } };
}

module.exports = { dshInvocation };
