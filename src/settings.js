function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function sanitizeSettings(value = {}) {
  const position = value.windowPosition;
  const windowPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { x: Math.round(position.x), y: Math.round(position.y) }
    : null;

  return {
    opacity: clamp(value.opacity, 0.35, 1, 0.92),
    gridOpacity: clamp(value.gridOpacity, 0.3, 1, 0.96),
    refreshSeconds: Math.round(clamp(value.refreshSeconds, 10, 300, 30)),
    windowPosition
  };
}

module.exports = { sanitizeSettings };
