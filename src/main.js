const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  screen,
  net,
  Tray,
  Menu,
  safeStorage
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const QRCode = require('qrcode');
const { CodexClient } = require('./codex-client');
const { normalizeRateLimits, mergeRateLimitSnapshot } = require('./rate-limits');
const { sanitizeSettings } = require('./settings');
const { isNewerVersion } = require('./version');
const {
  DEFAULT_PORT,
  createAccessToken,
  createUsageServer,
  enableTailscaleServe
} = require('./mobile-access');
const {
  DEFAULT_DOCK_WIDTH,
  DEFAULT_DOCK_HEIGHT,
  getDockBounds,
  isHotspotHit,
  normalizeActiveWindowBounds,
  shouldSuppressAutomaticReveal
} = require('./dock-helpers');
const { DockTransitionTracker, createDismissalController } = require('./dock-state');

const CURSOR_POLL_MS = 50;
const DISMISS_DELAY_MS = 250;
const TRANSITION_FALLBACK_MS = 500;

let window;
let tray;
let client;
let pollTimer;
let cursorTimer;
let transitionFallback;
let settings;
let activeDisplayId = null;
let hotspotWasActive = false;
let activationPending = false;
let awaitingPointerEntry = false;
let isQuitting = false;
let lastRateLimitSnapshot = null;
let getWindowsModulePromise;
let mobileAccessWindow;
let mobileServer;
let mobileToken;
let mobileEndpoint = null;
let lastMobileSnapshot = null;

const dock = new DockTransitionTracker();
const dismissal = createDismissalController({
  delay: DISMISS_DELAY_MS,
  onDismiss: () => hideDock()
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return sanitizeSettings({});
  }
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function mobileAccessPath() {
  return path.join(app.getPath('userData'), 'mobile-access.json');
}

function loadMobileAccess() {
  try {
    const stored = JSON.parse(fs.readFileSync(mobileAccessPath(), 'utf8'));
    const encrypted = Buffer.from(String(stored.encryptedToken || ''), 'base64');
    mobileToken = safeStorage.decryptString(encrypted);
    mobileEndpoint = typeof stored.endpoint === 'string' ? stored.endpoint : null;
  } catch {
    mobileToken = createAccessToken();
    mobileEndpoint = null;
    saveMobileAccess();
  }
}

function saveMobileAccess() {
  if (!mobileToken || !safeStorage.isEncryptionAvailable()) return;
  const encryptedToken = safeStorage.encryptString(mobileToken).toString('base64');
  fs.writeFileSync(
    mobileAccessPath(),
    JSON.stringify({ encryptedToken, endpoint: mobileEndpoint }, null, 2)
  );
}

function updateMobileSnapshot(data, updatedAt = Date.now()) {
  lastMobileSnapshot = {
    schemaVersion: 1,
    capturedAt: new Date(updatedAt).toISOString(),
    planType: data?.planType || null,
    limits: {
      weekly: data?.weekly || null,
      fiveHour: data?.fiveHour || null,
      monthly: data?.monthly || null
    }
  };
}

async function startMobileServer() {
  loadMobileAccess();
  mobileServer = createUsageServer({
    token: mobileToken,
    getSnapshot: () => lastMobileSnapshot,
    port: DEFAULT_PORT
  });
  await mobileServer.start();
  if (mobileEndpoint) {
    enableTailscaleServe(DEFAULT_PORT)
      .then(result => {
        mobileEndpoint = result.endpoint;
        saveMobileAccess();
      })
      .catch(error => {
        console.warn('Throttle could not restore Tailscale Serve:', error.message);
      });
  }
}

async function enableMobileAccess() {
  const result = await enableTailscaleServe(DEFAULT_PORT);
  mobileEndpoint = result.endpoint;
  saveMobileAccess();
  return getMobileAccessStatus();
}

function getMobileAccessStatus() {
  return {
    enabled: Boolean(mobileEndpoint),
    endpoint: mobileEndpoint,
    serverPort: DEFAULT_PORT
  };
}

async function getMobilePairing() {
  if (!mobileEndpoint) throw new Error('Enable Tailscale access first.');
  const payload = JSON.stringify({
    version: 1,
    endpoint: mobileEndpoint,
    token: mobileToken
  });
  return {
    endpoint: mobileEndpoint,
    payload,
    qrDataUrl: await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#080a0eff', light: '#f6f7f9ff' }
    })
  };
}

