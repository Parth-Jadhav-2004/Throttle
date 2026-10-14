const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCursorUsage,
  toEpochSeconds,
  formatCentsLeft
} = require('../src/cursor-usage');

test('converts millisecond cycle timestamps and compact remaining dollars', () => {
  assert.equal(toEpochSeconds('1771077734000'), 1771077734);
  assert.equal(toEpochSeconds('2026-03-01T00:00:00.000Z'), Date.parse('2026-03-01T00:00:00.000Z') / 1000);
  assert.equal(formatCentsLeft(16778), '$168 left');
  assert.equal(formatCentsLeft(850), '$8.50 left');
  assert.equal(formatCentsLeft(2400), '$24 left');
});

test('maps Cursor Models and Other Models from the dashboard pools', () => {
  const result = normalizeCursorUsage({
    membershipType: 'pro',
    planInfo: { planInfo: { planName: 'Pro', includedAmountCents: 40000 } },
    usage: {
      billingCycleStart: '1768399334000',
      billingCycleEnd: '1771077734000',
      planUsage: {
        includedSpend: 23222,
        remaining: 16778,
        limit: 40000,
        autoPercentUsed: 13.2,
        apiPercentUsed: 100,
        totalPercentUsed: 17.4
      }
    }
  });
  assert.equal(result.planType, 'Pro');
  assert.equal(result.layout, 'included-api');
  assert.equal(result.remainingLabel, '$168 left');
  assert.equal(result.included.usedPercent, 13.2);
  assert.equal(result.included.remainingPercent, 86.8);
  assert.equal(result.included.resetsAt, 1771077734);
  assert.equal(result.api.usedPercent, 100);
  assert.equal(result.api.remainingPercent, 0);
});

test('fills a missing limit from plan info and hides the API tile', () => {
  const result = normalizeCursorUsage({
    planInfo: { planInfo: { planName: 'Ultra', includedAmountCents: 40000, billingCycleEnd: '1771077734000' } },
    usage: {
      billingCycleStart: '1768399334000',
      planUsage: { includedSpend: 10000, totalPercentUsed: 25 }
    }
  });
  assert.equal(result.planType, 'Ultra');
  assert.equal(result.layout, 'included');
  assert.equal(result.api, null);
  assert.equal(result.remainingLabel, '$300 left');
  assert.equal(result.included.usedPercent, 25);
});

test('falls back to request buckets for enterprise-style usage', () => {
  const result = normalizeCursorUsage({
    membershipType: 'enterprise',
    requestUsage: {
      'gpt-4': { numRequests: 150, maxRequestUsage: 500 },
      startOfMonth: '2026-03-01T00:00:00.000Z'
    }
  });
  assert.equal(result.layout, 'requests');
  assert.equal(result.remainingLabel, '350 left');
  assert.equal(result.included.usedPercent, 30);
  assert.equal(result.included.remainingPercent, 70);
  assert.equal(result.included.resetsAt, Date.parse('2026-04-01T00:00:00.000Z') / 1000);
});

test('uses remaining percent when included spend is exhausted', () => {
  const result = normalizeCursorUsage({
    planInfo: { planInfo: { planName: 'Pro' } },
    usage: {
      billingCycleEnd: '1771077734000',
      planUsage: {
        includedSpend: 20000,
        remaining: 0,
        limit: 20000,
        apiPercentUsed: 95,
        totalPercentUsed: 79
      }
    }
  });
  assert.equal(result.remainingLabel, '21% left');
  assert.equal(result.included.remainingPercent, 21);
});

test('returns empty windows when Cursor reports nothing usable', () => {
  const result = normalizeCursorUsage({ membershipType: 'free' });
  assert.equal(result.planType, 'free');
  assert.equal(result.isFree, true);
  assert.equal(result.included, null);
  assert.equal(result.api, null);
});
