const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DAYS = 30;
const DAY_MS = 86400000;
const EFFORT_SUFFIX = /-(minimal|low|medium|high|xhigh|extra-high|max|thinking|fast)$/;

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function windowStart(now = Date.now()) {
  return startOfDay(now) - (DAYS - 1) * DAY_MS;
}

function baseModel(model) {
  let name = String(model || 'unknown').trim().toLowerCase();
  while (EFFORT_SUFFIX.test(name)) name = name.replace(EFFORT_SUFFIX, '');
  return name || 'unknown';
}

function totalTokens(tokens) {
  return (tokens.input || 0) + (tokens.cacheWrite5m || 0) + (tokens.cacheWrite1h || 0) +
    (tokens.cacheRead || 0) + (tokens.output || 0);
}

function listJsonl(root, sinceMs) {
  const files = [];
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl') && stat.mtimeMs >= sinceMs) files.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseClaudeLine(line) {
  let object;
  try { object = JSON.parse(line); } catch { return null; }
  const message = object?.message;
  const usage = message?.usage;
  const ts = Date.parse(object?.timestamp);
  if (!usage || !Number.isFinite(ts) || typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number') return null;
  const creation = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
  const tokens = {
    input: number(usage.input_tokens),
    cacheWrite5m: creation ? number(creation.ephemeral_5m_input_tokens) : number(usage.cache_creation_input_tokens),
    cacheWrite1h: creation ? number(creation.ephemeral_1h_input_tokens) : 0,
    cacheRead: number(usage.cache_read_input_tokens),
    output: number(usage.output_tokens)
  };
  if (!totalTokens(tokens)) return null;
  const model = message.model && message.model !== '<synthetic>' ? message.model : null;
  return {
    ts,
    model,
    tokens,
    cost: typeof object.costUSD === 'number' ? object.costUSD : null,
    dedupe: message.id && object.requestId ? `${message.id}:${object.requestId}` : (message.id || null)
  };
}

function parseCodexFile(text) {
  const events = [];
  let model = null;
  let previous = null;
  for (const line of text.split('\n')) {
    const isTurn = line.includes('"turn_context"');
    if (!isTurn && !line.includes('"token_count"')) continue;
    let object;
    try { object = JSON.parse(line); } catch { continue; }
    const payload = object?.payload;
    if (object?.type === 'turn_context') {
      model = payload?.model || model;
      continue;
    }
    if (object?.type !== 'event_msg' || payload?.type !== 'token_count') continue;
    const ts = Date.parse(object.timestamp);
    if (!Number.isFinite(ts)) continue;
    const info = payload.info || {};
    const totals = info.total_token_usage || null;
    const signature = totals ? `${totals.input_tokens}:${totals.cached_input_tokens}:${totals.output_tokens}` : null;
    if (signature && signature === previous) continue;
    if (signature) previous = signature;
    const last = info.last_token_usage;
    if (!last) continue;
    const cached = Math.min(number(last.cached_input_tokens), number(last.input_tokens));
    const tokens = {
      input: number(last.input_tokens) - cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: cached,
      output: number(last.output_tokens)
    };
    if (!totalTokens(tokens)) continue;
    events.push({ ts, model: payload.model || info.model || model || 'gpt-5-codex', tokens, cost: null });
  }
  return events;
}

class LogScanner {
  constructor({ roots, parseFile }) {
    this.roots = roots;
    this.parseFile = parseFile;
    this.files = new Map();
  }

  async scan(now = Date.now()) {
    const since = windowStart(now);
    const seen = new Set();
    const events = [];
    for (const root of this.roots()) {
      for (const file of listJsonl(root, since)) {
        seen.add(file.path);
        let cached = this.files.get(file.path);
        if (!cached || cached.size !== file.size || cached.mtimeMs !== file.mtimeMs) {
          let text = '';
          try { text = await fs.promises.readFile(file.path, 'utf8'); } catch { continue; }
          cached = { size: file.size, mtimeMs: file.mtimeMs, events: this.parseFile(text) };
          this.files.set(file.path, cached);
        }
        for (const event of cached.events) if (event.ts >= since) events.push(event);
      }
    }
    for (const key of this.files.keys()) if (!seen.has(key)) this.files.delete(key);
    return events;
  }
}

function claudeRoots() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  const homes = configured
    ? configured.split(/[,;]/).map(s => s.trim()).filter(Boolean)
    : [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.config', 'claude')];
  return homes.map(home => path.join(home, 'projects')).filter(dir => fs.existsSync(dir));
}

function codexRoots() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return ['sessions', 'archived_sessions'].map(dir => path.join(home, dir)).filter(dir => fs.existsSync(dir));
}

