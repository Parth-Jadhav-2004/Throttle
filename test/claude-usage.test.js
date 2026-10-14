const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClaudeUsage, prettifyTier } = require('../src/claude-usage');

test('maps five-hour and weekly utilization from the OAuth usage payload', () => {
  const result = normalizeClaudeUsage({
    five_hour: { utilization: 34, resets_at: '2026-02-06T22:00:00+00:00' },
    seven_day: { utilization: 12, resets_at: '2026-02-12T20:00:00+00:00' }
  }, { rateLimitTier: 'default_claude_max_5x' });
  assert.equal(result.planType, 'max 5x');
  assert.equal(result.fiveHour.usedPercent, 34);
  assert.equal(result.fiveHour.remainingPercent, 66);
  assert.equal(result.weekly.usedPercent, 12);
  assert.equal(result.fiveHour.resetsAt, Date.parse('2026-02-06T22:00:00+00:00') / 1000);
});

test('falls back to the structured limits array when flat windows are missing', () => {
  const result = normalizeClaudeUsage({
    limits: [
      { kind: 'session', percent: 41, resets_at: '2026-08-31T18:00:00Z' },
      { kind: 'weekly_all', percent: 9, resets_at: '2026-09-06T18:00:00Z' }
    ]
  });
  assert.equal(result.fiveHour.usedPercent, 41);
  assert.equal(result.weekly.usedPercent, 9);
});

test('returns empty windows rather than inventing usage', () => {
  const result = normalizeClaudeUsage({});
  assert.equal(result.fiveHour, null);
  assert.equal(result.weekly, null);
  assert.equal(prettifyTier('default_claude_max_20x'), 'max 20x');
});
