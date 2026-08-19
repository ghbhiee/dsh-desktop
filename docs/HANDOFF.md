# Handoff — dsh-desktop (Electron shell for DeepSeek Harness)

Brief for the session that builds this. Written to be worked with `/loop`, so
every milestone ends in a check a session can run by itself. Read it fully
before writing code.

Companion docs on this machine (not in git): `~/dsh/OPS-dsh.md` (how dsh is
installed, run and restarted here) and `~/dsh/PLAN-dsh-plugins.md` (34 pitfalls
from the plugin work — several apply here).

## What this is

The app is, at bottom, **a window onto a dsh web UI** — the same UI the browser
shows, with the same plugins. What differs between deployments is only *where
that backend lives and who starts it*. Three modes, in increasing difficulty:

| Mode | Backend | What the app must do | Auth |
|---|---|---|---|
| **A. Local, dsh not installed** | shipped inside the app | provide dsh + a profile, start it on launch | none (loopback) |
| **B. Local, dsh installed** | the machine's own dsh | spawn it (or attach), on its own port | none (loopback) |
| **C. Remote** | dsh on another host | connect over the network | **passkey gateway** |

A and B are the same app with different sources of the dsh binary; C is a
different problem — no child process at all, just a window plus authentication.
They were built in that order (B, then A, then C), and a fourth arrived later:
**attach**, connecting to a dsh someone else already started. See the status
section below for what exists today.

## Research already done — do not re-derive

Everything here was verified on this machine on 2026-08-18. Where it corrects
an earlier assumption, that is called out.

### dsh itself

- `dsh` 0.1.0-rc.7, global npm install at `/opt/homebrew/bin/dsh`, **306 MB**
  on disk including its own `node_modules`. That is the bundling cost for mode A
  (Electron itself is ~200 MB, so this roughly doubles the app).
- **`--port 0` works**: dsh takes a free port from the OS and prints
  `dsh web: http://127.0.0.1:64196` on stdout. Parse that line. Never hardcode
  a port.
- **Port 3080 is taken** by the launchd service `com.tokencv.dsh-web`.
- **A second dsh instance runs fine alongside the launchd one, on the same
  profile, with no lock conflict** — started one, watched it come up on its own
  port, killed it, confirmed the service still answered 200. Development does
  not require stopping anything.
- dsh inherits the environment it is spawned with. A GUI app launched from
  Finder gets a **minimal environment, not your shell's** — no `~/.zshrc`, so
  `PATH` may lack `/opt/homebrew/bin`, and plugin env vars (e.g.
  `DSH_DISCORD_TOKEN`) will be missing. Resolve `dsh` by absolute path and
  decide deliberately what environment to pass.

### node-pty — correcting an earlier claim

An earlier draft of this brief said dsh must stay out of the Electron process
because node-pty would need rebuilding for Electron's ABI. **That is wrong for
this version.** node-pty 1.2.0-beta.15 depends on `node-addon-api`, and its
prebuilt `pty.node` exports `napi_register_module_v` — it is an **N-API**
addon, which is ABI-stable across Node versions *and* loads in Electron without
a rebuild. It ships prebuilds for all six darwin/linux/win32 × arm64/x64
combinations.

So bundling dsh is not blocked by native modules. Running dsh as a **child
process** is still the recommended design — crash isolation, dsh is a CLI built
to be a process, and the app never has to track dsh's internals — but choose it
for those reasons, not for an ABI problem that does not exist.

One real native detail survives: node-pty's `spawn-helper` needs its execute
bit. A packaging step that loses file modes (some zip/asar paths do) makes every
terminal spawn fail with a bare `posix_spawnp failed.`. The workbench plugin
already chmods it defensively; a packaged app should verify it too.

### Plugins — how installation actually works, and the packaged answer

Normally `dsh plugin add …` **forwards to pnpm** inside the profile directory:
it writes `dependencies` plus an entry in `dsh.profile.bundles`, then pnpm
installs. That needs pnpm on `PATH` and (for `github:` specs) network — neither
is guaranteed in a packaged app.

