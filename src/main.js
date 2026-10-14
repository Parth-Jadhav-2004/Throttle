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
const { CursorClient } = require('./cursor-client');
const { ClaudeClient } = require('./claude-client');
const { AntigravityClient } = require('./antigravity-client');
const { normalizeRateLimits, mergeRateLimitSnapshot } = require('./rate-limits');
const { sanitizeSettings, visibleProviderIds } = require('./settings');
const { isNewerVersion } = require('./version');
const {
  DEFAULT_PORT,
  createAccessToken,
  createUsageServer,
  enableTailscaleServe
} = require('./mobile-access');
const {
  DOCK_PANEL_WIDTH,
  DOCK_WIDTH,
  getDockHeight,
  getDockBounds,
  isHotspotHit,
  normalizeActiveWindowBounds,
  shouldHideForFullscreen
} = require('./dock-helpers');
const { DockTransitionTracker } = require('./dock-state');

const CURSOR_POLL_MS = 50;
const TRANSITION_FALLBACK_MS = 450;
const FULLSCREEN_POLL_MS = 400;

let window;
let settingsWindow;
let tray;
let client;
let cursorClient;
let claudeClient;
let antigravityClient;
let pollTimer;
let cursorTimer;
let fullscreenTimer;
let transitionFallback;
let settings;
let activeDisplayId = null;
let hotspotWasActive = false;
let activationPending = false;
let isQuitting = false;
let lastRateLimitSnapshot = null;
let lastCodexState = null;
let lastCursorState = null;
let lastClaudeState = null;
let lastAntigravityState = null;
let getWindowsModulePromise;
let mobileAccessWindow;
let mobileServer;
let mobileToken;
let mobileEndpoint = null;
let lastMobileSnapshot = null;
let hiddenForFullscreen = false;

const dock = new DockTransitionTracker();

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
      color: { dark: '#000000ff', light: '#ffffffff' }
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
    backgroundColor: '#000000',
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

function dockDisplay() {
  return getDisplayById(activeDisplayId) || screen.getPrimaryDisplay();
}

function enforceAlwaysOnTop() {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, 'pop-up-menu');
}

function applyDockBounds(display = dockDisplay()) {
  if (!window || window.isDestroyed() || !display) return;
  activeDisplayId = display.id;
  const bounds = getDockBounds(display, visibleProviderIds(settings).length);
  const [, currentHeight] = window.getSize();
  if (bounds.height > currentHeight) {
    window.setMaximumSize(bounds.width, bounds.height);
    window.setMinimumSize(bounds.width, bounds.height);
  } else {
    window.setMinimumSize(bounds.width, bounds.height);
    window.setMaximumSize(bounds.width, bounds.height);
  }
  window.setBounds(bounds, false);
}

function sendDockState(state, generation) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('dock-state', { state, generation });
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
  transitionFallback = setTimeout(
    () => finalizeTransition(finalState, generation),
    TRANSITION_FALLBACK_MS
  );
}

function showDock(display = dockDisplay(), { bypassFullscreen = false } = {}) {
  if (!window || window.isDestroyed() || !display) return;
  if (hiddenForFullscreen && !bypassFullscreen) return;
  clearTimeout(transitionFallback);
  applyDockBounds(display);
  window.setIgnoreMouseEvents(false);
  window.showInactive();
  enforceAlwaysOnTop();
  const generation = dock.begin('showing');
  sendDockState('showing', generation);
  beginTransitionFallback('visible', generation);
}

function hideDock({ forFullscreen = false } = {}) {
  if (!window || window.isDestroyed() || dock.state === 'hidden' || dock.state === 'hiding') return;
  if (forFullscreen) hiddenForFullscreen = true;
  const generation = dock.begin('hiding');
  sendDockState('hiding', generation);
  beginTransitionFallback('hidden', generation);
}

function pointInDockZone(point) {
  if (!window || window.isDestroyed()) return false;
  const bounds = window.getBounds();
  const panelLeft = bounds.x + bounds.width - DOCK_PANEL_WIDTH;
  return point.x >= panelLeft &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
}

