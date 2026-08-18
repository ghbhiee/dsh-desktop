# dsh-desktop

An Electron desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
launch the app, get dsh in its own window — no terminal, no `localhost` typed
by hand, no dependence on the launchd service or the passkey gateway.

It spawns `dsh --host 127.0.0.1 --port 0` as a child process and points a
window at the URL dsh prints. dsh stays on the system Node, which is what keeps
the browser terminal (native `node-pty`) working.

**Status: not started.** The build brief is [`docs/HANDOFF.md`](docs/HANDOFF.md)
— read it first; it records what has already been verified on this machine and
the fences not to trip.

Sibling projects: [dsh-plugin-workbench](https://github.com/ghbhiee/dsh-plugin-workbench),
[dsh-plugin-mobile-shell](https://github.com/ghbhiee/dsh-plugin-mobile-shell),
[dsh-plugin-cli-session](https://github.com/ghbhiee/dsh-plugin-cli-session),
[dsh-plugin-snake](https://github.com/ghbhiee/dsh-plugin-snake),
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).
