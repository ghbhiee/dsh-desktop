'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { findDshUrl } = require('./dsh-url');

// dsh runs as a child process by design — crash isolation, and the app never
// has to know dsh's internals. This wrapper owns exactly three things: spawn,
// URL discovery from stdout, and a stop() that cannot leave a stray behind.
//
// Events: 'url' (once, the announced web address), 'exit' ({code, signal,
// expected}), 'error' (spawn failure, e.g. binary missing).

const KILL_ESCALATION_MS = 3000;
const OUTPUT_RING_MAX = 8 * 1024;

class DshProcess extends EventEmitter {
  constructor({ command, args = [], env, cwd }) {
    super();
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.child = null;
    this.url = null;
    this.stopping = false;
    this.recentOutput = '';
  }

  start() {
    this.child = spawn(this.command, this.args, {
      env: this.env,
      cwd: this.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.on('error', (err) => this.emit('error', err));
    const onData = (chunk) => {
      this.recentOutput = (this.recentOutput + chunk).slice(-OUTPUT_RING_MAX);
      if (!this.url) {
        const url = findDshUrl(this.recentOutput);
        if (url) {
          this.url = url;
          this.emit('url', url);
        }
      }
    };
    this.child.stdout.on('data', onData);
    this.child.stderr.on('data', onData);
    this.child.on('exit', (code, signal) => {
      const expected = this.stopping;
      this.child = null;
      this.emit('exit', { code, signal, expected });
    });
    return this;
  }

  // SIGTERM first; SIGKILL if the child has not exited shortly after. The
  // returned promise resolves once the process is actually gone.
  stop() {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        if (this.child === child) child.kill('SIGKILL');
      }, KILL_ESCALATION_MS);
      killTimer.unref?.();
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  get running() {
    return this.child !== null;
  }
}

module.exports = { DshProcess };
