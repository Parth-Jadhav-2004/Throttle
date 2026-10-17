const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  screen,
  net,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  globalShortcut,
  safeStorage,
  Notification,
  clipboard
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const QRCode = require('qrcode');
const { CodexClient } = require('./codex-client');
const { CursorClient } = require('./cursor-client');
const { ClaudeClient } = require('./claude-client');
const { AntigravityClient } = require('./antigravity-client');
const { normalizeRateLimits, mergeRateLimitSnapshot } = require('./rate-limits');
const {
  PROVIDER_IDS,
  sanitizeSettings,
  visibleProviderIds,
  providerSettingKey
} = require('./settings');
const { isNewerVersion } = require('./version');
const {
  DEFAULT_PORT,
  createAccessToken,
  createUsageServer,
  enableTailscaleServe
} = require('./mobile-access');
const { POPUP_WIDTH, getPopupBounds } = require('./popup-position');
const { TaskbarStrip } = require('./taskbar-strip');
const { SpendService } = require('./spend-service');
const { evaluateAlerts } = require('./alerts');
const { startLocalApi } = require('./local-api');
const { getCursorStateDbPath } = require('./cursor-auth');
const { getClaudeCredentialsPath } = require('./claude-auth');
const { opencodeDbPath } = require('./opencode-spend');
const { museSessionsRoots } = require('./muse-spend');
const embedder = require('./taskbar-embed');

const ISSUES_URL = 'https://github.com/Parth-Jadhav-2004/Throttle/issues/new';

const FETCH_TIMEOUT_MS = 120 * 1000;
const BLUR_REOPEN_GUARD_MS = 250;
const CACHE_WRITE_DELAY_MS = 1000;
const LOGIN_PATTERNS = {
  codex: /unauthorized|login|not logged|not found|ENOENT/i,
  cursor: /unauthorized|unauthenticated|login|not found|ENOENT/i,
  claude: /unauthorized|unauthenticated|login|not found|ENOENT/i,
  antigravity: /credential|logged in|login|unauthorized|not found|ENOENT/i
};

let popup;
let tray;
let codexClient;
let cursorClient;
let claudeClient;
let antigravityClient;
let pollTimer;
let cacheTimer;
let settings;
let isQuitting = false;
let lastRateLimitSnapshot = null;
let popupHeight = 520;
let popupHiddenAt = 0;
let nextRefreshAt = null;
let registeredShortcut = null;
let mobileAccessWindow;
let mobileServer;
let mobileToken;
let mobileEndpoint = null;
let lastMobileSnapshot = null;
let strip;
let spendService;
let localApi;
let alertMemory = {};
let popupAnchor = null;
let firstLaunch = false;

const providerStates = Object.fromEntries(PROVIDER_IDS.map(id => [id, null]));
const refreshing = new Set();

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function loadSettings() {
  try {
    return sanitizeSettings({ welcomed: true, ...JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')) });
  } catch {
    firstLaunch = !fs.existsSync(userFile('settings.json'));
    return sanitizeSettings({ welcomed: !firstLaunch });
  }
}

function detectProviders() {
  const home = os.homedir();
  const exists = file => {
    try { return fs.existsSync(file); } catch { return false; }
  };
  return {
    claude: exists(getClaudeCredentialsPath()) || exists(path.join(home, '.claude', 'projects')),
    codex: exists(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json')),
    cursor: exists(getCursorStateDbPath()),
    antigravity: exists(path.join(home, '.gemini', 'antigravity-cli')),
    opencode: exists(opencodeDbPath()),
    muse: museSessionsRoots().length > 0
  };
}

function saveSettings() {
  fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2));
}

function loadUsageCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(userFile('usage-cache.json'), 'utf8'));
    for (const id of PROVIDER_IDS) {
      const entry = cached?.[id];
      if (entry?.data) providerStates[id] = { status: 'connected', data: entry.data, updatedAt: entry.updatedAt, cached: true };
    }
  } catch {}
}

function scheduleCacheWrite() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(writeUsageCache, CACHE_WRITE_DELAY_MS);
}

