const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRateLimits, formatResetTime } = require('../src/rate-limits');

test('classifies five-hour and weekly windows by duration regardless of primary order', () => {
  const payload = { rateLimits: { planType: 'plus', primary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 2000 }, secondary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1500 } } };
  const result = normalizeRateLimits(payload, 1000);
  assert.equal(result.planType, 'plus');
  assert.deepEqual(result.fiveHour, { usedPercent: 24, remainingPercent: 76, windowDurationMins: 300, resetsAt: 1500 });
  assert.equal(result.weekly.remainingPercent, 39);
});

test('supports the multi-bucket codex response and missing five-hour data', () => {
  const payload = { rateLimitsByLimitId: { codex: { planType: 'pro', primary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 9000 }, secondary: null } } };
  const result = normalizeRateLimits(payload, 1000);
  assert.equal(result.fiveHour, null);
  assert.equal(result.weekly.usedPercent, 7);
});

test('clamps malformed percentages and ignores unknown null windows', () => {
  const result = normalizeRateLimits({ rateLimits: { primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: null }, secondary: null } }, 1000);
  assert.equal(result.fiveHour.usedPercent, 100);
  assert.equal(result.fiveHour.remainingPercent, 0);
  assert.equal(result.weekly, null);
});

test('formats reset timestamps as a useful relative duration', () => {
  assert.equal(formatResetTime(4600, 1000), '1h 0m');
  assert.equal(formatResetTime(1000, 1000), 'now');
  assert.equal(formatResetTime(null, 1000), 'unknown');
});

test('merges sparse live notifications into the last full snapshot', () => {
  const { mergeRateLimitSnapshot } = require('../src/rate-limits');
  const previous = {
    planType: 'plus',
    primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 2000 },
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 9000 }
  };
  const update = { primary: { usedPercent: 25, windowDurationMins: null, resetsAt: null }, planType: null };
  assert.deepEqual(mergeRateLimitSnapshot(previous, update), {
    planType: 'plus',
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000 },
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 9000 }
  });
});