function openMobilePairing() {
  if (mobileAccessWindow && !mobileAccessWindow.isDestroyed()) {
    mobileAccessWindow.show();
    mobileAccessWindow.focus();
    return true;
  }
  mobileAccessWindow = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 400,
    minHeight: 560,
    title: 'Throttle · iPhone Widget',
    backgroundColor: '#080a0e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mobileAccessWindow.loadFile(path.join(__dirname, 'mobile-pairing.html'));
  mobileAccessWindow.on('closed', () => {
    mobileAccessWindow = null;
  });
  return true;
}

function getDisplayById(id) {
  return screen.getAllDisplays().find(display => display.id === id);
}

function displayAtCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function sendDockState(state, generation) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('dock-state', { state, generation });
}

function enforceAlwaysOnTop() {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, 'pop-up-menu');
}

function positionOnDisplay(display) {
  if (!window || window.isDestroyed() || !display) return;
  activeDisplayId = display.id;
  window.setBounds(getDockBounds(display), false);
}

function finalizeTransition(finalState, generation) {
  if (!dock.complete(finalState, generation)) return false;
  clearTimeout(transitionFallback);
  transitionFallback = null;
  if (finalState === 'hidden' && window && !window.isDestroyed()) {
    window.setIgnoreMouseEvents(true);
    window.blur();
  }
  return true;
}

function beginTransitionFallback(finalState, generation) {
  clearTimeout(transitionFallback);
  transitionFallback = setTimeout(() => finalizeTransition(finalState, generation), TRANSITION_FALLBACK_MS);
}

function showDock(display = displayAtCursor(), { waitForPointer = false } = {}) {
  if (!window || window.isDestroyed() || !display) return;
  dismissal.cancel();
  awaitingPointerEntry = waitForPointer;
  clearTimeout(transitionFallback);
  positionOnDisplay(display);
  window.setIgnoreMouseEvents(false);
  window.showInactive();
  enforceAlwaysOnTop();
  const generation = dock.begin('showing');
  sendDockState('showing', generation);
  beginTransitionFallback('visible', generation);
}

function hideDock() {
  if (!window || window.isDestroyed() || dock.state === 'hidden' || dock.state === 'hiding') return;
  dismissal.cancel();
  const generation = dock.begin('hiding');
  sendDockState('hiding', generation);
  beginTransitionFallback('hidden', generation);
}

function pointInWindow(point) {
  if (!window || window.isDestroyed()) return false;
  const bounds = window.getBounds();
  return point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
}

async function getActiveWindow() {
  getWindowsModulePromise ||= import('get-windows');
  const { activeWindow } = await getWindowsModulePromise;
  const result = await activeWindow();
  if (process.platform !== 'win32') return result;
  return normalizeActiveWindowBounds(
    result,
    bounds => screen.screenToDipRect(null, bounds)
  );
}

async function tryHotspotReveal(display) {
  if (activationPending || dock.state !== 'hidden') return;
  activationPending = true;
  const checkingGeneration = dock.begin('checking');
  try {
    const activeWindow = await getActiveWindow();
    const point = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(point);
    const stillInHotspot = currentDisplay.id === display.id &&
      isHotspotHit(point, currentDisplay, screen.getAllDisplays());
    const stillChecking = dock.state === 'checking' && dock.generation === checkingGeneration;
    if (stillChecking && stillInHotspot &&
      !shouldSuppressAutomaticReveal(activeWindow, currentDisplay)) {
      showDock(currentDisplay);
    } else if (stillChecking) {
      dock.state = 'hidden';
    }
  } catch (error) {
    // Fail closed for automatic activation. The tray remains an explicit way
    // to show the dock if foreground-window detection is unavailable.
    console.warn('Throttle could not inspect the foreground window:', error);
    if (dock.state === 'checking' && dock.generation === checkingGeneration) {
      dock.state = 'hidden';
    }
  } finally {
    activationPending = false;
  }
}

