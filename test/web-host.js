// Minimal Electron host used by test/web.js: opens the BROWSER edition
// (crucible.html) in a plain Chromium window — no preload, no Node — so it
// behaves exactly like a page in Chrome/Edge.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-webhost-')));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSavePath(path.join(process.env.CRUCIBLE_TEST_OUT || os.tmpdir(), 'downloaded-' + item.getFilename()));
  });
  const w = new BrowserWindow({ width: 1366, height: 768, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  w.loadURL(process.env.WEB_URL);
});
