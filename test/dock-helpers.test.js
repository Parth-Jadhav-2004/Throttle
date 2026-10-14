const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DOCK_WIDTH,
  DOCK_PAD_Y,
  SLOT_HEIGHT,
  SLOT_GAP,
  SETTINGS_BUTTON,
  SETTINGS_FLOAT_SPACE,
  getDockHeight,
  getDockBounds,
  getHotspotBounds,
  isRightEdgeExposed,
  isHotspotHit,
  coversDisplay,
  normalizeActiveWindowBounds,
  isFullscreenForeground,
  shouldHideForFullscreen
} = require('../src/dock-helpers');

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

test('pins a vertical dock to the right edge and vertically centers it', () => {
  const three = getDockBounds(primary, 3);
  assert.equal(three.width, DOCK_WIDTH);
  assert.equal(three.x, 1920 - DOCK_WIDTH);
  assert.equal(three.y, Math.round((1080 - three.height) / 2));
  assert.equal(three.height, getDockHeight(3));
  assert.ok(getDockHeight(1) < getDockHeight(2));
  assert.ok(getDockHeight(2) < getDockHeight(3));
});

test('centers the dock on displays with negative coordinates', () => {
  const display = { id: 2, bounds: { x: -1920, y: -240, width: 1920, height: 1080 } };
  const bounds = getDockBounds(display, 3);
  assert.equal(bounds.x, -1920 + 1920 - DOCK_WIDTH);
  assert.equal(bounds.y, Math.round(-240 + (1080 - bounds.height) / 2));
});

test('uses a centered hotspot at the exact right edge', () => {
  assert.deepEqual(
    getHotspotBounds(primary),
    { x: 1918, y: 380, width: 2, height: 320 }
  );
  assert.equal(isHotspotHit({ x: 1918, y: 380 }, primary, [primary]), true);
  assert.equal(isHotspotHit({ x: 1919, y: 699 }, primary, [primary]), true);
  assert.equal(isHotspotHit({ x: 1917, y: 500 }, primary, [primary]), false);
  assert.equal(isHotspotHit({ x: 1919, y: 700 }, primary, [primary]), false);
});

test('rejects a right boundary shared with another display', () => {
  const right = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  assert.equal(isRightEdgeExposed(primary, 540, [primary, right]), false);
  assert.equal(isHotspotHit({ x: 1919, y: 540 }, primary, [primary, right]), false);
});

test('keeps a minimum pill height when every service is hidden', () => {
  assert.equal(getDockHeight(0), getDockHeight(1));
});

test('reserves space below the curve for a floating settings button', () => {
  const stack = DOCK_PAD_Y * 2 + 2 * SLOT_HEIGHT + SLOT_GAP;
  assert.equal(getDockHeight(2), stack + SETTINGS_FLOAT_SPACE);
  assert.ok(SETTINGS_FLOAT_SPACE > 0);
  assert.ok(SETTINGS_FLOAT_SPACE < SETTINGS_BUTTON);
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

test('foreground inspection failures hide the dock', () => {
  assert.equal(shouldHideForFullscreen(undefined, primary, true), true);
  assert.equal(shouldHideForFullscreen(undefined, primary, false), false);
});
