const { toEpochSeconds } = require('./cursor-usage');
const { clampPercent } = require('./usage-display');

function percentWindow(usedPercent, resetsAt) {
  const used = clampPercent(usedPercent);
  if (used == null) return null;
  return {
    usedPercent: used,
    remainingPercent: 100 - used,
    resetsAt: toEpochSeconds(resetsAt)
  };
}

function windowFrom(value) {
  if (!value || typeof value !== 'object') return null;
  return percentWindow(
    value.utilization ?? value.percent ?? value.usedPercent,
    value.resets_at ?? value.resetsAt
  );
}

function findLimit(limits, kind) {
  if (!Array.isArray(limits)) return null;
  return limits.find(entry => entry && entry.kind === kind) || null;
}

function prettifyTier(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  return text.replace(/^default_/, '').replace(/^claude_/, '').replace(/_/g, ' ');
}

function normalizeClaudeUsage(payload = {}, plan = {}) {
  const fiveHour = windowFrom(payload.five_hour) || windowFrom(findLimit(payload.limits, 'session'));
  const weekly = windowFrom(payload.seven_day) || windowFrom(findLimit(payload.limits, 'weekly_all'));
  const planType = prettifyTier(plan.rateLimitTier || plan.subscriptionType || payload.rate_limit_tier);
  if (!fiveHour && !weekly) {
    return { planType, fiveHour: null, weekly: null };
  }
  return { planType, fiveHour, weekly };
}

module.exports = { normalizeClaudeUsage, prettifyTier };
