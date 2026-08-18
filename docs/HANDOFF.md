# Handoff — dsh-desktop (Electron shell for DeepSeek Harness)

Brief for the session that builds this. It is written to be worked through
with `/loop`, so every milestone below ends in a check a session can run by
itself. Read this fully before writing code.

Companion docs on this machine (not in git): `~/dsh/OPS-dsh.md` (how dsh is
installed, run and restarted here) and `~/dsh/PLAN-dsh-plugins.md` (34 pitfalls
from the plugin work — several apply here).

## Goal

A macOS desktop app that opens DeepSeek Harness in its own window instead of a
browser tab: launch the app, get dsh. No terminal, no `localhost:3080` typed by
hand, no dependence on the launchd service or the passkey gateway.

Non-goals for now: replacing dsh's web UI with a native one, shipping to other
people (no notarization/auto-update until the app is worth installing), and
touching the plugins — the desktop app renders the same web UI those plugins
already extend.

## The architecture, and why

**Electron main process spawns `dsh` as a child process and points a
BrowserWindow at the URL it prints.** That is the whole idea.

```
Electron main ──spawn──> `dsh --profile <p> --host 127.0.0.1 --port 0`
      │                        │
      │                   prints: dsh web: http://127.0.0.1:64196
      └──BrowserWindow.loadURL( that URL )
```

Do **not** try to run dsh in-process (importing it into the Electron main
process). dsh depends on **node-pty**, a native module compiled against the
system Node's ABI; inside Electron it would have to be rebuilt for Electron's
ABI, and the terminal is exactly the feature that would break. Keeping dsh a
separate child process on the system Node sidesteps that whole class of pain,
and is why the browser-terminal keeps working for free.

### Facts already verified on this machine (do not re-derive)

- `dsh` is a global npm install at `/opt/homebrew/bin/dsh`, version
  `0.1.0-rc.7`.
- **`--port 0` works**: dsh asks the OS for a free port and prints
  `dsh web: http://127.0.0.1:64196` on stdout. Parse that line — never hardcode
  a port.
- **Port 3080 is taken** by the launchd service `com.tokencv.dsh-web`. The
  desktop app must not bind it.
- **A second dsh instance can run while the launchd one is running, on the same
  profile, with no lock conflict** — verified by starting one, watching it come
  up on its own port, killing it, and confirming the launchd instance still
  answered 200. So developing this app does not require stopping the service.
- dsh inherits the environment it is spawned with. The discord plugin, for
  instance, logs `no bot token (set … DSH_DISCORD_TOKEN …)` when the variable is
  absent. A GUI app launched from Finder gets a **minimal environment, not your
  shell's** — no `~/.zshrc`, so `PATH` may not contain `/opt/homebrew/bin` and
  plugin tokens will be missing. Resolve `dsh` by absolute path and decide
  deliberately what environment to pass.

### Fences you must not trip

The workbench plugin (already installed in the `web` profile) guards its
terminal and mutating routes with a **same-origin check**: it compares the
request's `Origin` against `Host` and refuses a mismatch (`403 cross_origin`).
dsh itself has a browser-trust fence over `/api` with a `--trusted-host` escape
hatch.

Loading `http://127.0.0.1:<port>` directly keeps `Origin` and `Host` consistent,
so everything works. If you ever switch the window to `file://`, a custom
protocol, or an embedded static build, **the terminal and file writes will start
returning 403** and it will look like a plugin bug. It is not. Keep the window
on the http origin dsh serves.

## Milestones

Each one is independently useful and ends in a runnable check. Do them in
order; do not start the next before the current one's check passes.

### M0 — Skeleton that opens dsh in a window
- `npm init`, Electron, a `main.js` (or `src/main.ts`) and nothing else.
- Spawn dsh with `--host 127.0.0.1 --port 0`; parse the URL from stdout with a
  regex on `dsh web: (http\S+)`; `loadURL` it.
- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The renderer is dsh's own web app — it needs no Node access,
  and giving it any would hand every plugin's client bundle the same.
- **Check**: `npm start` opens a window showing the dsh UI; the sidebar,
  a session, and the workbench panel all render.

### M1 — Lifecycle that never leaves a stray dsh behind
- Kill the child on window-close, on `before-quit`, and on `SIGINT`/`SIGTERM`.
- If dsh exits on its own, show something honest in the window (not a blank
  screen) and offer a retry; restart it rather than leaving a dead app.
