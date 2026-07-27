const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getDockBounds,
  getHotspotBounds,
  isTopEdgeExposed,
  isHotspotHit,
  coversDisplay,
  normalizeActiveWindowBounds,
  isFullscreenForeground,
  shouldSuppressAutomaticReveal
} = require('../src/dock-helpers');

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

test('centers the fixed dock on displays with positive and negative coordinates', () => {
  assert.deepEqual(getDockBounds(primary), { x: 750, y: 0, width: 420, height: 220 });
  assert.deepEqual(
    getDockBounds({ id: 2, bounds: { x: -1920, y: -240, width: 1920, height: 1080 } }),
    { x: -1170, y: -240, width: 420, height: 220 }
  );
});

test('uses a 240 DIP center hotspot at only the exact top edge', () => {
  assert.deepEqual(getHotspotBounds(primary), { x: 840, y: 0, width: 240, height: 2 });
  assert.equal(isHotspotHit({ x: 840, y: 0 }, primary, [primary]), true);
  assert.equal(isHotspotHit({ x: 1079, y: 1 }, primary, [primary]), true);
  assert.equal(isHotspotHit({ x: 839, y: 0 }, primary, [primary]), false);
  assert.equal(isHotspotHit({ x: 1080, y: 0 }, primary, [primary]), false);
  assert.equal(isHotspotHit({ x: 960, y: 2 }, primary, [primary]), false);
  assert.equal(isHotspotHit({ x: 200, y: 0 }, primary, [primary]), false);
});

test('rejects a top boundary that is internal to a vertically stacked monitor', () => {
  const lower = { id: 2, bounds: { x: 0, y: 1080, width: 1920, height: 1080 } };
  assert.equal(isTopEdgeExposed(lower, 960, [primary, lower]), false);
  assert.equal(isHotspotHit({ x: 960, y: 1080 }, lower, [primary, lower]), false);
});

test('detects full display coverage without treating a normal maximized window as full-screen', () => {
  assert.equal(coversDisplay({ x: 0, y: 0, width: 1920, height: 1080 }, primary.bounds), true);
  assert.equal(isFullscreenForeground({
    owner: { name: 'Comet', path: 'C:\\Program Files\\Comet\\comet.exe' },
    bounds: { x: -7, y: -7, width: 1934, height: 1094 },
    contentBounds: { x: 0, y: 0, width: 1920, height: 1040 }
  }, primary), false);
  assert.equal(isFullscreenForeground({
    owner: { name: 'Comet', path: 'C:\\Program Files\\Comet\\comet.exe' },
    contentBounds: { x: 0, y: 0, width: 1920, height: 1080 }
  }, primary), true);
});

test('normalizes physical foreground bounds before comparing with Electron DIP displays', () => {
  const normalized = normalizeActiveWindowBounds({
    bounds: { x: -9, y: -9, width: 1938, height: 1218 },
    contentBounds: { x: 0, y: 0, width: 1920, height: 1198 }
  }, bounds => ({
    x: Math.round(bounds.x / 1.25),
    y: Math.round(bounds.y / 1.25),
    width: Math.round(bounds.width / 1.25),
    height: Math.round(bounds.height / 1.25)
  }));
  assert.deepEqual(normalized.contentBounds, { x: 0, y: 0, width: 1536, height: 958 });
  assert.equal(isFullscreenForeground({
    ...normalized,
    owner: { name: 'Comet', path: 'C:\\Program Files\\Comet\\comet.exe' }
  }, primary), false);
  assert.equal(isFullscreenForeground({
    owner: { name: 'Comet', path: 'C:\\Program Files\\Comet\\comet.exe' },
    contentBounds: { x: 0, y: 0, width: 1536, height: 959 }
  }, primary), false);
});

test('excludes Windows shell and Throttle surfaces from full-screen suppression', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(isFullscreenForeground({
    title: 'Program Manager',
    owner: { name: 'Windows Explorer', path: 'C:\\Windows\\explorer.exe' },
    contentBounds: bounds
  }, primary), false);
  assert.equal(isFullscreenForeground({
    title: 'Throttle',
    owner: { name: 'Throttle', path: 'C:\\Apps\\Throttle.exe' },
    contentBounds: bounds
  }, primary), false);
});

test('foreground inspection failures fail closed for automatic reveals', () => {
  assert.equal(shouldSuppressAutomaticReveal(undefined, primary, true), true);
  assert.equal(shouldSuppressAutomaticReveal(undefined, primary, false), false);
});