function writeUsageCache() {
  clearTimeout(cacheTimer);
  const entries = {};
  for (const id of PROVIDER_IDS) {
    const state = providerStates[id];
    if (state?.data) entries[id] = { data: state.data, updatedAt: state.updatedAt };
  }
  try {
    fs.writeFileSync(userFile('usage-cache.json'), JSON.stringify(entries));
  } catch (error) {
    console.warn('Throttle could not write the usage cache:', error.message);
  }
}

function mobileAccessPath() {
  return userFile('mobile-access.json');
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
  hidePopup();
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
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
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

function snapshot() {
  const providers = {};
  for (const id of PROVIDER_IDS) {
    providers[id] = providerStates[id] ? { ...providerStates[id], refreshing: refreshing.has(id) } : (refreshing.has(id) ? { refreshing: true } : null);
  }
  return {
    settings,
    providers,
    spend: spendService?.snapshot() || {},
    nextRefreshAt,
    version: app.getVersion(),
    stripSupported: Boolean(strip?.supported),
    detected: settings.welcomed ? null : detectProviders(),
    taskbarDark: process.platform === 'win32'
      ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
      : nativeTheme.shouldUseDarkColors
  };
}

function sendSnapshot() {
  const state = snapshot();
  if (popup && !popup.isDestroyed()) popup.webContents.send('usage-state', state);
  strip?.update({ settings: state.settings, providers: state.providers, spend: state.spend, taskbarDark: state.taskbarDark });
}

function trayAnchor() {
  const bounds = tray?.getBounds();
  return bounds && bounds.width ? bounds : null;
}

function findTaskbarOnDisplay(display) {
  if (!embedder.available() || !display) return null;
  for (const r of embedder.taskbarRects()) {
    const physical = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
    const dip = screen.screenToDipRect(null, physical);
    if (
      dip.x < display.bounds.x + display.bounds.width &&
      dip.x + dip.width > display.bounds.x &&
      dip.y < display.bounds.y + display.bounds.height &&
      dip.y + dip.height > display.bounds.y
    ) {
      return dip;
    }
  }
  return null;
}

function positionPopup() {
  if (!popup || popup.isDestroyed()) return;
  const anchor = popupAnchor || trayAnchor();
  const point = anchor ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const taskbar = findTaskbarOnDisplay(display);
  const bounds = getPopupBounds({ display, anchor, height: popupHeight, taskbar });
  popup.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, false);
  return bounds;
}

function showPopup(view, anchor = null) {
  if (!popup || popup.isDestroyed()) return;
  popupAnchor = anchor;
  const bounds = positionPopup();
  popup.webContents.send('popup-shown', { edge: bounds?.edge || 'bottom', view: view || null });
  popup.show();
  popup.focus();
}

function hidePopup() {
  if (!popup || popup.isDestroyed() || !popup.isVisible()) return;
  popupHiddenAt = Date.now();
  popupAnchor = null;
  popup.hide();
  popup.webContents.send('popup-hidden');
}

function togglePopup(anchor = null) {
  if (popup?.isVisible()) {
    hidePopup();
    return;
  }
  if (Date.now() - popupHiddenAt < BLUR_REOPEN_GUARD_MS) return;
  showPopup(null, anchor);
}