function monitorCursor() {
  if (!window || window.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const display = screen.getDisplayNearestPoint(point);
  const inHotspot = isHotspotHit(point, display, displays);

  if (dock.state === 'hidden' && inHotspot && !hotspotWasActive) {
    void tryHotspotReveal(display);
  }

  if (dock.state === 'showing' || dock.state === 'visible') {
    if (pointInWindow(point)) {
      awaitingPointerEntry = false;
      dismissal.cancel();
    } else if (!awaitingPointerEntry) {
      dismissal.schedule();
    }
  } else if (dock.state === 'hiding' && pointInWindow(point)) {
    showDock(getDisplayById(activeDisplayId) || display);
  }

  hotspotWasActive = inHotspot;
}

function handleDisplayChange() {
  if (!window || window.isDestroyed()) return;
  const current = getDisplayById(activeDisplayId);
  if (current) {
    positionOnDisplay(current);
    return;
  }
  if (dock.state !== 'hidden') hideDock();
  positionOnDisplay(screen.getPrimaryDisplay());
}

function createWindow() {
  settings = loadSettings();
  const primaryDisplay = screen.getPrimaryDisplay();
  const initialBounds = getDockBounds(primaryDisplay);
  window = new BrowserWindow({
    title: 'Throttle',
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
    ...initialBounds,
    minWidth: DEFAULT_DOCK_WIDTH,
    minHeight: DEFAULT_DOCK_HEIGHT,
    maxWidth: DEFAULT_DOCK_WIDTH,
    maxHeight: DEFAULT_DOCK_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    opacity: settings.opacity,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  activeDisplayId = primaryDisplay.id;
  enforceAlwaysOnTop();
  window.on('blur', enforceAlwaysOnTop);
  window.on('show', enforceAlwaysOnTop);
  window.on('restore', enforceAlwaysOnTop);
  window.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    hideDock();
  });
  window.on('closed', () => {
    window = null;
  });

  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => {
    window.showInactive();
    window.setIgnoreMouseEvents(true);
    sendDockState('hidden', dock.generation);

    const screenshotArg = process.argv.find(arg => arg.startsWith('--screenshot='));
    const verifyArg = process.argv.find(arg => arg.startsWith('--verify-state='));
    if (screenshotArg || verifyArg) showDock(primaryDisplay, { waitForPointer: true });

    if (verifyArg) {
      const outputPath = verifyArg.slice('--verify-state='.length);
      setTimeout(async () => {
        if (!window || window.isDestroyed()) return;
        let foregroundInspection = false;
        let foregroundInspectionError = null;
        try {
          foregroundInspection = Boolean(await getActiveWindow());
        } catch (error) {
          foregroundInspectionError = String(error?.message || error);
        }
        fs.writeFileSync(outputPath, JSON.stringify({
          alwaysOnTop: window.isAlwaysOnTop(),
          movable: window.isMovable(),
          resizable: window.isResizable(),
          minimizable: window.isMinimizable(),
          maximizable: window.isMaximizable(),
          minimumSize: window.getMinimumSize(),
          maximumSize: window.getMaximumSize(),
          bounds: window.getBounds(),
          dockState: dock.state,
          foregroundInspection,
          foregroundInspectionError
        }, null, 2));
        if (!screenshotArg) {
          isQuitting = true;
          app.quit();
        }
      }, 450);
    }

    if (screenshotArg) {
      const outputPath = screenshotArg.slice('--screenshot='.length);
      setTimeout(async () => {
        if (!window || window.isDestroyed()) return;
        const image = await window.webContents.capturePage();
        fs.writeFileSync(outputPath, image.toPNG());
        isQuitting = true;
        app.quit();
      }, 4500);
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'throttle.ico'));
  tray.setToolTip('Throttle · Codex usage');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Throttle', click: () => showDock(displayAtCursor(), { waitForPointer: true }) },
    { label: 'Hide Throttle', click: hideDock },
    { type: 'separator' },
    { label: 'Refresh Usage', click: () => void refreshUsage() },
    { label: 'Check for Updates', click: () => void checkForUpdate().catch(() => {}) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', () => showDock(displayAtCursor(), { waitForPointer: true }));
}

function sendState(state) {
  if (window && !window.isDestroyed()) window.webContents.send('usage-state', state);
}

async function refreshUsage() {
  sendState({ status: 'refreshing' });
  try {
    if (!client) {
      client = new CodexClient();
      client.on('rate-limits', params => {
        lastRateLimitSnapshot = mergeRateLimitSnapshot(lastRateLimitSnapshot || {}, params.rateLimits || {});
        const data = normalizeRateLimits({ rateLimits: lastRateLimitSnapshot });
        const updatedAt = Date.now();
        updateMobileSnapshot(data, updatedAt);
        sendState({
          status: 'connected',
          data,
          updatedAt
        });
      });
    }
    const raw = await client.getRateLimits();
    lastRateLimitSnapshot = raw?.rateLimitsByLimitId?.codex || raw?.rateLimits || null;
    const data = normalizeRateLimits(raw);
    const updatedAt = Date.now();
    updateMobileSnapshot(data, updatedAt);
    sendState({ status: 'connected', data, updatedAt });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /unauthorized|login|not logged|not found|ENOENT/i.test(message);
    sendState({
      status: needsLogin ? 'disconnected' : 'error',
      error: message,
      updatedAt: Date.now()
    });
  }
}

function schedulePolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshUsage, settings.refreshSeconds * 1000);
}