**Verified alternative: a profile can be hand-assembled, with no pnpm and no
network.** A directory containing only

```
package.json        # { "dsh": { "profile": { "bundles": [...] } } }
cordis.yml          # []
cordis.patch.yml    # []   ← per-deployment config overrides live here
node_modules/dsh-plugin-<name>/    # the plugin directory, copied in
```

booted correctly and served `/plugins/dsh-plugin-snake/client.js` → 200. This
works because every plugin here commits its built `lib/`, so a plugin is just
files — nothing to compile at install time.

That gives the app two strategies, and they are not exclusive:

- **Ship a pre-populated profile** (modes A and B): copy the plugin directories
  in at build time. Deterministic, offline, no pnpm. The cost is that updating a
  plugin means shipping a new app version.
- **Use `dsh plugin add` at runtime** when pnpm exists: keeps plugins updatable
  independently (`github:ghbhiee/dsh-plugin-<name>` — see `~/dsh/OPS-dsh.md`).

The plugins to support: `workbench` (files + preview + terminal panel),
`mobile-shell` (narrow-viewport drawer), `snake` (game panel), `discord`
(**host-only — it has no client bundle, so no `/client.js`; a 404 there is
correct, not a failure**), and `cli-session` (headless CLI runner — belongs in a
headless profile, **never** a web profile: it takes over the command line and
makes `dsh web` reject its own flags).

Note which knobs live in `cordis.patch.yml` rather than code: the workbench's
`ptyEnabled` (browser terminal, off by default), `writeEnabled`, `readRoots`.
A desktop app almost certainly wants `ptyEnabled: true`.

### Mode C — the gateway, and the one thing that could block it

`~/dsh/dsh-auth-gateway` is a reverse proxy in front of dsh. Its flow, from its
own source: **passkey (WebAuthn) login → pending → terminal approval
(`dsh-approve`) → session cookie (`dsh_auth`, 24 h) → proxy to dsh**. There is
**no token or API-key path** — WebAuthn is the only way in, and the RP ID is
bound to the public hostname (`ds.tokencv.com`).

**Therefore the first question mode C must answer, before any UI work: can
Electron complete a WebAuthn ceremony with a platform authenticator (Touch ID)?**

**Answered 2026-08-18, and the answer is no.** A throwaway hidden
BrowserWindow (sandboxed, context-isolated) loading `https://ds.tokencv.com/`
reports `PublicKeyCredential` present but
`isUserVerifyingPlatformAuthenticatorAvailable()` **false** — Electron has no
macOS platform authenticator, so the ceremony cannot happen in-app at all.

Three ways out were on the table: pair via the system browser; add a
device-credential path (mTLS or a long-lived token) to the gateway; or drop
mode C and just open the remote UI in a browser.

**Option 1 shipped.** The gateway grew `/auth/pair/code` (a signed-in browser
mints an 8-char single-use code, 2-minute TTL) and `/auth/pair/claim` (the app
swaps it for its own session cookie). The claimed session carries the same
user and credential lineage as the browser login that minted it, so revoking
the passkey still kills both. The login page only shows a code when opened
with `?pair=1`, which is how the app opens it — ordinary browser logins are
untouched. Deployed on server 15 on 2026-08-18.

## Status — all milestones landed (2026-08-19)

Every milestone below is built and mechanically verified: **76 unit tests**
(`npm test`, over the pure modules) and **14 e2e** (`npm run e2e`, Playwright
driving the real app — including the packaged `.app` and a fake gateway).
Repo: <https://github.com/ghbhiee/dsh-desktop>. Read the milestone sections
for the *reasoning*; this section is what actually exists now.

What the app grew beyond the original brief, all of it on the user's later
request:

- **Backend picker** (`Backend → Connect to Backend…`). Four backends, one
  window: bundled dsh, system dsh, **attach** to an already-running local dsh
  (found by reading the process table), and **remote** through the gateway.
  The choice persists; a typed address is classified by probing it —
  `__DSH_BOOT__` in the body means dsh, a 302 to a `/auth` page titled
  DeepSeek Harness means gateway.