function sendToWindows(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(channel, payload);
}

function snapshot() {
  return {
    settings: {
      opacity: settings.opacity,
      refreshSeconds: settings.refreshSeconds,
      showClaude: settings.showClaude,
      showCursor: settings.showCursor,
      showCodex: settings.showCodex,
      showAntigravity: settings.showAntigravity
    },
    providers: {
      claude: lastClaudeState,
      cursor: lastCursorState,
      codex: lastCodexState,
      antigravity: lastAntigravityState
    }
  };
}

function sendSnapshot() {
  sendToWindows('usage-state', snapshot());
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
  if (activationPending || hiddenForFullscreen || dock.state !== 'hidden') return;
  activationPending = true;
  const checkingGeneration = dock.begin('checking');
  try {
    const activeWindow = await getActiveWindow();
    const point = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(point);
    const stillInHotspot = currentDisplay.id === display.id &&
      isHotspotHit(
        point,
        currentDisplay,
        screen.getAllDisplays(),
        getDockHeight(visibleProviderIds(settings).length)
      );
    const stillChecking = dock.state === 'checking' && dock.generation === checkingGeneration;
    if (stillChecking && stillInHotspot &&
      !shouldHideForFullscreen(activeWindow, currentDisplay)) {
      showDock(currentDisplay);
    } else if (stillChecking) {
      dock.state = 'hidden';
    }
  } catch (error) {
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
  const inHotspot = isHotspotHit(
    point,
    display,
    displays,
    getDockHeight(visibleProviderIds(settings).length)
  );

  if (dock.state === 'hidden' && inHotspot && !hotspotWasActive) {
    void tryHotspotReveal(display);
  }

  if (dock.state === 'showing' || dock.state === 'visible') {
    if (!pointInDockZone(point)) hideDock();
  } else if (dock.state === 'hiding' && pointInDockZone(point) && !hiddenForFullscreen) {
    showDock(getDisplayById(activeDisplayId) || display);
  }

  hotspotWasActive = inHotspot;
}

async function monitorFullscreen() {
  if (!window || window.isDestroyed()) return;
  const display = dockDisplay();
  try {
    const activeWindow = await getActiveWindow();
    const hide = shouldHideForFullscreen(activeWindow, display);
    if (hide) {
      hiddenForFullscreen = true;
      hideDock({ forFullscreen: true });
    } else if (hiddenForFullscreen) {
      hiddenForFullscreen = false;
      hotspotWasActive = false;
    }
  } catch (error) {
    console.warn('Throttle could not inspect the foreground window:', error);
  }
}

function handleDisplayChange() {
  if (!window || window.isDestroyed()) return;
  const current = getDisplayById(activeDisplayId);
  applyDockBounds(current || screen.getPrimaryDisplay());
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  };
}

function createWindow() {
  settings = loadSettings();
  const primaryDisplay = screen.getPrimaryDisplay();
  const initialBounds = getDockBounds(primaryDisplay, visibleProviderIds(settings).length);
  window = new BrowserWindow({
    title: 'Throttle',
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
    ...initialBounds,
    minWidth: DOCK_WIDTH,
    minHeight: initialBounds.height,
    maxWidth: DOCK_WIDTH,
    maxHeight: initialBounds.height,
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
    webPreferences: webPreferences()
  });
  activeDisplayId = primaryDisplay.id;
  enforceAlwaysOnTop();
  window.on('blur', enforceAlwaysOnTop);
  window.on('show', enforceAlwaysOnTop);
  window.on('restore', enforceAlwaysOnTop);
  window.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
  });
  window.on('closed', () => {
    window = null;
  });

  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => {
    const screenshotArg = process.argv.find(arg => arg.startsWith('--screenshot='));
    const verifyArg = process.argv.find(arg => arg.startsWith('--verify-state='));
    window.showInactive();
    window.setIgnoreMouseEvents(true);
    sendDockState('hidden', dock.generation);
    if (screenshotArg || verifyArg) {
      showDock(primaryDisplay, { bypassFullscreen: true });
    }

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

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return true;
  }
  settingsWindow = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 400,
    minHeight: 600,
    title: 'Throttle',
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  return true;
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'throttle.ico'));
  updateTrayTooltip();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings', click: openSettings },
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
  tray.on('click', openSettings);
}

