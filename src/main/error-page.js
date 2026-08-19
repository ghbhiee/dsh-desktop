'use strict';

// In-window pages for backend trouble — a dead dsh must never leave a blank
// or frozen window. Rendered as data: URLs; the action links point at a
// sentinel https origin (.invalid never resolves) that the main process
// intercepts in will-navigate — an unknown scheme would take Chromium's
// external-protocol path and never reach that hook, https always does. The
// sandboxed renderer needs no IPC bridge.

const ACTION_SCHEME = 'https://dshdesk.invalid/';

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pageShell(title, body) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    `</title><style>
      body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0;
             display: flex; align-items: center; justify-content: center;
             min-height: 100vh; background: #1e1e1e; color: #ddd; }
      main { max-width: 640px; padding: 2rem; }
      h1 { font-size: 1.2rem; }
      pre { background: #111; border-radius: 6px; padding: 1rem;
            max-height: 16rem; overflow: auto; white-space: pre-wrap; }
      a.button { display: inline-block; margin-right: .75rem; padding: .5rem 1.25rem;
                 border-radius: 6px; background: #4a7dff; color: #fff;
                 text-decoration: none; }
      a.button.secondary { background: #444; }
    </style></head><body><main>` +
    body +
    '</main></body></html>'
  );
}

function backendDownHtml({ code, signal }, recentOutput) {
  const why =
    signal != null
      ? `signal ${escapeHtml(signal)}`
      : `exit code ${escapeHtml(code ?? 'unknown')}`;
  return pageShell(
    'dsh exited',
    `<h1>dsh exited unexpectedly (${why})</h1>
     <p>The backend process ended on its own. Recent output:</p>
     <pre>${escapeHtml(recentOutput || '(no output captured)')}</pre>
     <p><a class="button" href="${ACTION_SCHEME}retry">Restart dsh</a>
        <a class="button secondary" href="${ACTION_SCHEME}quit">Quit</a></p>`
  );
}

function restartingHtml() {
  return pageShell('Restarting dsh', '<h1>Restarting dsh&hellip;</h1>');
}

function loadingHtml(message) {
  return pageShell('dsh-desktop', `<h1>${escapeHtml(message)}</h1>`);
}

// Startup problems the user must fix (dsh missing, dsh too old, a backend
// that will not connect): explain, offer the backend picker and Quit.
function startupErrorHtml(title, message) {
  return pageShell(
    title,
    `<h1>${escapeHtml(title)}</h1>
     <pre>${escapeHtml(message)}</pre>
     <p><a class="button" href="${ACTION_SCHEME}retry">重试</a>
        <a class="button" href="${ACTION_SCHEME}picker">切换后端…</a>
        <a class="button secondary" href="${ACTION_SCHEME}quit">退出</a></p>`
  );
}

// Remote pairing: the passkey ceremony happens in the system browser; this
// page collects the one-time code it displays. The form submits as a GET to
// the sentinel origin, so the code arrives through will-navigate like every
// other action — the sandboxed page needs no preload and no IPC.
function pairingHtml(origin, { error } = {}) {
  return pageShell(
    '连接远程 dsh',
    `<h1>在浏览器中完成认证</h1>
     <p>已在系统浏览器打开 <strong>${escapeHtml(origin)}</strong> 的登录页。<br>
        用 Passkey（Touch&nbsp;ID）登录后，页面会显示一个<strong>配对码</strong>，填到下面：</p>
     ${error ? `<p style="color:#d88">${escapeHtml(error)}</p>` : ''}
     <form action="${ACTION_SCHEME}pair" method="get">
       <input name="code" autofocus autocomplete="off" spellcheck="false"
              style="font: 1.1rem ui-monospace, monospace; letter-spacing: .15em;
                     padding: .5rem .8rem; border-radius: 6px; border: 1px solid #444;
                     background: #111; color: #eee; width: 14rem; text-transform: uppercase;">
       <button class="button" style="border: none; cursor: pointer; font-size: 1rem;">配对</button>
     </form>
     <p style="margin-top:1.2rem">
       <a class="button secondary" href="${ACTION_SCHEME}reauth">重新打开登录页</a>
       <a class="button secondary" href="${ACTION_SCHEME}picker">切换后端…</a>
     </p>`
  );
}

function toDataUrl(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = {
  backendDownHtml,
  restartingHtml,
  loadingHtml,
  startupErrorHtml,
  pairingHtml,
  toDataUrl,
  escapeHtml,
  ACTION_SCHEME,
};
