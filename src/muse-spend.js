const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const spend = require('./spend');

// Muse records every model call in a per-session event stream. The usage lives in
// `model_completed` events; the `goal_usage_attribution` records that follow repeat the
// same numbers, so only `model_completed` is counted to avoid double billing.
const USAGE_MARKER = '"model_completed"';

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function museDataDir() {
  if (process.env.MUSE_DATA_DIR) return process.env.MUSE_DATA_DIR;
  const dataHome = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, 'muse')
    : path.join(os.homedir(), '.local', 'share', 'muse');
  return dataHome;
}

function museSessionsRoots() {
  return [path.join(museDataDir(), 'sessions')].filter(dir => {
    try { return fs.existsSync(dir); } catch { return false; }
  });
}

function museEvent(record) {
  const payload = record?.payload;
  const event = payload?.event;
  if (record?.payload_type !== 'runtime.session' || payload?.kind !== 'run' || event?.kind !== 'model_completed') return null;
  // `recorded_at` is epoch microseconds.
  const ts = Number(record.recorded_at) / 1000;
  if (!Number.isFinite(ts)) return null;
  const usage = event.usage || {};
  const input = number(usage.input_tokens);
  // Input is reported including the tokens served from cache, so split it the way
  // the other OpenAI-style providers are split.
  const cacheRead = Math.min(number(usage.cache_read_tokens ?? usage.cached_tokens), input);
  const tokens = {
    input: input - cacheRead,
    cacheWrite5m: number(usage.cache_write_tokens),
    cacheWrite1h: 0,
    cacheRead,
    output: number(usage.output_tokens)
  };
  if (!spend.totalTokens(tokens)) return null;
  return { ts, model: event.model || 'muse', tokens, cost: null };
}

function museEventsFromLines(lines = []) {
  const events = [];
  for (const line of lines) {
    if (!line.includes(USAGE_MARKER)) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const event = museEvent(record);
    if (event) events.push(event);
  }
  return events;
}

function createMuseParser() {
  return {
    push: museEventsFromLines,
    // Each event is self-contained, so nothing has to survive between appended chunks.
    state: () => null
  };
}

class MuseScanner {
  constructor({ roots = museSessionsRoots, createParser = createMuseParser } = {}) {
    this.roots = roots;
    this.scanner = new spend.LogScanner({ roots, createParser });
  }

  // Muse is installed when its session store exists, even before the first session.
  available() {
    return this.roots().length > 0;
  }

  scan(now = Date.now()) {
    return this.scanner.scan(now);
  }
}

module.exports = {
  MuseScanner,
  createMuseParser,
  museDataDir,
  museSessionsRoots,
  museEvent,
  museEventsFromLines
};