- **Plugin manager** (`Plugins → Manage Plugins…`). Installs from a local
  path, a GitHub URL, `owner/repo`, or a bare name; shows the equivalent
  terminal command to copy; **hot-restarts dsh in place** on success, so the
  window never goes away. Disabled while attached to someone else's dsh.
- **Remote pairing** — the answer to the WebAuthn question below. The passkey
  ceremony runs in the system browser; the login page (opened with `?pair=1`)
  shows a one-time code the app swaps for its own session cookie, persisted so
  relaunches reconnect silently. Needs the gateway's `/auth/pair/{code,claim}`
  endpoints — **already deployed on server 15 (`ds.tokencv.com`)**; see that
  repo's HANDOFF for the deployment and its STATE_DIR trap.
- **Per-profile port memory** (`preferred-ports.json` in `DSH_HOME`). dsh
  still takes an OS-assigned port on first boot, but the app reuses it after,
  so the origin — and the web UI's origin-keyed localStorage — survives a
  restart. A taken port falls back to `--port 0`.
- **DeepSeek icon**, built from dsh's own `favicon.svg`.

**M5 closed on 2026-08-18 23:40**, on the real gateway with a real Touch ID
login: the browser minted a code (`pairing code issued by session …`), the
app claimed it (`pairing claimed -> session 2c80ac84`), the cookie landed in
the app's store, and `config.json` flipped to remote. Re-checked the next
day — that session still answers 200 and is registered gateway-side. Nothing
in this brief is left waiting on a human.

## Milestones

Each is independently useful and ends in a runnable check. Do not start the next
before the current one's check passes.