function createPopup() {
  popup = new BrowserWindow({
    title: 'Throttle',
    icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
    width: POPUP_WIDTH,
    height: popupHeight,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  popup.setAlwaysOnTop(true, 'pop-up-menu');
  popup.setContentProtection(settings.hideFromScreenShare);
  popup.on('blur', () => {
    if (!process.argv.some(arg => arg.startsWith('--screenshot='))) hidePopup();
  });
  popup.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    hidePopup();
  });
  popup.on('closed', () => {
    popup = null;
  });
  popup.loadFile(path.join(__dirname, 'index.html'));
  popup.webContents.once('did-finish-load', () => {
    sendSnapshot();
    const screenshotArg = process.argv.find(arg => arg.startsWith('--screenshot='));
    if (screenshotArg) {
      const viewArg = process.argv.find(arg => arg.startsWith('--view='));
      setTimeout(() => showPopup(viewArg ? viewArg.slice('--view='.length) : null), 300);
      setTimeout(async () => {
        if (!popup || popup.isDestroyed()) return;
        const image = await popup.webContents.capturePage();
        fs.writeFileSync(screenshotArg.slice('--screenshot='.length), image.toPNG());
        isQuitting = true;
        app.quit();
      }, Number(process.argv.find(arg => arg.startsWith('--screenshot-delay='))?.split('=')[1]) || 6000);
    } else if (!process.argv.includes('--hidden')) {
      setTimeout(() => showPopup(), 300);
    }
  });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Throttle', click: () => showPopup('dashboard') },
    { label: 'Refresh Now', click: () => void refreshAll({ force: true }) },
    { type: 'separator' },
    { label: 'Customize…', click: () => showPopup('customize') },
    { label: 'Settings…', click: () => showPopup('settings') },
    {
      label: 'Taskbar Display',
      enabled: Boolean(strip?.supported),
      submenu: [['text', 'Text'], ['bars', 'Bars'], ['off', 'Off']].map(([value, label]) => ({
        label,
        type: 'radio',
        checked: settings.taskbarStyle === value,
        click: () => updateSettings({ taskbarStyle: value })
      }))
    },
    { label: 'Check for Updates', click: () => void checkForUpdate().catch(() => {}) },
    { label: 'Report an Issue…', click: () => void shell.openExternal(ISSUES_URL) },
    { type: 'separator' },
    { label: 'Quit Throttle', click: quit }
  ]);
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'throttle.ico'));
  tray.setToolTip('Throttle');
  tray.on('click', () => togglePopup());
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
}

function setTrayImage({ images, tooltip } = {}) {
  if (!tray) return;
  if (typeof tooltip === 'string') tray.setToolTip(tooltip.slice(0, 127));
  if (settings.trayStyle === 'logo' || !Array.isArray(images) || !images.length) {
    tray.setImage(path.join(__dirname, '..', 'assets', 'throttle.ico'));
    return;
  }
  const image = nativeImage.createEmpty();
  for (const entry of images) {
    if (typeof entry?.dataUrl !== 'string' || !entry.dataUrl.startsWith('data:image/png')) continue;
    image.addRepresentation({ scaleFactor: Number(entry.scale) || 1, dataURL: entry.dataUrl });
  }
  if (!image.isEmpty()) tray.setImage(image);
}

function isEnabled(id) {
  return Boolean(settings[providerSettingKey(id)]);
}

function setProviderData(id, data) {
  providerStates[id] = { status: 'connected', data, updatedAt: Date.now() };
  scheduleCacheWrite();
  checkAlerts();
  sendSnapshot();
}

function checkAlerts() {
  const result = evaluateAlerts({ providers: providerStates, settings, memory: alertMemory });
  alertMemory = result.memory;
  if (!Notification.isSupported()) return;
  for (const alert of result.alerts) {
    const notification = new Notification({
      title: alert.title,
      body: alert.body,
      icon: path.join(__dirname, '..', 'assets', 'throttle.png'),
      silent: false
    });
    notification.on('click', () => showPopup('dashboard'));
    notification.show();
  }
}

function applyStrip() {
  strip?.setEnabled(settings.taskbarStyle !== 'off');
}

function applyLocalApi() {
  if (settings.localApi && !localApi) {
    localApi = startLocalApi(() => ({
      visibleIds: visibleProviderIds(settings),
      allIds: PROVIDER_IDS,
      providers: providerStates,
      spend: spendService?.snapshot() || {}
    }));
  } else if (!settings.localApi && localApi) {
    localApi.close();
    localApi = null;
  }
}

