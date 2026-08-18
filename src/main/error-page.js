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

function toDataUrl(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { backendDownHtml, restartingHtml, toDataUrl, escapeHtml, ACTION_SCHEME };