function createClaudeScanner(roots = claudeRoots) {
  return new LogScanner({
    roots,
    parseFile: text => text.split('\n').filter(line => line.includes('"usage":{')).map(parseClaudeLine).filter(Boolean)
  });
}

function createCodexScanner(roots = codexRoots) {
  return new LogScanner({ roots, parseFile: parseCodexFile });
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    if (!event.dedupe) return true;
    if (seen.has(event.dedupe)) return false;
    seen.add(event.dedupe);
    return true;
  });
}

function cursorEvents(rawEvents = []) {
  const events = [];
  for (const raw of rawEvents) {
    const ts = Number(raw?.timestamp);
    if (!Number.isFinite(ts)) continue;
    const usage = raw.tokenUsage || {};
    const tokens = {
      input: number(usage.inputTokens),
      cacheWrite5m: number(usage.cacheWriteTokens),
      cacheWrite1h: 0,
      cacheRead: number(usage.cacheReadTokens),
      output: number(usage.outputTokens)
    };
    const cents = Number(usage.totalCents ?? raw.chargedCents);
    events.push({ ts, model: raw.model || 'unknown', tokens, cost: Number.isFinite(cents) ? cents / 100 : null });
  }
  return events;
}

function aggregate(events, pricing, now = Date.now()) {
  const since = windowStart(now);
  const days = {};
  const unpriced = new Set();
  for (const event of events) {
    if (event.ts < since || event.ts > now + DAY_MS) continue;
    const cost = event.cost ?? (event.model ? pricing?.cost(event.model, event.tokens) : 0);
    const tokens = totalTokens(event.tokens);
    if (cost == null) {
      unpriced.add(event.model);
      continue;
    }
    const key = dayKey(event.ts);
    const day = days[key] ||= { cost: 0, tokens: 0, models: {} };
    const model = baseModel(event.model);
    const entry = day.models[model] ||= { cost: 0, tokens: 0 };
    day.cost += cost;
    day.tokens += tokens;
    entry.cost += cost;
    entry.tokens += tokens;
  }
  return { days, unpriced: [...unpriced].filter(Boolean).sort() };
}

function mergePeriod(dayEntries) {
  const result = { cost: 0, tokens: 0, models: [] };
  const models = {};
  let any = false;
  for (const day of dayEntries) {
    if (!day) continue;
    any = true;
    result.cost += day.cost;
    result.tokens += day.tokens;
    for (const [name, entry] of Object.entries(day.models)) {
      const target = models[name] ||= { name, cost: 0, tokens: 0 };
      target.cost += entry.cost;
      target.tokens += entry.tokens;
    }
  }
  if (!any || (!result.cost && !result.tokens)) return null;
  result.models = Object.values(models).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  return result;
}

function summarize(aggregateResult, now = Date.now()) {
  const { days, unpriced } = aggregateResult;
  const today = dayKey(now);
  const yesterday = dayKey(startOfDay(now) - DAY_MS / 2);
  const trend = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const key = dayKey(startOfDay(now) - i * DAY_MS + DAY_MS / 2);
    trend.push({ date: key, tokens: days[key]?.tokens || 0, cost: days[key]?.cost || 0 });
  }
  return {
    today: mergePeriod([days[today]]),
    yesterday: mergePeriod([days[yesterday]]),
    last30: mergePeriod(Object.entries(days).filter(([key]) => key >= dayKey(windowStart(now))).map(([, day]) => day)),
    trend,
    unpriced
  };
}

module.exports = {
  DAYS,
  dayKey,
  baseModel,
  totalTokens,
  parseClaudeLine,
  parseCodexFile,
  createClaudeScanner,
  createCodexScanner,
  dedupeEvents,
  cursorEvents,
  aggregate,
  summarize
};
