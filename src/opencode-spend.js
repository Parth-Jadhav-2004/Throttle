const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { totalTokens, windowStart } = require('./spend');

// OpenCode keeps every assistant message in a SQLite database. Each row carries the
// tokens and the cost OpenCode itself recorded, which is more accurate than re-pricing.
const MESSAGE_TABLE = 'session_message';
const MESSAGE_TYPE = 'assistant';
// OpenCode dates usage by when a message was written, which can trail when it started,
// so widen the indexed scan a little and clip to the window afterwards.
const LOOKBACK_MS = 86400000;

const warned = new Set();

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

function opencodeDataDir() {
  if (process.env.OPENCODE_DATA_DIR) return process.env.OPENCODE_DATA_DIR;
  const dataHome = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, 'opencode')
    : path.join(os.homedir(), '.local', 'share', 'opencode');
  return dataHome;
}

function opencodeDbPath() {
  return process.env.OPENCODE_DB || path.join(opencodeDataDir(), 'opencode.db');
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function openCodeEvent(row) {
  let data;
  try {
    data = JSON.parse(row?.data);
  } catch {
    return null;
  }
  const tokens = data?.tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  const ts = Number(row?.time_updated ?? row?.time_created ?? data?.time?.created);
  if (!Number.isFinite(ts)) return null;
  const id = data?.model?.id;
  const model = id ? (data.model.providerID ? `${data.model.providerID}/${id}` : String(id)) : null;
  const cost = data?.cost == null ? null : Number(data.cost);
  return {
    ts,
    model,
    tokens: {
      input: number(tokens.input),
      cacheWrite5m: number(tokens.cache?.write),
      cacheWrite1h: 0,
      cacheRead: number(tokens.cache?.read),
      // OpenCode reports reasoning separately from output, so both count toward usage.
      output: number(tokens.output) + number(tokens.reasoning)
    },
    cost: Number.isFinite(cost) ? cost : null
  };
}

function openCodeEvents(rows = []) {
  const events = [];
  for (const row of rows) {
    const event = openCodeEvent(row);
    if (event && totalTokens(event.tokens)) events.push(event);
  }
  return events;
}

function loadDatabase() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return null;
  }
}

class OpenCodeScanner {
  constructor({ dbPath = opencodeDbPath, loadDatabase: load = loadDatabase } = {}) {
    this.dbPath = dbPath;
    this.load = load;
  }

  available() {
    try {
      return fs.existsSync(this.dbPath());
    } catch {
      return false;
    }
  }

  async scan(now = Date.now()) {
    if (!this.available()) return [];
    const DatabaseSync = this.load();
    if (typeof DatabaseSync !== 'function') return [];
    let db;
    try {
      db = new DatabaseSync(this.dbPath(), { readOnly: true });
    } catch (error) {
      warnOnce(`Throttle could not open the OpenCode database: ${error.message}`);
      return [];
    }
    try {
      const since = windowStart(now);
      const rows = db
        .prepare(`select time_created, time_updated, data from ${MESSAGE_TABLE} where type = ? and time_created >= ?`)
        .all(MESSAGE_TYPE, since - LOOKBACK_MS);
      return openCodeEvents(rows).filter(event => event.ts >= since);
    } catch (error) {
      warnOnce(`Throttle could not read OpenCode usage: ${error.message}`);
      return [];
    } finally {
      try {
        db.close();
      } catch {}
    }
  }
}

module.exports = {
  OpenCodeScanner,
  openCodeEvent,
  openCodeEvents,
  opencodeDataDir,
  opencodeDbPath
};
