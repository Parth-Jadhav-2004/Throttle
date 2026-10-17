(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.usageModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SESSION_MINS = 300;
  const WEEK_MINS = 10080;
  const MIN_ELAPSED_FRACTION = 0.04;
  const TIGHT_SPARE_PERCENT = 10;

  const PROVIDER_META = {
    claude: {
      name: 'Claude',
      color: '#d97757',
      links: [
        { label: 'Usage', url: 'https://claude.ai/settings/usage' },
        { label: 'Status', url: 'https://status.anthropic.com' }
      ]
    },
    codex: {
      name: 'Codex',
      color: '#10a37f',
      links: [
        { label: 'Usage', url: 'https://chatgpt.com/codex/settings/usage' },
        { label: 'Status', url: 'https://status.openai.com' }
      ]
    },
    cursor: {
      name: 'Cursor',
      color: '#8b8b93',
      links: [
        { label: 'Dashboard', url: 'https://cursor.com/dashboard' },
        { label: 'Status', url: 'https://status.cursor.com' }
      ]
    },
    antigravity: {
      name: 'Antigravity',
      color: '#4f8cff',
      links: [
        { label: 'Docs', url: 'https://antigravity.google/docs' }
      ]
    },
    muse: {
      name: 'Muse',
      color: '#8b5cf6',
      links: [{ label: 'Docs', url: 'https://dev.meta.ai' }]
    },
    opencode: {
      name: 'OpenCode',
      color: '#b8bcc8',
      links: [
        { label: 'Console', url: 'https://opencode.ai/console' },
        { label: 'Docs', url: 'https://opencode.ai/docs' }
      ]
    }
  };

  const STATIC_METRICS = {
    claude: [
      { id: 'session', label: 'Session' },
      { id: 'weekly', label: 'Weekly' }
    ],
    codex: [
      { id: 'session', label: 'Session' },
      { id: 'weekly', label: 'Weekly' },
      { id: 'monthly', label: 'Monthly' }
    ],
    cursor: [
      { id: 'included', label: 'Cursor models' },
      { id: 'api', label: 'Other models' }
    ],
    antigravity: [
      { id: 'quota', label: 'All models' }
    ],
    muse: [],
    opencode: []
  };

  function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  }

  function metric(id, label, window, fallbackMins = null) {
    const usedPercent = clampPercent(window?.usedPercent);
    if (usedPercent == null) return null;
    const resetsAt = Number(window.resetsAt);
    const mins = Number(window.windowDurationMins);
    return {
      id,
      label,
      usedPercent,
      resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
      windowMins: Number.isFinite(mins) && mins > 0 ? mins : fallbackMins
    };
  }

  function metricsForProvider(provider, data) {
    if (!data) return [];
    if (provider === 'claude') {
      return [
        metric('session', 'Session', data.fiveHour, SESSION_MINS),
        metric('weekly', 'Weekly', data.weekly, WEEK_MINS)
      ].filter(Boolean);
    }
    if (provider === 'codex') {
      return [
        metric('session', 'Session', data.fiveHour, SESSION_MINS),
        metric('weekly', 'Weekly', data.weekly, WEEK_MINS),
        metric('monthly', 'Monthly', data.monthly)
      ].filter(Boolean);
    }
    if (provider === 'cursor') {
      const includedLabel = data.layout === 'requests' ? 'Included requests' : 'Cursor models';
      const included = metric('included', includedLabel, data.included);
      if (included && data.remainingLabel) included.detail = data.remainingLabel;
      return [included, metric('api', 'Other models', data.api)].filter(Boolean);
    }
    if (provider === 'antigravity') {
      // One bar covers every model, so report the window that is closest to its limit.
      let worst = null;
      let worstUsed = -1;
      for (const window of data.windows || []) {
        const used = clampPercent(window?.usedPercent);
        if (used == null || used <= worstUsed) continue;
        worst = window;
        worstUsed = used;
      }
      const aggregate = clampPercent(data.usedPercent);
      if (aggregate == null && !worst) return [];
      return [metric('quota', 'All models', {
        usedPercent: aggregate ?? worstUsed,
        resetsAt: worst?.resetsAt
      })].filter(Boolean);
    }
    return [];
  }

  const SPEND_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode', 'muse'];
  // Providers that report spend but publish no limit windows, so their card is spend-only.
  const SPEND_ONLY_PROVIDERS = SPEND_PROVIDERS.filter(id => !(STATIC_METRICS[id] || []).length);
  const SPEND_ROWS = [
    { id: 'today', label: 'Today', kind: 'spend', placement: 'demand' },
    { id: 'yesterday', label: 'Yesterday', kind: 'spend', placement: 'demand' },
    { id: 'last30', label: 'Last 30 Days', kind: 'spend', placement: 'demand' },
    { id: 'trend', label: 'Usage Trend', kind: 'trend', placement: 'always' }
  ];

  function metricCatalog(provider, data) {
    const known = STATIC_METRICS[provider] || [];
    const live = metricsForProvider(provider, data).map(({ id, label }) => ({ id, label }));
    const catalog = known.map(entry => live.find(item => item.id === entry.id) || entry);
    for (const item of live) if (!catalog.some(entry => entry.id === item.id)) catalog.push(item);
    const quota = catalog.map(item => ({ ...item, kind: 'quota', placement: 'always' }));
    return SPEND_PROVIDERS.includes(provider) ? [...quota, ...SPEND_ROWS.map(row => ({ ...row }))] : quota;
  }

  function placementFor(key, catalogEntry, settings = {}) {
    return settings.placements?.[key] || catalogEntry?.placement || 'always';
  }

  function starredFor(provider, quotaMetrics, settings = {}) {
    const hidden = new Set(settings.hiddenMetrics || []);
    const visible = quotaMetrics.filter(m => !hidden.has(metricKey(provider, m.id)));
    const keys = (settings.starredMetrics || []).filter(key => key.startsWith(`${provider}:`));
    const starred = keys.map(key => visible.find(m => metricKey(provider, m.id) === key)).filter(Boolean);
    return starred.length ? starred : visible.slice(0, 2);
  }

  function isStarred(provider, metricId, quotaMetrics, settings) {
    return starredFor(provider, quotaMetrics, settings).some(m => m.id === metricId);
  }

  function visibleIds(settings = {}) {
    return (settings.providerOrder || Object.keys(PROVIDER_META)).filter(id => {
      const key = `show${id[0].toUpperCase()}${id.slice(1)}`;
      return settings[key] !== false;
    });
  }

  function quotaEntries(providers = {}, settings = {}, nowSec = Date.now() / 1000) {
    const hiddenProviders = new Set(settings.taskbarHiddenProviders || []);
    const out = [];
    for (const provider of visibleIds(settings)) {
      if (hiddenProviders.has(provider)) continue;
      const metrics = metricsForProvider(provider, providers[provider]?.data);
      const starred = starredFor(provider, metrics, settings);
      if (!starred.length) continue;
      out.push({
        provider,
        metrics: starred.map(m => ({ key: metricKey(provider, m.id), metric: m, pace: computePace(m, nowSec) }))
      });
    }
    return out;
  }

  const TONE_ORDER = { ok: 0, warn: 1, danger: 2 };

  // The taskbar strip leads with today's usage: a provider that burned tokens today shows how
  // many, still tinted by its most urgent limit meter. Providers without token usage today only
  // keep a slot while one of their limits is actually running low.
  function stripEntries(providers = {}, settings = {}, nowSec = Date.now() / 1000, spend = {}) {
    const hiddenProviders = new Set(settings.taskbarHiddenProviders || []);
    const out = [];
    for (const provider of visibleIds(settings)) {
      if (hiddenProviders.has(provider)) continue;
      const metrics = metricsForProvider(provider, providers[provider]?.data);
      const starred = starredFor(provider, metrics, settings);
      const paces = starred.map(m => computePace(m, nowSec));
      const worst = paces.reduce((worst, pace) => pace && (TONE_ORDER[pace.tone] || 0) > (TONE_ORDER[worst?.tone] || 0) ? pace : worst, null);
      const today = spend?.[provider]?.summary?.today;
      if (today && today.tokens > 0) {
        out.push({
          provider,
          metrics: [{
            key: metricKey(provider, 'today'),
            metric: { id: 'today', label: 'Today', display: 'tokens', valueText: formatTokens(today.tokens) },
            pace: worst
          }]
        });
        continue;
      }
      if (!starred.length || !worst || worst.tone === 'ok') continue;
      out.push({ provider, metrics: starred.map((m, i) => ({ key: metricKey(provider, m.id), metric: m, pace: paces[i] })) });
    }
    return out;
  }

  function formatMoney(value) {
    const n = Number(value) || 0;
    if (n >= 1000) {
      const k = n / 1000;
      return `$${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
    }
    if (n >= 100) return `$${Math.round(n)}`;
    return `$${n.toFixed(2)}`;
  }

  function formatMoneyExact(value) {
    return `$${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatTokens(value) {
    const n = Number(value) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(Math.round(n));
  }

  function spendRate(period) {
    return period && period.tokens ? period.cost / (period.tokens / 1e6) : 0;
  }

  function spendValue(period, metric = 'cost') {
    if (!period) return 0;
    if (metric === 'tokens') return period.tokens;
    if (metric === 'rate') return spendRate(period);
    return period.cost;
  }

  function formatSpendValue(value, metric = 'cost', exact = false) {
    if (metric === 'tokens') return exact ? `${Math.round(value).toLocaleString()} tokens` : formatTokens(value);
    if (metric === 'rate') return `$${(Number(value) || 0).toFixed(2)}${exact ? ' per million tokens' : ''}`;
    return exact ? formatMoneyExact(value) : formatMoney(value);
  }

  function spendUnit(metric = 'cost') {
    if (metric === 'tokens') return 'tokens';
    if (metric === 'rate') return 'per MTok';
    return 'dollars';
  }

  function formatSpendRow(period) {
    if (!period) return 'No usage';
    return `${formatMoney(period.cost)} · ${formatTokens(period.tokens)} tokens`;
  }

  function totalSpend(spend = {}, settings = {}, period = 'last30', metric = 'cost') {
    const slices = [];
    let cost = 0;
    let tokens = 0;
    for (const provider of visibleIds(settings)) {
      const summary = spend[provider]?.summary;
      if (!summary) continue;
      const entry = summary[period];
      if (!entry) continue;
      cost += entry.cost;
      tokens += entry.tokens;
      slices.push({ provider, period: entry, value: spendValue(entry, metric) });
    }
    if (metric !== 'rate') slices.sort((a, b) => b.value - a.value);
    else slices.sort((a, b) => b.period.cost - a.period.cost);
    const total = { cost, tokens };
    return { slices, total, value: spendValue(total, metric) };
  }

  function metricKey(provider, metricId) {
    return `${provider}:${metricId}`;
  }

  function computePace(m, nowSec = Date.now() / 1000) {
    const used = clampPercent(m?.usedPercent);
    if (used == null) return null;
    const base = { tone: 'ok', verdict: 'ok', projectedUsed: null, evenPace: null, runOutAt: null };
    if (used >= 99.5) return { ...base, tone: 'danger', verdict: 'reached', projectedUsed: 100 };

    const windowSec = m.windowMins ? m.windowMins * 60 : null;
    const elapsed = windowSec && m.resetsAt ? windowSec - (m.resetsAt - nowSec) : null;
    const fraction = elapsed == null ? null : elapsed / windowSec;
    if (fraction == null || fraction < MIN_ELAPSED_FRACTION || fraction > 1 || used <= 0) {
      if (100 - used <= 10) return { ...base, tone: 'danger', verdict: 'low' };
      if (used >= 80) return { ...base, tone: 'warn', verdict: 'low' };
      return { ...base, evenPace: fraction != null && fraction > 0 && fraction <= 1 ? fraction * 100 : null };
    }

    const projectedUsed = used / fraction;
    const evenPace = fraction * 100;
    if (projectedUsed > 100.5) {
      const rate = used / elapsed;
      return {
        ...base,
        tone: 'danger',
        verdict: 'over',
        projectedUsed,
        evenPace,
        runOutAt: nowSec + (100 - used) / rate
      };
    }
    if (projectedUsed >= 99) return { ...base, tone: 'danger', verdict: 'at-limit', projectedUsed, evenPace };
    if (100 - projectedUsed < TIGHT_SPARE_PERCENT) {
      return { ...base, tone: 'warn', verdict: 'tight', projectedUsed, evenPace };
    }
    return { ...base, projectedUsed, evenPace };
  }

  function formatPercent(value) {
    const n = Math.round(Number(value));
    return `${Number.isFinite(n) ? n : 0}%`;
  }

  function formatValue(m, mode = 'left') {
    if (m?.display === 'tokens') return m.valueText ? `${m.valueText} tokens today` : '';
    const used = clampPercent(m?.usedPercent) ?? 0;
    return mode === 'used' ? `${formatPercent(used)} used` : `${formatPercent(100 - used)} left`;
  }

  function displayPercent(m, mode = 'left') {
    const used = clampPercent(m?.usedPercent) ?? 0;
    return mode === 'used' ? used : 100 - used;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
    if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes) return `${minutes}m`;
    return '<1m';
  }

  function hour12For(clock) {
    if (clock === '12h') return true;
    if (clock === '24h') return false;
    return undefined;
  }

  function formatClock(epochSec, nowSec, clock = 'system') {
    const date = new Date(epochSec * 1000);
    const now = new Date(nowSec * 1000);
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: hour12For(clock) });
    const dayDiff = Math.round(
      (new Date(date.getFullYear(), date.getMonth(), date.getDate()) -
        new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
    );
    if (dayDiff === 0) return `today at ${time}`;
    if (dayDiff === 1) return `tomorrow at ${time}`;
    if (dayDiff > 1 && dayDiff < 7) {
      return `${date.toLocaleDateString(undefined, { weekday: 'short' })} at ${time}`;
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatReset(resetsAt, mode = 'relative', nowSec = Date.now() / 1000, clock = 'system') {
    if (!resetsAt) return '';
    if (resetsAt - nowSec <= 0) return 'Resets now';
    if (mode === 'absolute') return `Resets ${formatClock(resetsAt, nowSec, clock)}`;
    return `Resets in ${formatDuration(resetsAt - nowSec)}`;
  }

  function formatPaceNote(pace, mode = 'relative', nowSec = Date.now() / 1000, clock = 'system') {
    if (!pace) return '';
    if (pace.verdict === 'reached') return 'Limit reached';
    if (pace.verdict === 'over' && pace.runOutAt) {
      return mode === 'absolute'
        ? `Limit ${formatClock(pace.runOutAt, nowSec, clock)}`
        : `Limit in ${formatDuration(pace.runOutAt - nowSec)}`;
    }
    if (pace.verdict === 'at-limit') return 'At limit by reset';
    if (pace.verdict === 'tight') return `~${Math.max(1, Math.round(100 - pace.projectedUsed))}% spare`;
    if (pace.verdict === 'ok' && pace.projectedUsed != null) {
      return `~${Math.round(100 - pace.projectedUsed)}% left at reset`;
    }
    return '';
  }

  function formatPaceDetail(pace) {
    if (!pace || pace.projectedUsed == null) return '';
    if (pace.verdict === 'reached') return 'Limit reached';
    if (pace.projectedUsed > 100) return `~${Math.round(pace.projectedUsed - 100)}% over limit at reset`;
    if (pace.verdict === 'tight' || pace.verdict === 'at-limit') {
      return `~${Math.round(pace.projectedUsed)}% used at reset`;
    }
    return `~${Math.round(100 - pace.projectedUsed)}% left at reset`;
  }

  function formatAgo(ms, nowMs = Date.now()) {
    if (!ms) return '';
    const seconds = Math.max(0, (nowMs - ms) / 1000);
    if (seconds < 45) return 'just now';
    return `${formatDuration(seconds)} ago`;
  }

  function trayMetrics(providers = {}, settings = {}, nowSec = Date.now() / 1000) {
    const groups = quotaEntries(providers, { ...settings, taskbarHiddenProviders: [] }, nowSec);
    const all = groups.flatMap(group => group.metrics.map(entry => ({ ...entry, provider: group.provider })));
    const starred = new Set(settings.starredMetrics || []);
    const explicit = all.filter(entry => starred.has(entry.key));
    return (explicit.length ? explicit : all.sort((a, b) => b.metric.usedPercent - a.metric.usedPercent)).slice(0, 2);
  }

  function trayTooltip(entries, mode = 'left') {
    if (!entries.length) return 'Throttle';
    const lines = entries.map(entry =>
      `${PROVIDER_META[entry.provider]?.name || entry.provider} ${entry.metric.label}: ${formatValue(entry.metric, mode)}`
    );
    return ['Throttle', ...lines].join('\n').slice(0, 127);
  }

  return {
    PROVIDER_META,
    clampPercent,
    metricsForProvider,
    metricCatalog,
    metricKey,
    SPEND_PROVIDERS,
    SPEND_ONLY_PROVIDERS,
    placementFor,
    starredFor,
    isStarred,
    visibleIds,
    stripEntries,
    formatMoney,
    formatMoneyExact,
    formatTokens,
    spendValue,
    formatSpendValue,
    spendUnit,
    formatSpendRow,
    totalSpend,
    computePace,
    formatValue,
    displayPercent,
    formatDuration,
    formatReset,
    formatPaceNote,
    formatPaceDetail,
    formatAgo,
    trayMetrics,
    trayTooltip
  };
});
