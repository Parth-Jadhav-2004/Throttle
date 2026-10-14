const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAntigravityUsage } = require('../src/antigravity-usage');

test('normalizes Antigravity quota groups and uses the most consumed window', () => {
  const result = normalizeAntigravityUsage({
    account: 'dev@example.com',
    tier: 'Google AI Pro',
    source: 'api',
    groups: [
      {
        name: 'Gemini models',
        buckets: [
          {
            kind: 'weekly',
            remainingFraction: 0.92,
            usedFraction: 0.08,
            resetAt: '2026-09-06T18:00:00Z'
          },
          {
            kind: '5h',
            remainingFraction: 0.4,
            usedFraction: 0.6,
            resetAt: '2026-08-31T18:00:00Z'
          }
        ]
      }
    ]
  });

  assert.equal(result.planType, 'Google AI Pro');
  assert.equal(result.account, 'dev@example.com');
  assert.equal(result.usedPercent, 60);
  assert.equal(result.windows[0].usedPercent, 8);
  assert.equal(result.windows[1].remainingPercent, 40);
  assert.equal(
    result.windows[1].resetsAt,
    Date.parse('2026-08-31T18:00:00Z') / 1000
  );
});

test('treats an available bucket as zero used and preserves missing usage', () => {
  assert.equal(normalizeAntigravityUsage({
    groups: [{ name: 'Models', buckets: [{ available: true }] }]
  }).usedPercent, 0);
  assert.equal(normalizeAntigravityUsage({ groups: [] }).usedPercent, null);
});
