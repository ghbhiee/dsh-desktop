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
Build B first (it is A minus the bundling), then A, then C.

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

> **Answered 2026-08-18** with a throwaway hidden BrowserWindow (sandboxed,
> context-isolated) loading `https://ds.tokencv.com/` (redirects to `/auth`):
> `PublicKeyCredential` exists, but
> `isUserVerifyingPlatformAuthenticatorAvailable()` returns **false** —
> Electron has no macOS platform authenticator, so the Touch ID ceremony
> cannot happen in-app. Mode C requires one of the options below; picking one
> is the user's call since (1) and (2) are gateway-repo changes.
Electron's support here has historically been limited and version-dependent.
Verify it with a throwaway BrowserWindow against the real gateway before
designing anything else. If it does not work, the options are, in order of
preference:

1. **Pair via the system browser.** Log in there (Touch ID definitely works),
   and give the gateway a short-lived pairing code the app exchanges for a
   session cookie it stores in its own `session`. This is a change in the
   gateway repo, and it fits the flow that already exists (`PENDING_DIR` +
   `dsh-approve` is already a pairing step).
2. Add a device-credential path to the gateway (mTLS or a long-lived device
   token), again a gateway change, with its own security review.
3. Fall back to opening the remote UI in the system browser and treating mode C
   as out of scope for the app.

Do not design around an assumption here. Verify, then pick, then tell the user.

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
working tree is what git has. First task of the first session: create
`ghbhiee/dsh-desktop` and push, so a remote exists to be the source of truth.

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

## Still to decide with the user

- Which modes ship first, and is mode A (bundling ~500 MB) actually wanted, or
  is "install dsh yourself" acceptable?
- Dedicated `desktop` profile (recommended) vs sharing `web`?
- Tray icon / launch at login / global hotkey — in or out?
- Should one window switch between local and remote, or is each a separate
  window/app instance?
