function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function bool(value, fallback) {
  return value == null ? fallback : Boolean(value);
}

const DOCK_PROVIDERS = [
  { id: 'claude', setting: 'showClaude', label: 'Claude' },
  { id: 'cursor', setting: 'showCursor', label: 'Cursor' },
  { id: 'codex', setting: 'showCodex', label: 'Codex' },
  { id: 'antigravity', setting: 'showAntigravity', label: 'Antigravity' }
];

function sanitizeSettings(value = {}) {
  return {
    opacity: clamp(value.opacity, 0.35, 1, 0.92),
    refreshSeconds: Math.round(clamp(value.refreshSeconds, 10, 300, 30)),
    showClaude: bool(value.showClaude, true),
    showCursor: value.showCursor != null ? Boolean(value.showCursor) : bool(value.includeCursor, true),
    showCodex: bool(value.showCodex, true),
    showAntigravity: bool(value.showAntigravity, true)
  };
}

function visibleProviderIds(settings) {
  return DOCK_PROVIDERS.filter(provider => settings[provider.setting]).map(provider => provider.id);
}

module.exports = { DOCK_PROVIDERS, sanitizeSettings, visibleProviderIds };
