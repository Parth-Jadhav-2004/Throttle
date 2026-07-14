function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function normalizeWindow(window) {
  if (!window || !Number.isFinite(Number(window.windowDurationMins))) return null;
  const usedPercent = clampPercent(window.usedPercent);
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowDurationMins: Number(window.windowDurationMins),
    resetsAt: Number.isFinite(Number(window.resetsAt)) ? Number(window.resetsAt) : null
  };
}

function normalizeRateLimits(payload) {
  const bucket = payload?.rateLimitsByLimitId?.codex || payload?.rateLimits || null;
  if (!bucket) return { planType: null, fiveHour: null, weekly: null };
  const windows = [normalizeWindow(bucket.primary), normalizeWindow(bucket.secondary)].filter(Boolean);
  const fiveHour = windows.find(w => w.windowDurationMins === 300) || null;
  const weekly = windows.find(w => w.windowDurationMins === 10080) || null;
  return { planType: bucket.planType || null, fiveHour, weekly };
}

function formatResetTime(resetsAt, nowSeconds = Date.now() / 1000) {
  if (resetsAt == null || !Number.isFinite(Number(resetsAt))) return 'unknown';
  const seconds = Math.max(0, Math.ceil(Number(resetsAt) - nowSeconds));
  if (seconds === 0) return 'now';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function mergeRateLimitSnapshot(previous = {}, update = {}) {
  const merge = (oldValue, newValue) => {
    if (newValue == null) return oldValue;
    if (typeof oldValue === 'object' && oldValue && !Array.isArray(oldValue) && typeof newValue === 'object' && !Array.isArray(newValue)) {
      const result = { ...oldValue };
      for (const [key, value] of Object.entries(newValue)) result[key] = merge(oldValue[key], value);
      return result;
    }
    return newValue;
  };
  return merge(previous, update);
}

module.exports = { normalizeRateLimits, formatResetTime, mergeRateLimitSnapshot };
