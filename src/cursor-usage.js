const MONTHLY_MINS = 30 * 1440;
const REQUEST_BUCKET_KEYS = ['gpt-4', 'gpt-4o', 'default'];

function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function toEpochSeconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /T/.test(value) && !/^\d+$/.test(value.trim())) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function cycleWindowMins(start, end) {
  if (start == null || end == null || end <= start) return MONTHLY_MINS;
  return Math.max(1, Math.round((end - start) / 60));
}

function percentWindow(usedPercent, resetsAt, windowDurationMins) {
  const used = clampPercent(usedPercent);
  return {
    usedPercent: used,
    remainingPercent: 100 - used,
    windowDurationMins: Number(windowDurationMins) || MONTHLY_MINS,
    resetsAt: toEpochSeconds(resetsAt)
  };
}

function formatCentsLeft(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const dollars = Math.max(0, n) / 100;
  if (dollars >= 100) return `$${Math.round(dollars)} left`;
  if (dollars >= 10) return `$${dollars.toFixed(0)} left`;
  return `$${dollars.toFixed(2)} left`;
}

function formatRequestsLeft(remaining) {
  const n = Number(remaining);
  if (!Number.isFinite(n)) return null;
  return `${Math.max(0, Math.round(n))} left`;
}

function isFreePlan(planType) {
  return ['free', 'hobby'].includes(String(planType || '').toLowerCase());
}

function planNameFrom(planInfo, membershipType) {
  const name = planInfo?.planInfo?.planName || planInfo?.planName || membershipType || null;
  return name ? String(name) : null;
}

function pickRequestBucket(usage) {
  if (!usage || typeof usage !== 'object') return null;
  for (const key of REQUEST_BUCKET_KEYS) {
    const bucket = usage[key];
    if (bucket && Number(bucket.maxRequestUsage) > 0) return bucket;
  }
  let best = null;
  for (const [key, bucket] of Object.entries(usage)) {
    if (key === 'startOfMonth' || !bucket || typeof bucket !== 'object') continue;
    const max = Number(bucket.maxRequestUsage);
    if (!Number.isFinite(max) || max <= 0) continue;
    if (!best || max > Number(best.maxRequestUsage)) best = bucket;
  }
  return best;
}

function monthAfter(epochSeconds) {
  if (epochSeconds == null) return null;
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMonth(date.getUTCMonth() + 1);
  return Math.floor(date.getTime() / 1000);
}

function normalizeCursorUsage({ usage, planInfo, membershipType, requestUsage } = {}) {
  const planType = planNameFrom(planInfo, membershipType);
  const isFree = isFreePlan(planType);
  const planUsage = usage?.planUsage;

  if (planUsage) {
    const start = toEpochSeconds(usage.billingCycleStart);
    const end = toEpochSeconds(usage.billingCycleEnd || planInfo?.planInfo?.billingCycleEnd);
    const mins = cycleWindowMins(start, end);
    const limitCents = Number(planUsage.limit) || Number(planInfo?.planInfo?.includedAmountCents) || 0;
    const includedSpend = Number(planUsage.includedSpend);
    const remainingCents = Number.isFinite(Number(planUsage.remaining))
      ? Number(planUsage.remaining)
      : (limitCents > 0 && Number.isFinite(includedSpend) ? Math.max(0, limitCents - includedSpend) : null);
    const totalPercent = Number.isFinite(Number(planUsage.totalPercentUsed))
      ? Number(planUsage.totalPercentUsed)
      : (limitCents > 0 && Number.isFinite(includedSpend) ? (includedSpend / limitCents) * 100 : 0);
    // Cursor Models (Composer/Grok) and Other Models are separate pools.
    // totalPercentUsed is a blended spend figure and does not match the dashboard bars.
    const cursorModelsPercent = Number.isFinite(Number(planUsage.autoPercentUsed))
      ? Number(planUsage.autoPercentUsed)
      : totalPercent;
    const api = Number.isFinite(Number(planUsage.apiPercentUsed))
      ? percentWindow(planUsage.apiPercentUsed, end, mins)
      : null;

    const included = percentWindow(cursorModelsPercent, end, mins);
    return {
      planType,
      included,
      api,
      remainingLabel: remainingCents > 0
        ? formatCentsLeft(remainingCents)
        : `${Math.round(included.remainingPercent)}% left`,
      isFree,
      layout: api ? 'included-api' : 'included'
    };
  }

  const bucket = pickRequestBucket(requestUsage);
  if (bucket) {
    const max = Number(bucket.maxRequestUsage);
    const used = Number(bucket.numRequests) || 0;
    const start = toEpochSeconds(requestUsage.startOfMonth);
    return {
      planType,
      included: percentWindow(max > 0 ? (used / max) * 100 : 0, monthAfter(start), MONTHLY_MINS),
      api: null,
      remainingLabel: formatRequestsLeft(max - used),
      isFree,
      layout: 'requests'
    };
  }

  return {
    planType,
    included: null,
    api: null,
    remainingLabel: null,
    isFree,
    layout: 'included'
  };
}

module.exports = {
  normalizeCursorUsage,
  toEpochSeconds,
  formatCentsLeft,
  isFreePlan
};
