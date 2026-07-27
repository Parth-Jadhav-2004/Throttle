const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSettings } = require('../src/settings');

test('uses safe defaults', () => assert.deepEqual(sanitizeSettings({}), {
  opacity: 0.92,
  gridOpacity: 0.96,
  refreshSeconds: 30
}));
test('clamps opacity and refresh interval', () => {
  assert.deepEqual(sanitizeSettings({ opacity: 0.1, gridOpacity: 0.1, refreshSeconds: 2 }), {
    opacity: 0.35,
    gridOpacity: 0.3,
    refreshSeconds: 10
  });
  assert.deepEqual(sanitizeSettings({ opacity: 2, gridOpacity: 2, refreshSeconds: 999 }), {
    opacity: 1,
    gridOpacity: 1,
    refreshSeconds: 300
  });
});
test('accepts but discards legacy remembered window positions', () => {
  assert.deepEqual(sanitizeSettings({
    opacity: 0.8,
    windowPosition: { x: 120, y: 240 }
  }), {
    opacity: 0.8,
    gridOpacity: 0.96,
    refreshSeconds: 30
  });
});