### M0 — Mode B: a window onto local dsh
Spawn `dsh --host 127.0.0.1 --port 0`, parse the URL from stdout, `loadURL` it.
BrowserWindow with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` — the renderer is dsh's web app and needs no Node access;
granting it any would hand the same to every plugin's client bundle.

**Check**: `npm start` opens a window with the dsh UI; a session renders and the
workbench panel opens.

### M1 — Lifecycle that never leaves a stray dsh
Kill the child on window-close, `before-quit`, `SIGINT`/`SIGTERM`. If dsh exits
by itself, say so in the window (not a blank screen) and offer a retry. Single
instance lock so a second launch focuses the existing window.

**Check**: launch → quit → `pgrep -fl "dsh --profile"` finds nothing. Launch
twice → one window, one child.

### M2 — Feels like an app
Persisted window geometry. A real menu — **Electron gives no Edit menu by
default, so Cmd+C/V silently do nothing without one**. External links open via
`shell.openExternal`; deny in-window navigation off the dsh origin.

**Check**: geometry survives a restart; Cmd+C/V work in the composer; an
external link opens in the default browser.

### M3 — Profiles and plugins
Decide and implement the profile story: a dedicated `desktop` profile is the
safer default (isolated from the user's `web` profile, which the launchd service
is using), pre-populated with the plugins as verified above. Make the profile
name configurable, turn on `ptyEnabled`, and handle "dsh missing / too old" with
a clear message rather than a blank window.

**Check**: with a deliberately wrong dsh path the app explains the problem; with
a fresh profile directory the workbench panel and terminal both work.

### M4 — Mode A: ship dsh inside the app
Only after B is solid. Bundle a Node runtime + the dsh package + a pre-populated
profile; keep the prebuilt `pty.node` and the `spawn-helper` execute bit intact
through packaging (asar unpacking will matter). Expect ~500 MB.

**Check**: on a machine (or a clean user account) with no global dsh and no
pnpm, the packaged app launches and its terminal works.

### M5 — Mode C: remote
Answer the WebAuthn question first (above). Then: a way to choose/store remote
targets, cookie persistence in the app's `session`, honest handling of an
expired session, and never trusting a certificate the browser would not.

**Check**: connect to `ds.tokencv.com`, authenticate, use the UI; relaunch and
still be logged in; a revoked session lands on the login page, not a hang.

### M6 — Packaging
`electron-builder` or `@electron-forge` → `.app`/`.dmg` for arm64. Signing and
notarization are their own project; unsigned local builds are fine until the app
is worth installing.

**Check**: the packaged app launches from `/Applications` and spawns dsh — this
is where the Finder-environment `PATH` problem bites.

## Verifying without a human (important for `/loop`)

A GUI app resists the usual test loop. What works:

- **Playwright drives Electron** (`_electron.launch({ args: ['.'] })`): open the
  app, wait for the dsh UI, click, screenshot, assert — scriptable and CI-able.
  Set this up early; without it a loop session is guessing.
- Everything under the window is ordinary Node — URL parsing, child lifecycle,
  environment assembly, profile assembly. **Keep those as pure modules and unit
  test them**, the same discipline that made the plugins testable.
- Cheap process checks worth scripting: no stray `dsh` after quit, one child per
  instance, window URL matches the port dsh reported.

Never report a milestone done on "it should work" — each check above is
mechanical on purpose.

## Working agreement — git is the source of truth

This convention already burned the plugin repos once: finished work sat
uncommitted in one place while another session built on top of it.

**Commit and push as soon as a change is finished.** Begin a session with
`git pull` (or at least `git status && git log --oneline -3`); never assume the
working tree is what git has. The remote exists:
<https://github.com/ghbhiee/dsh-desktop> (public).

## Guardrails

- **Never bind port 3080**, and never stop, restart or reconfigure
  `com.tokencv.dsh-web` or `com.tokencv.dsh-gateway`. The gateway is the login
  wall for remote access; the web service is the user's daily driver. This app
  runs its own dsh on its own port, beside them.
- Do not modify the plugin repos or `~/.dsh/profiles/*` from this project. A
  plugin change belongs in that plugin's repo under its own rules. Create the
  app's own profile; leave `web` and `chat` alone.
- The repo is public: no tokens, no `~/.dsh-gateway/state`, nothing from
  `~/.dsh/sessions`.
- The renderer stays sandboxed. If a feature seems to need `nodeIntegration`, it
  belongs in the main process behind a narrow IPC call instead.
- Mode C touches authentication. Do not invent a bypass, do not weaken the
  gateway to make the app easier, and raise any gateway change with the user
  before writing it.

## Decided (was: still to decide)

- **Ship mode A.** Bundling is wanted; the packaged `.app` is ~600 MB / 171 MB
  as a DMG. A packaged build always prefers its own dsh over a global one.
- **Dedicated `desktop` profile**, under an app-owned `DSH_HOME` in userData.
  `~/.dsh` and the launchd `web` profile are never touched.
- **One window switches between backends** — the picker replaces what the
  window points at rather than opening a second instance.
- Tray icon / launch at login / global hotkey: still open, nobody has asked.

## Known sharp edges

- **Dev and packaged builds share one userData directory** (Electron derives
  it from `package.json`'s `name`), so on a development machine the packaged
  app reuses the dev profile — including plugins installed as pnpm `link:`
  symlinks into `~/dsh/dsh-plugin-*`. Harmless here, wrong for a distributed
  build: give the packaged flavour its own name if that ever matters.
- **e2e must not collide with a running instance.** Tests set
  `DSH_DESKTOP_USERDATA` (own single-instance lock, own state), filter process
  sweeps by the `DSH_DESKTOP_E2E=1` marker so they never count or kill the
  user's own dsh, and create windows hidden so they cannot steal keyboard
  focus mid-run. All three were learned the hard way.
- **dsh hard-fails the whole boot** if a `bundles` row names a package with no
  non-empty `dsh.bundle`. The plugin manager therefore filters what it unions
  into the stack; a package that installs but declares nothing gets a warning,
  not a bricked profile.
- **`showPage()` must be awaited** before navigating again. An aborted
  half-loaded `data:` page desyncs devtools-protocol clients — Playwright lost
  the window entirely on fast attach flows until this was fixed.
