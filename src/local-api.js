const http = require('node:http');
const model = require('./usage-model');

const PORT = 6736;
const FRESH_MS = 5 * 60 * 1000;
const MAX_CONNECTIONS = 16;

function iso(epochMs) {
  return epochMs ? new Date(epochMs).toISOString() : null;
}

function limitsProvider(id, provider, nowMs) {
  const metrics = model.metricsForProvider(id, provider?.data);
  if (!metrics.length) return null;
  const resources = {};
  for (const m of metrics) {
    const resource = {
      kind: 'consumption',
      unit: 'percent',
      used: Math.round(m.usedPercent * 100) / 100,
      limit: 100,
      remaining: Math.round((100 - m.usedPercent) * 100) / 100,
      utilization: Math.round(m.usedPercent * 100) / 10000
    };
    if (m.resetsAt) resource.resetsAt = iso(m.resetsAt * 1000);
    if (m.windowMins) resource.windowSeconds = m.windowMins * 60;
    resources[m.id] = resource;
  }
  const fetchedAt = provider.updatedAt || nowMs;
  return {
    displayName: model.PROVIDER_META[id]?.name || id,
    plan: provider.data?.planType || null,
    fetchedAt: iso(fetchedAt),
    expiresAt: iso(fetchedAt + FRESH_MS),
    stale: nowMs > fetchedAt + FRESH_MS,
    resources
  };
}

function limitsEnvelope(ids, providers, nowMs = Date.now()) {
  const envelope = { schema: 'throttle.limits.v1', generatedAt: iso(nowMs), providers: {}, errors: [] };
  for (const id of ids) {
    const provider = providers[id];
    const entry = limitsProvider(id, provider, nowMs);
    if (entry) envelope.providers[id] = entry;
    if (provider?.error) envelope.errors.push({ providerId: id, message: provider.error });
  }
  return envelope;
}

function trendLine(summary, id) {
  return {
    type: 'barChart',
    label: 'Usage Trend',
    points: summary.trend.map(day => ({
      label: new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: day.tokens,
      valueLabel: `${model.formatTokens(day.tokens)} tokens`
    })),
    note: id === 'cursor' ? 'Reported by Cursor.' : `Estimated from local ${model.PROVIDER_META[id].name} logs at API rates.`,
    color: null
  };
}

function usageSnapshot(id, provider, spend) {
  const metrics = model.metricsForProvider(id, provider?.data);
  const summary = spend?.[id]?.summary;
  if (!metrics.length && !summary) return null;
  const lines = metrics.map(m => ({
    type: 'progress',
    label: m.label,
    used: m.usedPercent,
    limit: 100,
    format: { kind: 'percent' },
    resetsAt: m.resetsAt ? iso(m.resetsAt * 1000) : null,
    periodDurationMs: m.windowMins ? m.windowMins * 60000 : null,
    color: null
  }));
  if (summary) {
    for (const [key, label] of [['today', 'Today'], ['yesterday', 'Yesterday'], ['last30', 'Last 30 Days']]) {
      lines.push({ type: 'text', label, value: model.formatSpendRow(summary[key]), color: null, subtitle: null });
    }
    lines.push(trendLine(summary, id));
  }
  return {
    providerId: id,
    displayName: model.PROVIDER_META[id]?.name || id,
    plan: provider?.data?.planType || null,
    lines,
    fetchedAt: iso(provider?.updatedAt)
  };
}

function route(method, url, { visibleIds, allIds, providers, spend }) {
  if (method === 'OPTIONS') return { status: 204 };
  if (method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
  const match = /^\/v1\/(limits|usage)(?:\/([\w-]+))?\/?$/.exec(url.split('?')[0]);
  if (!match) return { status: 404, body: { error: 'not_found' } };
  const [, kind, id] = match;
  if (id && !allIds.includes(id)) return { status: 404, body: { error: 'provider_not_found' } };
  const ids = id ? [id] : visibleIds;
  if (kind === 'limits') return { status: 200, body: limitsEnvelope(ids, providers) };
  return { status: 200, body: ids.map(each => usageSnapshot(each, providers[each], spend)).filter(Boolean) };
}

function startLocalApi(getState, { port = PORT } = {}) {
  let connections = 0;
  const server = http.createServer((req, res) => {
    const bound = server.address()?.port;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${bound}` && host !== `localhost:${bound}`) {
      res.writeHead(403).end();
      return;
    }
    connections += 1;
    res.on('close', () => { connections -= 1; });
    const result = connections > MAX_CONNECTIONS
      ? { status: 503, body: { error: 'server_busy' } }
      : route(req.method, req.url || '/', getState());
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    });
    res.end(result.body ? JSON.stringify(result.body, null, 2) : undefined);
  });
  server.on('error', error => console.warn(`Local API disabled: ${error.message}`));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { PORT, startLocalApi, route, limitsEnvelope, usageSnapshot };
