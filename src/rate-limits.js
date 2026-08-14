const FIVE_HOUR_MINS = 300;
const WEEKLY_MINS = 10080; // 7 days
const MONTHLY_MIN_MINS = 28 * 1440; // 28 days

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

function windowKind(window) {
  if (!window) return null;
  if (window.windowDurationMins === FIVE_HOUR_MINS) return 'fiveHour';
  if (window.windowDurationMins === WEEKLY_MINS) return 'weekly';
  if (window.windowDurationMins >= MONTHLY_MIN_MINS) return 'monthly';
  return null;
}

function isFreePlan(planType) {
  return String(planType || '').toLowerCase() === 'free';
}

function collectWindows(bucket) {
  if (!bucket || typeof bucket !== 'object') return [];
  return Object.values(bucket).map(normalizeWindow).filter(Boolean);
}

function normalizeRateLimits(payload) {
  const bucket = payload?.rateLimitsByLimitId?.codex || payload?.rateLimits || null;
  if (!bucket) return { planType: null, fiveHour: null, weekly: null, monthly: null, isFree: false };
  const windows = collectWindows(bucket);
  const find = kind => windows.find(window => windowKind(window) === kind) || null;
  const planType = bucket.planType || null;
  return {
    planType,
    fiveHour: find('fiveHour'),
    weekly: find('weekly'),
    monthly: find('monthly'),
    isFree: isFreePlan(planType)
  };
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

module.exports = { normalizeRateLimits, formatResetTime, mergeRateLimitSnapshot, isFreePlan };
