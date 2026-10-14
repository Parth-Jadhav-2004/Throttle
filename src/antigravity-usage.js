const { toEpochSeconds } = require('./cursor-usage');

function clampFraction(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
}

function normalizeBucket(group, bucket) {
  const remaining = clampFraction(bucket?.remainingFraction);
  const reportedUsed = clampFraction(bucket?.usedFraction);
  const used = bucket?.available === true
    ? 0
    : (reportedUsed ?? (remaining == null ? null : 1 - remaining));
  if (used == null) return null;
  return {
    group: group?.name || 'Models',
    kind: bucket?.kind || null,
    label: bucket?.label || null,
    usedPercent: used * 100,
    remainingPercent: 100 - used * 100,
    resetsAt: toEpochSeconds(bucket?.resetAt)
  };
}

function normalizeAntigravityUsage(snapshot = {}) {
  const windows = [];
  for (const group of snapshot.groups || []) {
    for (const bucket of group.buckets || []) {
      const normalized = normalizeBucket(group, bucket);
      if (normalized) windows.push(normalized);
    }
  }
  const usedPercent = windows.length
    ? Math.max(...windows.map(window => window.usedPercent))
    : null;
  return {
    planType: snapshot.tier || null,
    account: snapshot.account || null,
    source: snapshot.source || null,
    usedPercent,
    windows
  };
}

module.exports = { normalizeAntigravityUsage };
