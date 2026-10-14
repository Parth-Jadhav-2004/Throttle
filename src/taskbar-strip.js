const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { BrowserWindow, screen } = require('electron');
const embedder = require('./taskbar-embed');

const WATCH_MS = 2000;
const SETTLE_MS = 300;
const GAP_DIP = 6;
const WINDOW_TITLE = 'Throttle Taskbar Strip';

// Windows 11 does not route mouse input to windows embedded in the taskbar, so clicks
// are read by a low-level mouse hook on its own thread and matched to the strip's rect.
class TaskbarStrip {
  constructor({ preload, file, onClick }) {
    this.preload = preload;
    this.file = file;
    this.onClick = onClick;
    this.win = null;
    this.parentId = null;
    this.contentWidth = 120;
    this.lastPlacement = null;
    this.lastState = null;
    this.watchTimer = null;
    this.input = null;
  }

  get supported() {
    return embedder.available();
  }

  isWindow(webContents) {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.webContents === webContents);
  }

  setEnabled(enabled) {
    if (!this.supported) return;
    if (enabled && !this.win) this.create();
    if (!enabled) this.destroy();
  }

  create() {
    this.win = new BrowserWindow({
      title: WINDOW_TITLE,
      width: 400,
      height: 48,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      show: false,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    this.win.on('page-title-updated', event => event.preventDefault());
    this.win.loadFile(this.file);
    this.win.webContents.once('did-finish-load', () => {
      if (this.lastState) this.win?.webContents.send('strip-state', this.lastState);
      this.attach();
    });
    this.win.on('closed', () => {
      this.win = null;
      this.parentId = null;
    });
    clearInterval(this.watchTimer);
    this.watchTimer = setInterval(() => this.watch(), WATCH_MS);
    this.startInput();
  }

  destroy() {
    clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.stopInput();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.parentId = null;
    this.lastPlacement = null;
  }

  startInput() {
    if (this.input) return;
    const buffer = new SharedArrayBuffer(4);
    // Worker threads cannot load scripts from inside app.asar.
    const script = path.join(__dirname, 'taskbar-input-worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const worker = new Worker(script, {
      workerData: { buffer, title: WINDOW_TITLE }
    });
    this.input = { worker, shared: new Int32Array(buffer) };
    worker.on('message', message => {
      if (message.type === 'click') this.onClick?.(message.button, this.anchorRect());
      else if (message.type === 'hover') this.win?.webContents.send('strip-hover', message.inside);
      else if (message.type === 'ready' && !message.ok) console.warn('Taskbar strip clicks unavailable: mouse hook failed');
    });
    worker.on('error', error => console.warn('Taskbar strip input stopped:', error.message));
    worker.on('exit', () => {
      if (this.input?.worker === worker) this.input = null;
    });
  }

  stopInput() {
    if (!this.input) return;
    const { worker, shared } = this.input;
    this.input = null;
    if (!embedder.quitThread(Atomics.load(shared, 0))) void worker.terminate();
  }

  attach() {
    if (!this.win || this.win.isDestroyed()) return;
    const found = embedder.findTaskbar();
    if (!found || !found.horizontal) {
      this.win.hide();
      this.parentId = null;
      return;
    }
    this.win.showInactive();
    if (!embedder.embed(this.win.getNativeWindowHandle(), found.handle)) return;
    this.parentId = found.id;
    this.lastPlacement = null;
    setTimeout(() => this.layout(), SETTLE_MS);
  }

  layout() {
    if (!this.win || this.win.isDestroyed() || !this.parentId) return;
    const found = embedder.findTaskbar();
    if (!found) return;
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    const placement = embedder.stripPlacement(found, Math.ceil(this.contentWidth * scale), Math.round(GAP_DIP * scale));
    const key = JSON.stringify(placement);
    if (key === this.lastPlacement) return;
    this.lastPlacement = key;
    embedder.move(this.win.getNativeWindowHandle(), placement);
  }

  watch() {
    if (!this.win || this.win.isDestroyed()) return;
    const found = embedder.findTaskbar();
    if (!found) return;
    if (!this.parentId) {
      if (found.horizontal) this.attach();
      return;
    }
    if (found.id !== this.parentId || !found.horizontal) {
      // Explorer restarted (destroying our parent) or the taskbar moved to a side edge.
      this.destroy();
      this.create();
      return;
    }
    this.layout();
  }

  setContentWidth(width) {
    const next = Math.max(24, Math.min(800, Math.round(Number(width) || 0)));
    if (next === this.contentWidth) return;
    this.contentWidth = next;
    this.layout();
  }

  update(state) {
    this.lastState = state;
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isLoading()) {
      this.win.webContents.send('strip-state', state);
    }
  }

  anchorRect() {
    if (!this.win || this.win.isDestroyed() || !this.parentId) return null;
    const rect = embedder.screenRect(this.win.getNativeWindowHandle());
    if (!rect) return null;
    const physical = { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
    return screen.screenToDipRect(null, physical);
  }
}

module.exports = { TaskbarStrip };