function cacheProvider(provider, state) {
  if (provider === 'cursor') lastCursorState = state;
  else if (provider === 'claude') lastClaudeState = state;
  else if (provider === 'antigravity') lastAntigravityState = state;
  else lastCodexState = state;
  sendSnapshot();
}

async function refreshCodexUsage() {
  try {
    if (!client) {
      client = new CodexClient();
      client.on('rate-limits', params => {
        lastRateLimitSnapshot = mergeRateLimitSnapshot(lastRateLimitSnapshot || {}, params.rateLimits || {});
        const data = normalizeRateLimits({ rateLimits: lastRateLimitSnapshot });
        const updatedAt = Date.now();
        updateMobileSnapshot(data, updatedAt);
        cacheProvider('codex', { status: 'connected', data, updatedAt });
      });
    }
    const raw = await client.getRateLimits();
    lastRateLimitSnapshot = raw?.rateLimitsByLimitId?.codex || raw?.rateLimits || null;
    const data = normalizeRateLimits(raw);
    const updatedAt = Date.now();
    updateMobileSnapshot(data, updatedAt);
    cacheProvider('codex', { status: 'connected', data, updatedAt });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /unauthorized|login|not logged|not found|ENOENT/i.test(message);
    cacheProvider('codex', {
      status: needsLogin ? 'disconnected' : 'error',
      error: message,
      updatedAt: Date.now()
    });
  }
}

async function refreshCursorUsage() {
  try {
    cursorClient ||= new CursorClient();
    const data = await cursorClient.getUsage();
    cacheProvider('cursor', { status: 'connected', data, updatedAt: Date.now() });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /unauthorized|unauthenticated|login|not found|ENOENT/i.test(message);
    cacheProvider('cursor', {
      status: needsLogin ? 'disconnected' : 'error',
      error: message,
      updatedAt: Date.now()
    });
  }
}

async function refreshClaudeUsage() {
  try {
    claudeClient ||= new ClaudeClient();
    const data = await claudeClient.getUsage();
    cacheProvider('claude', { status: 'connected', data, updatedAt: Date.now() });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /unauthorized|unauthenticated|login|not found|ENOENT/i.test(message);
    cacheProvider('claude', {
      status: needsLogin ? 'disconnected' : 'error',
      error: message,
      updatedAt: Date.now()
    });
  }
}

async function refreshAntigravityUsage() {
  try {
    antigravityClient ||= new AntigravityClient();
    const data = await antigravityClient.getUsage();
    cacheProvider('antigravity', { status: 'connected', data, updatedAt: Date.now() });
  } catch (error) {
    const message = String(error?.message || error);
    const needsLogin = /credential|logged in|login|unauthorized|not found|ENOENT/i.test(message);
    cacheProvider('antigravity', {
      status: needsLogin ? 'disconnected' : 'error',
      error: message,
      updatedAt: Date.now()
    });
  }
}

async function refreshUsage() {
  const jobs = [];
  if (settings.showCodex) jobs.push(refreshCodexUsage());
  else lastCodexState = null;
  if (settings.showCursor) jobs.push(refreshCursorUsage());
  else lastCursorState = null;
  if (settings.showClaude) jobs.push(refreshClaudeUsage());
  else lastClaudeState = null;
  if (settings.showAntigravity) jobs.push(refreshAntigravityUsage());
  else lastAntigravityState = null;
  sendSnapshot();
  await Promise.all(jobs);
}

function updateTrayTooltip() {
  const names = visibleProviderIds(settings).map(id => id[0].toUpperCase() + id.slice(1));
  tray?.setToolTip(names.length ? `Throttle · ${names.join(', ')}` : 'Throttle');
}

