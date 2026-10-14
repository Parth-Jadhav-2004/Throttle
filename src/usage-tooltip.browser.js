(function () {
  function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  }

  const PROVIDER_TITLES = {
    claude: 'Claude Usage',
    cursor: 'Cursor Usage',
    codex: 'Codex Usage',
    antigravity: 'Antigravity Usage'
  };

  function usageColor(percent) {
    if (percent == null || !Number.isFinite(Number(percent))) return '#ffffff';
    const value = clampPercent(percent);
    if (value == null) return '#ffffff';
    if (value >= 70) return '#f97316';
    if (value >= 50) return '#eab308';
    return '#22c55e';
  }

  function formatResetLabel(resetsAt, nowMs = Date.now()) {
    if (resetsAt == null || !Number.isFinite(Number(resetsAt))) return '';
    const resetMs = Number(resetsAt) * 1000;
    const diffSec = Math.max(0, Math.ceil((resetMs - nowMs) / 1000));
    if (diffSec === 0) return 'Resets now';
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    if (days >= 7) {
      const formatted = new Date(resetMs).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      return `Resets ${formatted}`;
    }
    if (days) return `Resets in ${days}d ${hours}h`;
    if (hours) return `Resets in ${hours}h ${minutes}m`;
    return `Resets in ${minutes} min`;
  }

  function limitRow(label, window, primary = false) {
    if (!window || clampPercent(window.usedPercent) == null) return null;
    return {
      label,
      usedPercent: clampPercent(window.usedPercent),
      resetsAt: window.resetsAt ?? null,
      primary
    };
  }

  function limitsForProvider(provider, data) {
    if (!data) return [];
    if (provider === 'claude') {
      return [
        limitRow('Current session', data.fiveHour, true),
        limitRow('All models', data.weekly, false)
      ].filter(Boolean);
    }
    if (provider === 'cursor') {
    const includedLabel = data.layout === 'requests' ? 'Fast requests' : 'Cursor Models';
    return [
      limitRow(includedLabel, data.included, true),
      limitRow('Other Models', data.api, false)
    ].filter(Boolean);
    }
    if (provider === 'codex') {
      if (data.isFree) {
        return [limitRow('Monthly limit', data.monthly, true)].filter(Boolean);
      }
      return [
        limitRow('5-hour limit', data.fiveHour, true),
        limitRow('Weekly limit', data.weekly, false)
      ].filter(Boolean);
    }
    if (provider === 'antigravity') {
      return (data.windows || []).slice(0, 2).map((window, index) => limitRow(
        window.label || window.group || 'Quota',
        window,
        index === 0
      )).filter(Boolean);
    }
    return [];
  }

  window.usageUi = {
    PROVIDER_TITLES,
    usageColor,
    formatResetLabel,
    limitsForProvider
  };
})();
