const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/usage-model');

const NOW = 1_800_000_000;

function sessionMetric(usedPercent, elapsedFraction) {
  const windowMins = 300;
  return {
    id: 'session',
    label: 'Session',
    usedPercent,
    windowMins,
    resetsAt: NOW + windowMins * 60 * (1 - elapsedFraction)
  };
}

test('maps each provider into labelled metrics', () => {
  assert.deepEqual(
    model.metricsForProvider('claude', {
      fiveHour: { usedPercent: 40, resetsAt: NOW + 60 },
      weekly: { usedPercent: 10, resetsAt: NOW + 600 }
    }).map(m => [m.id, m.label, m.usedPercent, m.windowMins]),
    [['session', 'Session', 40, 300], ['weekly', 'Weekly', 10, 10080]]
  );
  assert.deepEqual(
    model.metricsForProvider('codex', { isFree: true, monthly: { usedPercent: 5, windowDurationMins: 43200 } }).map(m => m.id),
    ['monthly']
  );
  const cursor = model.metricsForProvider('cursor', {
    layout: 'requests',
    remainingLabel: '120 left',
    included: { usedPercent: 60, resetsAt: NOW + 10, windowDurationMins: 43200 }
  });
  assert.equal(cursor[0].label, 'Included requests');
  assert.equal(cursor[0].detail, '120 left');
  assert.deepEqual(
    model.metricsForProvider('antigravity', {
      windows: [{ label: 'Gemini 3 Pro', usedPercent: 20 }, { label: 'Gemini 3 Pro', usedPercent: 30 }]
    }).map(m => m.id),
    ['gemini-3-pro', 'gemini-3-pro-2']
  );
  assert.deepEqual(model.metricsForProvider('claude', null), []);
});

test('metric catalog keeps static entries even before data arrives', () => {
  assert.deepEqual(model.metricCatalog('claude', null).map(m => m.id), ['session', 'weekly', 'today', 'yesterday', 'last30', 'trend']);
  assert.deepEqual(model.metricCatalog('antigravity', { windows: [{ label: 'Claude', usedPercent: 1 }] }).map(m => m.id), ['claude']);
});

test('pace stays ok when the projection leaves a comfortable cushion', () => {
  const pace = model.computePace(sessionMetric(20, 0.5), NOW);
  assert.equal(pace.tone, 'ok');
  assert.equal(Math.round(pace.projectedUsed), 40);
  assert.equal(Math.round(pace.evenPace), 50);
});

test('pace turns tight inside the last ten percent', () => {
  const pace = model.computePace(sessionMetric(46, 0.5), NOW);
  assert.equal(pace.verdict, 'tight');
  assert.equal(pace.tone, 'warn');
  assert.equal(model.formatPaceNote(pace, 'relative', NOW), '~8% spare');
});

test('pace predicts a run-out time when burning too fast', () => {
  const pace = model.computePace(sessionMetric(50, 0.25), NOW);
  assert.equal(pace.verdict, 'over');
  assert.equal(pace.tone, 'danger');
  assert.equal(Math.round(pace.runOutAt - NOW), 75 * 60);
  assert.equal(model.formatPaceNote(pace, 'relative', NOW), 'Limit in 1h 15m');
  assert.equal(model.formatPaceDetail(pace), '~100% over limit at reset');
});

test('a spent limit always reads as reached', () => {
  const pace = model.computePace(sessionMetric(100, 0.9), NOW);
  assert.equal(pace.verdict, 'reached');
  assert.equal(model.formatPaceNote(pace), 'Limit reached');
});

test('young windows and windowless metrics color by level only', () => {
  assert.equal(model.computePace(sessionMetric(85, 0.01), NOW).tone, 'warn');
  assert.equal(model.computePace({ usedPercent: 95 }, NOW).tone, 'danger');
  assert.equal(model.computePace({ usedPercent: 30 }, NOW).tone, 'ok');
  assert.equal(model.computePace({ usedPercent: 30 }, NOW).projectedUsed, null);
});

test('formats values, durations, and resets', () => {
  assert.equal(model.formatValue({ usedPercent: 48.4 }, 'left'), '52% left');
  assert.equal(model.formatValue({ usedPercent: 48.4 }, 'used'), '48% used');
  assert.equal(model.formatDuration(3 * 3600 + 25 * 60), '3h 25m');
  assert.equal(model.formatDuration(86400 * 2 + 3600), '2d 1h');
  assert.equal(model.formatDuration(20), '<1m');
  assert.equal(model.formatReset(NOW + 3600, 'relative', NOW), 'Resets in 1h');
  assert.equal(model.formatReset(NOW - 5, 'relative', NOW), 'Resets now');
  assert.equal(model.formatReset(null), '');
  assert.match(model.formatReset(NOW + 3600, 'absolute', NOW, '24h'), /^Resets (today|tomorrow) at /);
});

