# dsh-desktop

An Electron desktop shell for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
launch the app, get dsh in its own window — no terminal, no `localhost` typed
by hand, no dependence on the launchd service or the passkey gateway.

## Install

Grab the DMG from [the latest release](https://github.com/ghbhiee/dsh-desktop/releases/latest)
(Apple Silicon, ~171 MB) and drag the app to `/Applications`. **No dsh and no
pnpm needed on the machine** — the app ships its own.

It is unsigned and un-notarized, so the first launch needs a trip through
**System Settings → Privacy & Security → Open Anyway**.

To build it yourself: `npm install && npm run dist` (writes `dist/`; the
bundle step copies this machine's dsh into the app, so a working `dsh` is
required *for the build*, not for running the result).

## Backends

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

A managed backend is the app's own child process: it spawns dsh on a free
port under an app-owned `DSH_HOME`, assembles the `desktop` profile itself,
explains a backend crash in the window with a retry, and never leaves a stray
process behind. Attach and remote point the same window at a dsh the app does
not own, so it starts no child and touches no profile.

## Remote mode

Electron exposes no macOS platform authenticator, so the passkey/Touch ID
ceremony cannot run in-app. Instead the app opens the gateway's login page in
the **system browser**; after signing in there, the page shows a one-time
pairing code that the app swaps for its own session cookie, persisted so
relaunches reconnect without re-authenticating. An expired or revoked session
lands back on the pairing page rather than a dead login form.

This needs the gateway's `/auth/pair/{code,claim}` endpoints — on `main` of
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway) since
2026-08-18.

## Plugins

Install from **Plugins → Manage Plugins…**: a local path, a GitHub URL,
`owner/repo`, or a bare plugin name. The window shows the equivalent terminal
command to copy, and a successful install hot-restarts dsh in place — the
window stays up, no client restart.

When the window is pointed at a dsh the app does not manage, the command
targets *that* instance (its pid via `lsof`, its profile and `DSH_HOME` from
the process table) and installing is disabled: the app will not write into a
profile it does not own, nor restart a service it does not manage.

A plugin here commits its built `lib/`, so profiles are assembled by copying
directories, with no pnpm and no network. To make a plugin a shipped default,
add it to `DEFAULT_PLUGINS` in `src/main/plugins.js`.

## Development

```sh
npm install
npm start        # run from source
npm test         # unit tests over the pure modules
npm run e2e      # Playwright drives the real app, packaged build included
npm run dist     # bundle dsh + build the DMG
```

The build brief is [`docs/HANDOFF.md`](docs/HANDOFF.md) — read it first; it
records what has already been verified on this machine and the fences not to
trip.

Sibling projects: [dsh-plugin-workbench](https://github.com/ghbhiee/dsh-plugin-workbench),
[dsh-plugin-mobile-shell](https://github.com/ghbhiee/dsh-plugin-mobile-shell),
[dsh-plugin-cli-session](https://github.com/ghbhiee/dsh-plugin-cli-session),
[dsh-plugin-snake](https://github.com/ghbhiee/dsh-plugin-snake),
[dsh-auth-gateway](https://github.com/ghbhiee/dsh-auth-gateway).