function openCursor() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe'),
      path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
      path.join(localAppData, 'cursor', 'Cursor.exe')
    ];
    for (const exe of candidates) {
      if (!exe || !fs.existsSync(exe)) continue;
      const child = spawn(exe, { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      return true;
    }
  }
  void shell.openExternal('cursor://');
  return true;
}

function openCliLogin(title, command) {
  if (process.platform === 'win32') {
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', title, 'cmd.exe', '/k', command],
      { detached: true, stdio: 'ignore', windowsHide: false }
    );
    child.unref();
  } else {
    const loginUrl = command === 'agy'
      ? 'https://antigravity.google/docs/cli/install/'
      : command.startsWith('claude')
        ? 'https://claude.ai/login'
        : 'https://chatgpt.com/auth/login';
    void shell.openExternal(loginUrl);
  }
  return true;
}

function openLogin(provider) {
  if (provider === 'cursor') return openCursor();
  if (provider === 'claude') return openCliLogin('Claude Login', 'claude auth login');
  if (provider === 'antigravity') return openCliLogin('Antigravity', 'agy');
  return openCliLogin('Codex Login', 'codex login');
}

function schedulePolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshUsage, settings.refreshSeconds * 1000);
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
ipcMain.handle('open-settings', () => openSettings());
ipcMain.handle('refresh-usage', refreshUsage);
ipcMain.handle('set-opacity', (_event, value) => {
  settings = sanitizeSettings({ ...settings, opacity: value });
  window?.setOpacity(settings.opacity);
  saveSettings();
  sendSnapshot();
  return settings;
});
ipcMain.handle('set-refresh-seconds', (_event, value) => {
  settings = sanitizeSettings({ ...settings, refreshSeconds: value });
  saveSettings();
  schedulePolling();
  sendSnapshot();
  return settings;
});
ipcMain.handle('set-show-provider', (_event, id, enabled) => {
  const key = {
    claude: 'showClaude',
    cursor: 'showCursor',
    codex: 'showCodex',
    antigravity: 'showAntigravity'
  }[id];
  if (!key) return settings;
  settings = sanitizeSettings({ ...settings, [key]: Boolean(enabled) });
  saveSettings();
  updateTrayTooltip();
  applyDockBounds();
  sendSnapshot();
  void refreshUsage();
  return settings;
});
ipcMain.handle('open-login', (_event, provider) => openLogin(provider));
ipcMain.handle('check-for-update', checkForUpdate);
ipcMain.handle('open-mobile-pairing', openMobilePairing);
ipcMain.handle('get-mobile-access-status', getMobileAccessStatus);
ipcMain.handle('enable-mobile-access', enableMobileAccess);
ipcMain.handle('get-mobile-pairing', getMobilePairing);
ipcMain.on('dock-transition-complete', (_event, payload = {}) => {
  finalizeTransition(payload.finalState, payload.generation);
});

app.whenReady().then(() => {
  const automationMode = process.argv.some(arg =>
    arg.startsWith('--screenshot=') || arg.startsWith('--verify-state=')
  );
  createWindow();
  createTray();
  startMobileServer().catch(error => {
    console.warn('Throttle mobile server could not start:', error.message);
  });
  schedulePolling();
  if (!automationMode) {
    cursorTimer = setInterval(monitorCursor, CURSOR_POLL_MS);
    fullscreenTimer = setInterval(() => void monitorFullscreen(), FULLSCREEN_POLL_MS);
  }
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
  setTimeout(refreshUsage, 400);
});

app.on('activate', () => {
  if (window && !window.isDestroyed()) showDock();
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(pollTimer);
  clearInterval(cursorTimer);
  clearInterval(fullscreenTimer);
  clearTimeout(transitionFallback);
  client?.stop();
  void mobileServer?.stop();
  mobileAccessWindow?.destroy();
  settingsWindow?.destroy();
  tray?.destroy();
});
