function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function usedFromWindow(window) {
  if (!window || typeof window !== 'object') return null;
  return clampPercent(window.usedPercent ?? window.utilization ?? window.percent);
}

function maxUsedPercent(...windows) {
  const values = windows.map(usedFromWindow).filter(value => value != null);
  return values.length ? Math.max(...values) : null;
}

function usedPercentForProvider(provider, data) {
  if (!data) return null;
  if (provider === 'antigravity') return clampPercent(data.usedPercent);
  if (provider === 'cursor') return usedFromWindow(data.included);
  if (provider === 'claude') return maxUsedPercent(data.fiveHour, data.weekly);
  if (data.isFree) return usedFromWindow(data.monthly);
  return maxUsedPercent(data.fiveHour, data.weekly, data.monthly);
}

module.exports = { clampPercent, maxUsedPercent, usedPercentForProvider };
