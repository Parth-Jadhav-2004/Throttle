const DOCK_PANEL_WIDTH = 104;
const TOOLTIP_GUTTER = 300;
const DOCK_WIDTH = DOCK_PANEL_WIDTH + TOOLTIP_GUTTER;
const SLOT_HEIGHT = 78;
const SLOT_GAP = 14;
const DOCK_PAD_Y = 68;
const SETTINGS_BUTTON = 36;
const SETTINGS_FLOAT_SPACE = 10;
const DEFAULT_HOTSPOT_HEIGHT = 320;
const DEFAULT_EDGE_DEPTH = 2;

function getDockHeight(visibleCount) {
  const n = Math.max(1, Number(visibleCount) || 0);
  return DOCK_PAD_Y * 2 + n * SLOT_HEIGHT + Math.max(0, n - 1) * SLOT_GAP + SETTINGS_FLOAT_SPACE;
}

function getDockBounds(display, visibleCount = 3) {
  const height = getDockHeight(visibleCount);
  return {
    x: Math.round(display.bounds.x + display.bounds.width - DOCK_WIDTH),
    y: Math.round(display.bounds.y + (display.bounds.height - height) / 2),
    width: DOCK_WIDTH,
    height
  };
}

function getHotspotBounds(
  display,
  hotspotHeight = DEFAULT_HOTSPOT_HEIGHT,
  edgeDepth = DEFAULT_EDGE_DEPTH
) {
  const height = Math.min(display.bounds.height, hotspotHeight);
  return {
    x: display.bounds.x + display.bounds.width - edgeDepth,
    y: display.bounds.y + (display.bounds.height - height) / 2,
    width: edgeDepth,
    height
  };
}

function containsPoint(bounds, point) {
  return point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
}

function isRightEdgeExposed(display, pointerY, allDisplays) {
  const pointRight = {
    x: display.bounds.x + display.bounds.width,
    y: pointerY
  };
  return !allDisplays.some(other =>
    other.id !== display.id && containsPoint(other.bounds, pointRight)
  );
}

function isHotspotHit(
  point,
  display,
  allDisplays,
  hotspotHeight = DEFAULT_HOTSPOT_HEIGHT,
  edgeDepth = DEFAULT_EDGE_DEPTH
) {
  return containsPoint(getHotspotBounds(display, hotspotHeight, edgeDepth), point) &&
    isRightEdgeExposed(display, point.y, allDisplays);
}

function coversDisplay(windowBounds, displayBounds, tolerance = 1) {
  if (!windowBounds || !displayBounds) return false;
  const right = windowBounds.x + windowBounds.width;
  const bottom = windowBounds.y + windowBounds.height;
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  return windowBounds.x <= displayBounds.x + tolerance &&
    windowBounds.y <= displayBounds.y + tolerance &&
    right >= displayRight - tolerance &&
    bottom >= displayBottom - tolerance;
}

function normalizeActiveWindowBounds(activeWindow, convertRect) {
  if (!activeWindow || typeof convertRect !== 'function') return activeWindow;
  return {
    ...activeWindow,
    bounds: activeWindow.bounds ? convertRect(activeWindow.bounds) : activeWindow.bounds,
    contentBounds: activeWindow.contentBounds
      ? convertRect(activeWindow.contentBounds)
      : activeWindow.contentBounds
  };
}

function isFullscreenForeground(activeWindow, display) {
  if (!activeWindow || !display) return false;
  const ownerName = String(activeWindow.owner?.name || '').toLowerCase();
  const ownerPath = String(activeWindow.owner?.path || '').toLowerCase();
  const title = String(activeWindow.title || '').toLowerCase();
  const isShell = ownerName === 'windows explorer' ||
    ownerName === 'explorer' ||
    ownerPath.endsWith('\\explorer.exe') ||
    title === 'program manager';
  const isThrottle = ownerName === 'throttle' ||
    ownerPath.endsWith('\\throttle.exe');
  if (isShell || isThrottle) return false;

  // contentBounds excludes the invisible resize frame on Windows, which keeps a
  // normal maximized window from looking like a borderless full-screen window.
  return coversDisplay(activeWindow.contentBounds || activeWindow.bounds, display.bounds, 0);
}

function shouldHideForFullscreen(activeWindow, display, inspectionFailed = false) {
  return inspectionFailed || isFullscreenForeground(activeWindow, display);
}

module.exports = {
  DOCK_PANEL_WIDTH,
  TOOLTIP_GUTTER,
  DOCK_WIDTH,
  SLOT_HEIGHT,
  SLOT_GAP,
  DOCK_PAD_Y,
  SETTINGS_BUTTON,
  SETTINGS_FLOAT_SPACE,
  DEFAULT_HOTSPOT_HEIGHT,
  DEFAULT_EDGE_DEPTH,
  getDockHeight,
  getDockBounds,
  getHotspotBounds,
  isRightEdgeExposed,
  isHotspotHit,
  coversDisplay,
  normalizeActiveWindowBounds,
  isFullscreenForeground,
  shouldHideForFullscreen
};
