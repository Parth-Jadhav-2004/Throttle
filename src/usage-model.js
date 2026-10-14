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
    antigravity: []
  };

  function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quota';
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
      const seen = new Set();
      return (data.windows || []).map(window => {
        const label = window.label || window.group || 'Quota';
        let id = slug(label);
        while (seen.has(id)) id += '-2';
        seen.add(id);
        return metric(id, label, window);
      }).filter(Boolean);
    }
    return [];
  }

  function metricCatalog(provider, data) {
    const known = STATIC_METRICS[provider] || [];
    const live = metricsForProvider(provider, data).map(({ id, label }) => ({ id, label }));
    const catalog = known.map(entry => live.find(item => item.id === entry.id) || entry);
    for (const item of live) if (!catalog.some(entry => entry.id === item.id)) catalog.push(item);
    return catalog;
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
    const visible = (settings.providerOrder || Object.keys(PROVIDER_META)).filter(id => {
      const key = `show${id[0].toUpperCase()}${id.slice(1)}`;
      return settings[key] !== false;
    });
    const hidden = new Set(settings.hiddenMetrics || []);
    const all = [];
    for (const provider of visible) {
      for (const m of metricsForProvider(provider, providers[provider]?.data)) {
        const key = metricKey(provider, m.id);
        if (hidden.has(key)) continue;
        all.push({ key, provider, metric: m, pace: computePace(m, nowSec) });
      }
    }
    const starred = (settings.starredMetrics || [])
      .map(key => all.find(entry => entry.key === key))
      .filter(Boolean);
    if (starred.length) return starred;
    return all.sort((a, b) => b.metric.usedPercent - a.metric.usedPercent).slice(0, 2);
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
