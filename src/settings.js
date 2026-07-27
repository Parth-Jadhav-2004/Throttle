function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function sanitizeSettings(value = {}) {
  return {
    opacity: clamp(value.opacity, 0.35, 1, 0.92),
    gridOpacity: clamp(value.gridOpacity, 0.3, 1, 0.96),
    refreshSeconds: Math.round(clamp(value.refreshSeconds, 10, 300, 30))
  };
}

module.exports = { sanitizeSettings };
