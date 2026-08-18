'use strict';

// Electron ships no default Edit menu — without one, Cmd+C/V/X/A silently do
// nothing in every text field. The menu is therefore not cosmetic; it is what
// makes the composer usable.

const REPO_URL = 'https://github.com/ghbhiee/dsh-desktop';

function buildMenuTemplate({ openExternal }) {
  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'dsh-desktop on GitHub',
          click: () => openExternal(REPO_URL),
        },
      ],
    },
  ];
}

module.exports = { buildMenuTemplate, REPO_URL };
