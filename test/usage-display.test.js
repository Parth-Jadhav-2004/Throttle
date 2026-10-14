const test = require('node:test');
const assert = require('node:assert/strict');
const { usedPercentForProvider } = require('../src/usage-display');

test('uses Cursor Models percent for Cursor and the highest window for Claude', () => {
  assert.equal(usedPercentForProvider('cursor', { included: { usedPercent: 50 }, api: { usedPercent: 90 } }), 50);
  assert.equal(usedPercentForProvider('claude', {
    fiveHour: { usedPercent: 34 },
    weekly: { usedPercent: 12 }
  }), 34);
  assert.equal(usedPercentForProvider('claude', {
    fiveHour: { usedPercent: 10 },
    weekly: { usedPercent: 61 }
  }), 61);
});

test('uses monthly usage for free Codex and the highest paid window otherwise', () => {
  assert.equal(usedPercentForProvider('codex', {
    isFree: true,
    monthly: { usedPercent: 22 },
    fiveHour: { usedPercent: 80 }
  }), 22);
  assert.equal(usedPercentForProvider('codex', {
    isFree: false,
    fiveHour: { usedPercent: 24 },
    weekly: { usedPercent: 61 }
  }), 61);
  assert.equal(usedPercentForProvider('codex', { isFree: false }), null);
  assert.equal(usedPercentForProvider('cursor', null), null);
});

test('uses the normalized Antigravity quota percentage', () => {
  assert.equal(usedPercentForProvider('antigravity', { usedPercent: 42.5 }), 42.5);
  assert.equal(usedPercentForProvider('antigravity', { usedPercent: 120 }), 100);
});
