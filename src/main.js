const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { CodexClient } = require('./codex-client');
const { normalizeRateLimits, mergeRateLimitSnapshot } = require('./rate-limits');
const { sanitizeSettings } = require('./settings');

let window;
let client;
let pollTimer;
let settings;
let lastRateLimitSnapshot = null;

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { return sanitizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); }
  catch { return sanitizeSettings({}); }
}
function saveSettings() { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); }

function createWindow() {
  settings = loadSettings();
  const sizeArg = process.argv.find(arg => arg.startsWith('--window-size='));
  const sizeMatch = sizeArg?.match(/^(?:--window-size=)(\d+)x(\d+)$/i);
  const initialWidth = sizeMatch ? Math.min(360, Math.max(190, Number(sizeMatch[1]))) : 360;
  const initialHeight = sizeMatch ? Math.min(590, Math.max(190, Number(sizeMatch[2]))) : 590;
  const savedPosition = settings.windowPosition;
  const isVisible = savedPosition && screen.getAllDisplays().some(({ workArea }) =>
    savedPosition.x < workArea.x + workArea.width - 80 &&
    savedPosition.x + 80 > workArea.x &&
    savedPosition.y < workArea.y + workArea.height - 80 &&
    savedPosition.y + 80 > workArea.y
  );
  window = new BrowserWindow({
    title: 'Throttle',
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
    width: initialWidth, height: initialHeight,
    minWidth: 190, minHeight: 190, maxWidth: 360, maxHeight: 590,
    ...(isVisible ? savedPosition : {}),
    frame: false, transparent: true, resizable: true, thickFrame: true, movable: true,
    alwaysOnTop: true, fullscreenable: false, hasShadow: false,
    skipTaskbar: false, opacity: settings.opacity, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const enforceAlwaysOnTop = () => {
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(true, 'screen-saver', 1);
  };
  enforceAlwaysOnTop();
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('blur', enforceAlwaysOnTop);
  window.on('show', enforceAlwaysOnTop);
  window.on('restore', enforceAlwaysOnTop);
  let positionTimer;
  window.on('move', () => {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      if (!window || window.isDestroyed()) return;
      const [x, y] = window.getPosition();
      settings = sanitizeSettings({ ...settings, windowPosition: { x, y } });
      saveSettings();
    }, 200);
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => {
    window.show();
    const screenshotArg = process.argv.find(arg => arg.startsWith('--screenshot='));
    const verifyArg = process.argv.find(arg => arg.startsWith('--verify-state='));
    if (verifyArg) {
      const outputPath = verifyArg.slice('--verify-state='.length);
      fs.writeFileSync(outputPath, JSON.stringify({
        alwaysOnTop: window.isAlwaysOnTop(),
        movable: window.isMovable(),
        resizable: window.isResizable(),
        minimumSize: window.getMinimumSize(),
        maximumSize: window.getMaximumSize(),
        visibleOnAllWorkspaces: window.isVisibleOnAllWorkspaces(),
        bounds: window.getBounds()
      }, null, 2));
      if (!screenshotArg) setTimeout(() => app.quit(), 250);
    }
    if (screenshotArg) {
      const outputPath = screenshotArg.slice('--screenshot='.length);
      setTimeout(async () => {
        const image = await window.webContents.capturePage();
        fs.writeFileSync(outputPath, image.toPNG());
        app.quit();
      }, 4500);
    }
  });
  window.on('closed', () => { window = null; });
}

function sendState(state) { if (window && !window.isDestroyed()) window.webContents.send('usage-state', state); }

async function refreshUsage() {
  sendState({ status: 'refreshing' });
  try {
    if (!client) {
      client = new CodexClient();
      client.on('rate-limits', params => {
        lastRateLimitSnapshot = mergeRateLimitSnapshot(lastRateLimitSnapshot || {}, params.rateLimits || {});
        sendState({ status: 'connected', data: normalizeRateLimits({ rateLimits: lastRateLimitSnapshot }), updatedAt: Date.now() });
      });
    }
    const raw = await client.getRateLimits();
    lastRateLimitSnapshot = raw?.rateLimitsByLimitId?.codex || raw?.rateLimits || null;
    sendState({ status: 'connected', data: normalizeRateLimits(raw), updatedAt: Date.now() });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /unauthorized|login|not logged|not found|ENOENT/i.test(message);
    sendState({ status: needsLogin ? 'disconnected' : 'error', error: message, updatedAt: Date.now() });
  }
}

function schedulePolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshUsage, settings.refreshSeconds * 1000);
}

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('refresh-usage', refreshUsage);
ipcMain.handle('set-opacity', (_event, value) => {
  settings = sanitizeSettings({ ...settings, opacity: value });
  window?.setOpacity(settings.opacity); saveSettings(); return settings;
});
ipcMain.handle('set-grid-opacity', (_event, value) => {
  settings = sanitizeSettings({ ...settings, gridOpacity: value });
  saveSettings(); return settings;
});
ipcMain.handle('set-refresh-seconds', (_event, value) => {
  settings = sanitizeSettings({ ...settings, refreshSeconds: value });
  saveSettings(); schedulePolling(); return settings;
});
ipcMain.handle('open-login', () => {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', 'Codex Login', 'cmd.exe', '/k', 'codex login'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
  } else {
    shell.openExternal('https://chatgpt.com/auth/login');
  }
  return true;
});
ipcMain.on('minimize', () => window?.minimize());
ipcMain.on('close', () => window?.close());

app.whenReady().then(() => { createWindow(); schedulePolling(); setTimeout(refreshUsage, 400); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { clearInterval(pollTimer); client?.stop(); });
