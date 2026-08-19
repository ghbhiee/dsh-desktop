# dsh-desktop

An Electron desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
launch the app, get dsh in its own window — no terminal, no `localhost` typed
by hand, no dependence on the launchd service or the passkey gateway.

Pick the backend from the **Backend → Connect to Backend…** menu; the choice
is remembered across launches.

| Backend | What it is | Auth |
|---|---|---|
| Managed (bundled) | dsh shipped inside the app, run on Electron's own Node | none (loopback) |
| Managed (system) | the machine's own dsh, spawned on its own port | none (loopback) |
| Attach | a dsh already running locally (e.g. the launchd service) | none (loopback) |
| Remote | dsh behind the auth gateway on another host | passkey, via the system browser |

The app detects dsh instances already running on the machine (it reads the
process table) and offers them in the picker; typing an address auto-detects
whether it is a bare dsh or a gateway and connects accordingly.

**Status: managed, attach and remote all work.** The app spawns dsh on its
own port under an app-owned `DSH_HOME`, assembles its `desktop` profile
itself, survives backend death with an in-window retry, and never leaves a
stray process. Packaged builds (`npm run pack` / `npm run dist`, arm64) ship
dsh inside — run on Electron's own Node via `ELECTRON_RUN_AS_NODE` — plus a
pre-populated profile template, so a machine with no dsh and no pnpm gets a
working terminal out of the box (~600 MB .app, as the brief predicted).

**Plugins** — install from **Plugins → Manage Plugins…**: a local path, a
GitHub URL, `owner/repo`, or a bare plugin name. The window shows the
equivalent terminal command to copy, and a successful install hot-restarts
dsh in place — the window stays up, no client restart. A plugin here commits
its built `lib/`, so profiles are assembled by copying directories, with no
pnpm and no network. To make a plugin a shipped default, add it to
`DEFAULT_PLUGINS` in `src/main/plugins.js`.

**Remote mode** — since Electron exposes no macOS platform authenticator (so
the passkey/Touch ID ceremony cannot run in-app), the app opens the gateway's
login page in the **system browser**; after signing in there, the page shows
a one-time pairing code that the app swaps for its own session cookie,
persisted so relaunches reconnect without re-authenticating. This needs the
gateway's pairing endpoints — see the `desktop-pairing` branch of
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).

All of it is verified by `npm test` (pure-module unit tests) and `npm run e2e`
(Playwright driving the real app, including the packaged one and a fake
gateway for the pairing round trip). The build brief is
[`docs/HANDOFF.md`](docs/HANDOFF.md) — read it first; it records what has
already been verified on this machine and the fences not to trip.

Sibling projects: [dsh-plugin-workbench](https://github.com/ghbhiee/dsh-plugin-workbench),
[dsh-plugin-mobile-shell](https://github.com/ghbhiee/dsh-plugin-mobile-shell),
[dsh-plugin-cli-session](https://github.com/ghbhiee/dsh-plugin-cli-session),
[dsh-plugin-snake](https://github.com/ghbhiee/dsh-plugin-snake),
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).
