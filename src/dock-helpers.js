const DEFAULT_DOCK_WIDTH = 420;
const DEFAULT_DOCK_HEIGHT = 220;
const DEFAULT_HOTSPOT_WIDTH = 240;
const DEFAULT_EDGE_DEPTH = 2;

function getDockBounds(display, width = DEFAULT_DOCK_WIDTH, height = DEFAULT_DOCK_HEIGHT) {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: display.bounds.y,
    width,
    height
  };
}

function getHotspotBounds(display, hotspotWidth = DEFAULT_HOTSPOT_WIDTH, edgeDepth = DEFAULT_EDGE_DEPTH) {
  return {
    x: display.bounds.x + (display.bounds.width - hotspotWidth) / 2,
    y: display.bounds.y,
    width: hotspotWidth,
    height: edgeDepth
  };
}

function containsPoint(bounds, point) {
  return point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
}

function isTopEdgeExposed(display, pointerX, allDisplays) {
  const pointAbove = { x: pointerX, y: display.bounds.y - 1 };
  return !allDisplays.some(other =>
    other.id !== display.id && containsPoint(other.bounds, pointAbove)
  );
}

function isHotspotHit(
  point,
  display,
  allDisplays,
  hotspotWidth = DEFAULT_HOTSPOT_WIDTH,
  edgeDepth = DEFAULT_EDGE_DEPTH
) {
  const hotspot = getHotspotBounds(display, hotspotWidth, edgeDepth);
  return containsPoint(hotspot, point) && isTopEdgeExposed(display, point.x, allDisplays);
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

function shouldSuppressAutomaticReveal(activeWindow, display, inspectionFailed = false) {
  return inspectionFailed || isFullscreenForeground(activeWindow, display);
}

module.exports = {
  DEFAULT_DOCK_WIDTH,
  DEFAULT_DOCK_HEIGHT,
  DEFAULT_HOTSPOT_WIDTH,
  DEFAULT_EDGE_DEPTH,
  getDockBounds,
  getHotspotBounds,
  isTopEdgeExposed,
  isHotspotHit,
  coversDisplay,
  normalizeActiveWindowBounds,
  isFullscreenForeground,
  shouldSuppressAutomaticReveal
};
