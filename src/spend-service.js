const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PricingCatalog } = require('./pricing');
const { OpenCodeScanner } = require('./opencode-spend');
const spend = require('./spend');

const DAY_MS = 86400000;
const LOCAL_INTERVAL_MS = 60 * 1000;
const CURSOR_INTERVAL_MS = 10 * 60 * 1000;
// Providers whose spend Throttle reads straight off the local machine.
const LOCAL_SCANNERS = ['claude', 'codex', 'opencode'];
const SOURCES = { claude: 'logs', codex: 'logs', opencode: 'opencode' };

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

class SpendService extends EventEmitter {
  constructor({ cacheDir, getCursorEvents, isEnabled = () => true, now = () => Date.now() }) {
    super();
    this.cacheDir = cacheDir;
    this.getCursorEvents = getCursorEvents;
    this.isEnabled = isEnabled;
    this.now = now;
    this.pricing = new PricingCatalog({ cacheDir });
    this.scanners = {
      claude: spend.createClaudeScanner(),
      codex: spend.createCodexScanner(),
      opencode: new OpenCodeScanner()
    };
    this.results = {};
    this.cursor = this.loadCursorCache();
    this.busy = new Set();
    this.timers = [];
    if (this.cursor.days) this.setCursorResult();
  }

  cachePath() {
    return path.join(this.cacheDir, 'spend-cache.json');
  }

  loadCursorCache() {
    try {
      const cached = JSON.parse(fs.readFileSync(this.cachePath(), 'utf8'));
      if (cached?.cursor?.days && typeof cached.cursor.days === 'object') return cached.cursor;
    } catch {}
    return { days: null, fetchedAt: 0 };
  }

  saveCursorCache() {
    try {
      fs.writeFileSync(this.cachePath(), JSON.stringify({ cursor: this.cursor }));
    } catch (error) {
      console.warn('Throttle could not write the spend cache:', error.message);
    }
  }

  snapshot() {
    return this.results;
  }

  start() {
    void this.pricing.refresh().then(changed => changed && this.refreshLocal());
    void this.refreshLocal();
    void this.refreshCursor();
    this.timers.push(setInterval(() => void this.refreshLocal(), LOCAL_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.refreshCursor(), CURSOR_INTERVAL_MS));
    // Hourly, because the pricing supplement revalidates that often and its own interval keeps the
    // larger LiteLLM catalog to once a day.
    this.timers.push(setInterval(() => void this.pricing.refresh().then(changed => changed && this.refreshLocal()), 3600 * 1000));
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async refreshLocal() {
    for (const id of LOCAL_SCANNERS) {
      if (!this.isEnabled(id) || this.busy.has(id)) continue;
      this.busy.add(id);
      try {
        const now = this.now();
        let events = await this.scanners[id].scan(now);
        if (id === 'claude') events = spend.dedupeEvents(events);
        const summary = spend.summarize(spend.aggregate(events, this.pricing, now), now);
        this.results[id] = summary.last30
          ? { summary, updatedAt: now, source: SOURCES[id] }
          : this.emptyResult(id, now);
      } catch (error) {
        console.warn(`Throttle could not scan ${id} logs:`, error.message);
      } finally {
        this.busy.delete(id);
      }
    }
    this.emit('update');
  }

  // OpenCode reports whether it is installed so the card can say so instead of staying blank.
  emptyResult(id, now) {
    if (id !== 'opencode') return null;
    return { summary: null, updatedAt: now, source: SOURCES[id], available: this.scanners[id].available() };
  }

  async refreshCursor({ force = false } = {}) {
    if (!this.getCursorEvents || !this.isEnabled('cursor') || this.busy.has('cursor')) return;
    const now = this.now();
    if (!force && now - this.cursor.fetchedAt < CURSOR_INTERVAL_MS - 5000) return;
    this.busy.add('cursor');
    try {
      const incremental = this.cursor.days && now - this.cursor.fetchedAt < 20 * DAY_MS;
      const startMs = incremental ? startOfDay(this.cursor.fetchedAt) - DAY_MS : undefined;
      const raw = await this.getCursorEvents({ startMs });
      const fresh = spend.aggregate(spend.cursorEvents(raw), this.pricing, now).days;
      const days = {};
      const windowStart = startOfDay(now) - (spend.DAYS - 1) * DAY_MS;
      if (incremental) {
        const replaceFrom = spend.dayKey(startMs);
        for (const [key, day] of Object.entries(this.cursor.days)) {
          if (key < replaceFrom && key >= spend.dayKey(windowStart)) days[key] = day;
        }
      }
      Object.assign(days, fresh);
      this.cursor = { days, fetchedAt: now };
      this.saveCursorCache();
      this.setCursorResult();
      this.emit('update');
    } catch (error) {
      if (!/login|unauthor/i.test(error.message)) console.warn('Throttle could not read Cursor spend:', error.message);
    } finally {
      this.busy.delete('cursor');
    }
  }

  setCursorResult() {
    const summary = spend.summarize({ days: this.cursor.days, unpriced: [] }, this.now());
    this.results.cursor = summary.last30 ? { summary, updatedAt: this.cursor.fetchedAt, source: 'cursor' } : null;
  }
}

module.exports = { SpendService };