function openLogin() {
  if (process.platform === 'win32') {
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', 'Codex Login', 'cmd.exe', '/k', 'codex login'],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();
  } else {
    void shell.openExternal('https://chatgpt.com/auth/login');
  }
  return true;
}

async function checkForUpdate() {
  const response = await net.fetch(
    'https://api.github.com/repos/Parth-Jadhav-2004/Throttle/releases/latest',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Throttle/${app.getVersion()}`
      }
    }
  );
  if (!response.ok) throw new Error(`GitHub update check failed (${response.status})`);
  const release = await response.json();
  const latest = String(release.tag_name || '').replace(/^v/i, '');
  const current = app.getVersion();
  const available = isNewerVersion(latest, current);
  if (available) {
    await shell.openExternal(
      `https://github.com/Parth-Jadhav-2004/Throttle/releases/tag/${encodeURIComponent(release.tag_name)}`
    );
  }
  return { available, current, latest };
}

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('refresh-usage', refreshUsage);
ipcMain.handle('set-opacity', (_event, value) => {
  settings = sanitizeSettings({ ...settings, opacity: value });
  window?.setOpacity(settings.opacity);
  saveSettings();
  return settings;
});
ipcMain.handle('set-grid-opacity', (_event, value) => {
  settings = sanitizeSettings({ ...settings, gridOpacity: value });
  saveSettings();
  return settings;
});
ipcMain.handle('set-refresh-seconds', (_event, value) => {
  settings = sanitizeSettings({ ...settings, refreshSeconds: value });
  saveSettings();
  schedulePolling();
  return settings;
});
ipcMain.handle('open-login', openLogin);
ipcMain.handle('check-for-update', checkForUpdate);
ipcMain.handle('open-mobile-pairing', openMobilePairing);
ipcMain.handle('get-mobile-access-status', getMobileAccessStatus);
ipcMain.handle('enable-mobile-access', enableMobileAccess);
ipcMain.handle('get-mobile-pairing', getMobilePairing);
ipcMain.on('dock-transition-complete', (_event, payload = {}) => {
  finalizeTransition(payload.finalState, payload.generation);
});
ipcMain.on('hide-dock', hideDock);
ipcMain.on('close', hideDock);

app.whenReady().then(() => {
  createWindow();
  createTray();
  startMobileServer().catch(error => {
    console.warn('Throttle mobile server could not start:', error.message);
  });
  schedulePolling();
  cursorTimer = setInterval(monitorCursor, CURSOR_POLL_MS);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
  setTimeout(refreshUsage, 400);
});

app.on('activate', () => {
  if (window && !window.isDestroyed()) showDock(displayAtCursor(), { waitForPointer: true });
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(pollTimer);
  clearInterval(cursorTimer);
  clearTimeout(transitionFallback);
  dismissal.cancel();
  client?.stop();
  void mobileServer?.stop();
  mobileAccessWindow?.destroy();
  tray?.destroy();
});
