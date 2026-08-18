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

**Status: modes A and B work.** The app spawns dsh on its own port under an
app-owned `DSH_HOME`, assembles its `desktop` profile itself, survives
backend death with an in-window retry, and never leaves a stray process.
Packaged builds (`npm run pack` / `npm run dist`, arm64) ship dsh inside —
run on Electron's own Node via `ELECTRON_RUN_AS_NODE` — plus a pre-populated
profile template, so a machine with no dsh and no pnpm gets a working
terminal out of the box (~600 MB .app, as the brief predicted). Dev installs
plugins via `dsh plugin add` (local clones as `link:`, else `github:`).
All of it is verified by `npm test` (pure-module unit tests) and
`npm run e2e` (Playwright driving the real app, including the packaged one).
Mode C (remote via the passkey gateway) is blocked on a design decision:
Electron exposes no macOS platform authenticator, so Touch ID cannot happen
in-app — see the brief. The build brief is [`docs/HANDOFF.md`](docs/HANDOFF.md)
— read it first; it records what has already been verified on this machine
and the fences not to trip.

Sibling projects: [dsh-plugin-workbench](https://github.com/ghbhiee/dsh-plugin-workbench),
[dsh-plugin-mobile-shell](https://github.com/ghbhiee/dsh-plugin-mobile-shell),
[dsh-plugin-cli-session](https://github.com/ghbhiee/dsh-plugin-cli-session),
[dsh-plugin-snake](https://github.com/ghbhiee/dsh-plugin-snake),
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).
