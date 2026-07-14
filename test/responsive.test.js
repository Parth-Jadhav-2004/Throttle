const test = require('node:test');
const assert = require('node:assert/strict');
const { getWidgetViewMode } = require('../src/responsive');

test('uses the full dashboard at the current maximum size', () => {
  assert.equal(getWidgetViewMode(360, 590), 'full');
});

test('uses a condensed dashboard at intermediate sizes', () => {
  assert.equal(getWidgetViewMode(320, 500), 'condensed');
  assert.equal(getWidgetViewMode(290, 430), 'condensed');
});

test('shows only essential percentages at the smallest sizes', () => {
  assert.equal(getWidgetViewMode(250, 340), 'compact');
  assert.equal(getWidgetViewMode(190, 190), 'compact');
});