- Single-instance lock (`app.requestSingleInstanceLock()`), so a second launch
  focuses the existing window instead of spawning a second dsh.
- **Check**: launch, quit, then `pgrep -fl "dsh --profile"` finds nothing left
  over. Launch twice → one window, one child process.

### M2 — Feels like an app, not a wrapped tab
- Window state (size/position) persisted across launches.
- A real menu: Reload, Toggle DevTools, Copy/Paste (Cmd+C/V do not work in
  Electron without an Edit menu — a classic omission), Zoom, Quit.
- External links (`target=_blank`, `http(s)` to other hosts) open in the
  system browser via `shell.openExternal`, not in the app window. Deny
  in-window navigation away from the dsh origin.
- **Check**: resize/move, quit, relaunch → geometry restored. Cmd+C/V work in
  the composer. An external link opens in the default browser.

### M3 — Which dsh, which profile
- Decide and implement: does the app use the existing `web` profile, or its own
  (e.g. `desktop`)? Sharing works (verified) and inherits the installed plugins;
  a dedicated profile isolates settings but starts with none of them installed.
  Whichever you choose, make it configurable and write down why.
- Handle `dsh` being missing or too old with a clear message instead of a
  silent failure.
- **Check**: with a deliberately wrong dsh path, the app explains the problem
  rather than showing a blank window.

### M4 — Packaging (only once M0–M3 are solid)
- `electron-builder` or `@electron-forge`, producing a `.app`/`.dmg` for arm64.
- Code signing and notarization are a real project of their own; do not start
  them until the app is something you would actually install. Unsigned local
  builds are fine for personal use.
- **Check**: the packaged app launches from `/Applications` (or the built
  output) with dsh spawning correctly — note that a packaged app gets the
  Finder environment, so this is where the `PATH` problem above bites.

## Verifying without a human (important for `/loop`)

A GUI app resists the usual "run the tests" loop. What actually works:

- **Playwright drives Electron** (`_electron.launch({ args: ['.'] })`). It can
  open the app, wait for the dsh UI, click, screenshot, and assert — all from a
  script, in CI. This is the single highest-value thing to set up early;
  without it a loop session is guessing.
- Everything below the window is ordinary Node: URL parsing, child lifecycle,
  environment assembly. **Keep those as pure modules and unit-test them** — the
  same discipline that made the plugins testable (see the sibling repos: the
  rules live in pure functions, the effects live in thin shells).
- Cheap process-level checks worth scripting: no stray `dsh` after quit, only
  one child per app instance, the window's URL matches the port dsh reported.

Do not report a milestone done on "it should work" — each check above is
mechanical on purpose.

## Working agreement — git is the source of truth

This convention already burned the plugin repos once: finished work sat
uncommitted in one place while another session built on top of it.

**Commit and push as soon as a change is finished.** Start a session with
`git pull` (or at minimum `git status && git log --oneline -3`), and never
assume the working tree is what git has.

First task of the first session: create the GitHub repo (`ghbhiee/dsh-desktop`,
matching the sibling naming) and push, so there is a remote to be the source of
truth. Keep it out of `~/dsh/plugins` and the plugin repos — this is its own
project.

## Guardrails

- **Never bind port 3080** and never stop, restart, or reconfigure
  `com.tokencv.dsh-web` or `com.tokencv.dsh-gateway`. The gateway is the login
  wall for remote access; the web service is the user's daily driver. This app
  runs its own dsh on its own port, alongside them.
- Do not modify the plugin repos or `~/.dsh/profiles/*` from this project. If
  the desktop app needs a plugin change, that is a change in that plugin's repo,
  by its own rules.
- The repo is public: no tokens, no `~/.dsh-gateway/state`, no session
  transcripts, nothing from `~/.dsh/sessions`.
- Renderer stays sandboxed. If a feature seems to need `nodeIntegration`, it
  almost certainly belongs in the main process behind a narrow IPC call
  instead.

## Open questions for the user (ask, do not guess)

- Shared `web` profile or a dedicated `desktop` profile (M3)?
- Should the app also offer the remote server (`ds.tokencv.com`, behind the
  passkey gateway) as a window, or is it local-dsh only?
- Tray icon / launch at login / global hotkey — wanted, or out of scope?