test('tray metrics prefer starred metrics, else the two most used', () => {
  const providers = {
    claude: { data: { fiveHour: { usedPercent: 70 }, weekly: { usedPercent: 20 } } },
    codex: { data: { fiveHour: { usedPercent: 90 }, weekly: { usedPercent: 10 } } }
  };
  const base = { providerOrder: ['claude', 'codex', 'cursor', 'antigravity'] };
  assert.deepEqual(model.trayMetrics(providers, base, NOW).map(e => e.key), ['codex:session', 'claude:session']);
  assert.deepEqual(
    model.trayMetrics(providers, { ...base, starredMetrics: ['claude:weekly'] }, NOW).map(e => e.key),
    ['claude:weekly']
  );
  assert.deepEqual(
    model.trayMetrics(providers, { ...base, showCodex: false, hiddenMetrics: ['claude:session'] }, NOW).map(e => e.key),
    ['claude:weekly']
  );
  assert.equal(
    model.trayTooltip(model.trayMetrics(providers, base, NOW), 'left'),
    'Throttle\nCodex Session: 10% left\nClaude Session: 30% left'
  );
});

test('taskbar shows starred meters per provider, else the first two of each', () => {
  const providers = {
    claude: { data: { fiveHour: { usedPercent: 70 }, weekly: { usedPercent: 20 } } },
    codex: { data: { fiveHour: { usedPercent: 90 }, weekly: { usedPercent: 10 }, monthly: { usedPercent: 5 } } }
  };
  const base = { providerOrder: ['claude', 'codex', 'cursor', 'antigravity'] };
  const keys = settings => model.stripEntries(providers, { ...base, ...settings }, NOW).map(group => [group.provider, group.metrics.map(e => e.metric.id)]);
  assert.deepEqual(keys({}), [['claude', ['session', 'weekly']], ['codex', ['session', 'weekly']]]);
  assert.deepEqual(keys({ starredMetrics: ['codex:monthly'] }), [['claude', ['session', 'weekly']], ['codex', ['monthly']]]);
  assert.deepEqual(keys({ taskbarHiddenProviders: ['claude'], hiddenMetrics: ['codex:session'] }), [['codex', ['weekly', 'monthly']]]);
  assert.deepEqual(keys({ showCodex: false }), [['claude', ['session', 'weekly']]]);
});

test('spend rows start on demand and the trend stays visible unless moved', () => {
  const catalog = model.metricCatalog('codex', null);
  const placement = (id, settings = {}) => model.placementFor(`codex:${id}`, catalog.find(entry => entry.id === id), settings);
  assert.equal(placement('session'), 'always');
  assert.equal(placement('today'), 'demand');
  assert.equal(placement('trend'), 'always');
  assert.equal(placement('today', { placements: { 'codex:today': 'always' } }), 'always');
  assert.equal(model.metricCatalog('antigravity', null).some(entry => entry.kind !== 'quota'), false);
});

test('formats money, tokens and spend rows compactly', () => {
  assert.equal(model.formatMoney(4.6), '$4.60');
  assert.equal(model.formatMoney(596.48), '$596');
  assert.equal(model.formatMoney(4600), '$4.6K');
  assert.equal(model.formatTokens(35_800_000), '35.8M');
  assert.equal(model.formatTokens(618_500_000), '619M');
  assert.equal(model.formatSpendRow({ cost: 49.85, tokens: 35_800_000 }), '$49.85 · 35.8M tokens');
  assert.equal(model.formatSpendRow(null), 'No usage');
  assert.equal(model.formatSpendValue(2.5, 'rate', true), '$2.50 per million tokens');
});

test('totals spend across visible providers, ranked by value', () => {
  const spend = {
    claude: { summary: { last30: { cost: 10, tokens: 4e6 } } },
    codex: { summary: { last30: { cost: 30, tokens: 1e6 } } },
    cursor: { summary: { last30: { cost: 20, tokens: 10e6 } } }
  };
  const settings = { providerOrder: ['claude', 'codex', 'cursor', 'antigravity'], showCursor: false };
  const cost = model.totalSpend(spend, settings, 'last30', 'cost');
  assert.equal(cost.value, 40);
  assert.deepEqual(cost.slices.map(slice => slice.provider), ['codex', 'claude']);
  const tokens = model.totalSpend(spend, { ...settings, showCursor: true }, 'last30', 'tokens');
  assert.deepEqual(tokens.slices.map(slice => slice.provider), ['cursor', 'claude', 'codex']);
  assert.equal(model.totalSpend(spend, settings, 'last30', 'rate').value, 40 / 5);
  assert.equal(model.totalSpend(spend, settings, 'today', 'cost').slices.length, 0);
});