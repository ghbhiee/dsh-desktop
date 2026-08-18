# dsh-desktop

An Electron desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
launch the app, get dsh in its own window — no terminal, no `localhost` typed
by hand, no dependence on the launchd service or the passkey gateway.

Three deployment modes, same window:

| Mode | Backend | Auth |
|---|---|---|
| Local, dsh not installed | shipped inside the app | none (loopback) |
| Local, dsh installed | the machine's own dsh, on its own port | none (loopback) |
| Remote | dsh on another host | passkey gateway |

All the plugins are supported — a plugin here commits its built `lib/`, so a
profile can be assembled by copying directories, with no pnpm and no network.

**Status: not started.** The build brief is [`docs/HANDOFF.md`](docs/HANDOFF.md)
— read it first; it records what has already been verified on this machine and
the fences not to trip.

Sibling projects: [dsh-plugin-workbench](https://github.com/ghbhiee/dsh-plugin-workbench),
[dsh-plugin-mobile-shell](https://github.com/ghbhiee/dsh-plugin-mobile-shell),
[dsh-plugin-cli-session](https://github.com/ghbhiee/dsh-plugin-cli-session),
[dsh-plugin-snake](https://github.com/ghbhiee/dsh-plugin-snake),
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).
