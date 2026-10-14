const test = require('node:test');
const assert = require('node:assert/strict');
const {
  usageColor,
  formatResetLabel,
  limitsForProvider
} = require('../src/usage-tooltip');

test('maps usage percentages to green, yellow, and orange', () => {
  assert.equal(usageColor(21), '#22c55e');
  assert.equal(usageColor(52), '#eab308');
  assert.equal(usageColor(73), '#f97316');
  assert.equal(usageColor(null), '#ffffff');
});

test('formats short and long reset labels', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  assert.equal(formatResetLabel(now / 1000 + 51 * 60, now), 'Resets in 51 min');
  assert.equal(formatResetLabel(now / 1000 + 3 * 86400, now), 'Resets in 3d 0h');
  assert.match(formatResetLabel(now / 1000 + 10 * 86400, now), /^Resets /);
});

test('builds provider-specific limit rows', () => {
  assert.deepEqual(limitsForProvider('claude', {
    fiveHour: { usedPercent: 73, resetsAt: 1000 },
    weekly: { usedPercent: 7, resetsAt: 2000 }
  }), [
    { label: 'Current session', usedPercent: 73, resetsAt: 1000, primary: true },
    { label: 'All models', usedPercent: 7, resetsAt: 2000, primary: false }
  ]);
  assert.deepEqual(limitsForProvider('cursor', {
    layout: 'included-api',
    included: { usedPercent: 40, resetsAt: 1000 },
    api: { usedPercent: 12, resetsAt: 1000 }
  }), [
    { label: 'Cursor Models', usedPercent: 40, resetsAt: 1000, primary: true },
    { label: 'Other Models', usedPercent: 12, resetsAt: 1000, primary: false }
  ]);
  assert.deepEqual(limitsForProvider('codex', {
    isFree: false,
    fiveHour: { usedPercent: 24, resetsAt: 1000 },
    weekly: { usedPercent: 61, resetsAt: 2000 }
  }), [
    { label: '5-hour limit', usedPercent: 24, resetsAt: 1000, primary: true },
    { label: 'Weekly limit', usedPercent: 61, resetsAt: 2000, primary: false }
  ]);
});
