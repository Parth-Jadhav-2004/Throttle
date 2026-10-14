const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSettings, visibleProviderIds } = require('../src/settings');

test('uses safe defaults with all four dock services on', () => assert.deepEqual(sanitizeSettings({}), {
  opacity: 0.92,
  refreshSeconds: 30,
  showClaude: true,
  showCursor: true,
  showCodex: true,
  showAntigravity: true
}));

test('clamps opacity and refresh interval', () => {
  assert.deepEqual(sanitizeSettings({ opacity: 0.1, refreshSeconds: 2 }), {
    opacity: 0.35,
    refreshSeconds: 10,
    showClaude: true,
    showCursor: true,
    showCodex: true,
    showAntigravity: true
  });
  assert.deepEqual(sanitizeSettings({ opacity: 2, refreshSeconds: 999 }), {
    opacity: 1,
    refreshSeconds: 300,
    showClaude: true,
    showCursor: true,
    showCodex: true,
    showAntigravity: true
  });
});

test('accepts but discards legacy remembered window positions and grid opacity', () => {
  assert.deepEqual(sanitizeSettings({
    opacity: 0.8,
    gridOpacity: 0.4,
    windowPosition: { x: 120, y: 240 }
  }), {
    opacity: 0.8,
    refreshSeconds: 30,
    showClaude: true,
    showCursor: true,
    showCodex: true,
    showAntigravity: true
  });
});

test('migrates includeCursor into showCursor and honors explicit dock toggles', () => {
  assert.equal(sanitizeSettings({ includeCursor: false }).showCursor, false);
  assert.equal(sanitizeSettings({ includeCursor: true }).showCursor, true);
  assert.equal(sanitizeSettings({ includeCursor: false, showCursor: true }).showCursor, true);
  assert.equal(sanitizeSettings({ showClaude: false, showCodex: false }).showClaude, false);
  assert.equal(sanitizeSettings({ showClaude: false, showCodex: false }).showCodex, false);
});

test('lists visible dock providers in display order', () => {
  assert.deepEqual(
    visibleProviderIds(sanitizeSettings({})),
    ['claude', 'cursor', 'codex', 'antigravity']
  );
  assert.deepEqual(
    visibleProviderIds(sanitizeSettings({ showCursor: false })),
    ['claude', 'codex', 'antigravity']
  );
  assert.deepEqual(visibleProviderIds(sanitizeSettings({
    showClaude: false,
    showCursor: false,
    showCodex: false,
    showAntigravity: false
  })), []);
});