async function copyScreenshot(rect) {
  if (!popup || popup.isDestroyed()) return false;
  const clip = rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
    ? { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
    : undefined;
  const image = await popup.webContents.capturePage(clip);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  return true;
}

function resetAllSettings() {
  const keep = { welcomed: true };
  settings = sanitizeSettings(keep);
  saveSettings();
  registerShortcut();
  applyLoginItem();
  nativeTheme.themeSource = settings.theme;
  popup?.setContentProtection(settings.hideFromScreenShare);
  applyStrip();
  applyLocalApi();
  schedulePolling();
  void refreshAll();
  return settings;
}

function setProviderError(id, error) {
  const message = String(error?.message || error);
  const status = LOGIN_PATTERNS[id].test(message) ? 'disconnected' : 'error';
  const previous = providerStates[id];
  providerStates[id] = previous?.data
    ? { ...previous, status: 'connected', error: message, errorStatus: status }
    : { status, error: message, updatedAt: Date.now() };
  sendSnapshot();
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Refresh timed out after ${Math.round(ms / 1000)}s`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function fetchCodex() {
  if (!codexClient) {
    codexClient = new CodexClient();
    codexClient.on('rate-limits', params => {
      lastRateLimitSnapshot = mergeRateLimitSnapshot(lastRateLimitSnapshot || {}, params.rateLimits || {});
      const data = normalizeRateLimits({ rateLimits: lastRateLimitSnapshot });
      updateMobileSnapshot(data);
      setProviderData('codex', data);
    });
  }
  const raw = await codexClient.getRateLimits();
  lastRateLimitSnapshot = raw?.rateLimitsByLimitId?.codex || raw?.rateLimits || null;
  const data = normalizeRateLimits(raw);
  updateMobileSnapshot(data);
  return data;
}

const FETCHERS = {
  codex: fetchCodex,
  cursor: () => (cursorClient ||= new CursorClient()).getUsage(),
  claude: () => (claudeClient ||= new ClaudeClient()).getUsage(),
  antigravity: ({ force }) => {
    antigravityClient ||= new AntigravityClient();
    if (force) antigravityClient.cached = null;
    return antigravityClient.getUsage();
  }
};

async function refreshProvider(id, { force = false } = {}) {
  // Spend-only providers (OpenCode) have no usage endpoint to poll.
  if (!FETCHERS[id] || !isEnabled(id) || refreshing.has(id)) return;
  refreshing.add(id);
  sendSnapshot();
  try {
    setProviderData(id, await withTimeout(FETCHERS[id]({ force }), FETCH_TIMEOUT_MS));
  } catch (error) {
    setProviderError(id, error);
  } finally {
    refreshing.delete(id);
    sendSnapshot();
  }
}

async function refreshAll({ force = false } = {}) {
  schedulePolling();
  await Promise.all(visibleProviderIds(settings).map(id => refreshProvider(id, { force })));
}

function schedulePolling() {
  clearInterval(pollTimer);
  const intervalMs = settings.refreshSeconds * 1000;
  nextRefreshAt = Date.now() + intervalMs;
  pollTimer = setInterval(() => {
    nextRefreshAt = Date.now() + intervalMs;
    void Promise.all(visibleProviderIds(settings).map(id => refreshProvider(id)));
  }, intervalMs);
  sendSnapshot();
}

function registerShortcut() {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }
  if (!settings.shortcut) return true;
  try {
    if (globalShortcut.register(settings.shortcut, togglePopup)) {
      registeredShortcut = settings.shortcut;
      return true;
    }
  } catch {}
  return false;
}

function applyLoginItem() {
  if (process.platform !== 'win32') return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: exe, args });
}

function updateSettings(patch = {}) {
  const previous = settings;
  settings = sanitizeSettings({ ...settings, ...patch });
  saveSettings();
  let shortcutOk = true;
  if (settings.shortcut !== previous.shortcut) shortcutOk = registerShortcut();
  if (settings.launchAtLogin !== previous.launchAtLogin) applyLoginItem();
  if (settings.theme !== previous.theme) nativeTheme.themeSource = settings.theme;
  if (settings.refreshSeconds !== previous.refreshSeconds) schedulePolling();
  if (settings.taskbarStyle !== previous.taskbarStyle) applyStrip();
  if (settings.localApi !== previous.localApi) applyLocalApi();
  if (settings.hideFromScreenShare !== previous.hideFromScreenShare) popup?.setContentProtection(settings.hideFromScreenShare);
  for (const id of PROVIDER_IDS) {
    const key = providerSettingKey(id);
    if (settings[key] && !previous[key]) {
      void refreshProvider(id, { force: true });
      if (id === 'cursor') void spendService?.refreshCursor({ force: true });
      else void spendService?.refreshLocal();
    }
  }
  sendSnapshot();
  return { settings, shortcutOk };
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
  hidePopup();
  if (provider === 'cursor') return openCursor();
  if (provider === 'claude') return openCliLogin('Claude Login', 'claude auth login');
  if (provider === 'antigravity') return openCliLogin('Antigravity', 'agy');
  return openCliLogin('Codex Login', 'codex login');
}

function openExternal(url) {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return false;
  hidePopup();
  void shell.openExternal(url);
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

function quit() {
  isQuitting = true;
  app.quit();
}

ipcMain.handle('get-state', () => snapshot());
ipcMain.handle('update-settings', (_event, patch) => updateSettings(patch));
ipcMain.handle('refresh', (_event, id) => (
  id ? refreshProvider(id, { force: true }) : refreshAll({ force: true })
));
ipcMain.handle('open-login', (_event, provider) => openLogin(provider));
ipcMain.handle('open-external', (_event, url) => openExternal(url));
ipcMain.handle('check-for-update', checkForUpdate);
ipcMain.handle('open-mobile-pairing', openMobilePairing);
ipcMain.handle('get-mobile-access-status', getMobileAccessStatus);
ipcMain.handle('enable-mobile-access', enableMobileAccess);
ipcMain.handle('get-mobile-pairing', getMobilePairing);
ipcMain.handle('suspend-shortcut', (_event, suspended) => {
  if (suspended) {
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  } else {
    registerShortcut();
  }
});
ipcMain.on('popup-size', (_event, height) => {
  const next = Math.round(Number(height));
  if (!Number.isFinite(next) || next < 120 || next === popupHeight) return;
  popupHeight = next;
  if (popup?.isVisible()) positionPopup();
});
ipcMain.handle('copy-screenshot', (_event, rect) => copyScreenshot(rect));
ipcMain.handle('reset-settings', () => resetAllSettings());
ipcMain.handle('report-issue', () => shell.openExternal(ISSUES_URL).then(() => true));
ipcMain.on('tray-image', (_event, payload) => setTrayImage(payload));
ipcMain.on('strip-width', (event, width) => {
  if (strip?.isWindow(event.sender)) strip.setContentWidth(width);
});
ipcMain.on('hide-popup', hidePopup);
ipcMain.on('quit', quit);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPopup());
  app.whenReady().then(() => {
    app.setAppUserModelId('com.parthjadhav.throttle');
    settings = loadSettings();
    nativeTheme.themeSource = settings.theme;
    loadUsageCache();
    spendService = new SpendService({
      cacheDir: app.getPath('userData'),
      getCursorEvents: options => (cursorClient ||= new CursorClient()).getUsageEvents(options),
      isEnabled
    });
    spendService.on('update', sendSnapshot);
    createTray();
    createPopup();
    const screenshotMode = process.argv.some(arg => arg.startsWith('--screenshot='));
    if (!screenshotMode) {
      strip = new TaskbarStrip({
        preload: path.join(__dirname, 'strip-preload.js'),
        file: path.join(__dirname, 'strip.html'),
        onClick: (button, anchor) => (button === 'right'
          ? tray?.popUpContextMenu(trayMenu(), screen.getCursorScreenPoint())
          : togglePopup(anchor))
      });
      applyStrip();
      applyLocalApi();
    }
    spendService.start();
    registerShortcut();
    if (app.isPackaged) applyLoginItem();
    startMobileServer().catch(error => {
      console.warn('Throttle mobile server could not start:', error.message);
    });
    schedulePolling();
    setTimeout(() => void refreshAll(), 400);
    screen.on('display-metrics-changed', () => popup?.isVisible() && positionPopup());
    nativeTheme.on('updated', sendSnapshot);
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  if (!settings) return;
  clearInterval(pollTimer);
  writeUsageCache();
  globalShortcut.unregisterAll();
  codexClient?.stop();
  spendService?.stop();
  strip?.destroy();
  localApi?.close();
  void mobileServer?.stop();
  mobileAccessWindow?.destroy();
  tray?.destroy();
});
