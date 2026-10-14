function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function bool(value, fallback) {
  return value == null ? fallback : Boolean(value);
}

function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

const PROVIDERS = [
  { id: 'claude', setting: 'showClaude', label: 'Claude' },
  { id: 'codex', setting: 'showCodex', label: 'Codex' },
  { id: 'cursor', setting: 'showCursor', label: 'Cursor' },
  { id: 'antigravity', setting: 'showAntigravity', label: 'Antigravity' }
];
const PROVIDER_IDS = PROVIDERS.map(provider => provider.id);
const MAX_STARRED = 2;
const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+U';

function sanitizeOrder(value) {
  const seen = new Set();
  const order = [];
  for (const id of Array.isArray(value) ? value : []) {
    if (PROVIDER_IDS.includes(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of PROVIDER_IDS) if (!seen.has(id)) order.push(id);
  return order;
}

function sanitizeMetricKeys(value, limit = Infinity) {
  const keys = [];
  for (const key of Array.isArray(value) ? value : []) {
    if (typeof key !== 'string') continue;
    const [provider, metric] = key.split(':');
    if (!PROVIDER_IDS.includes(provider) || !metric || keys.includes(key)) continue;
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

function sanitizeProviderIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(id => PROVIDER_IDS.includes(id)))];
}

function sanitizeShortcut(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 64 || !/^[\w+]+$/.test(value)) return DEFAULT_SHORTCUT;
  return value;
}

function sanitizeSettings(value = {}) {
  return {
    refreshSeconds: Math.round(clamp(value.refreshSeconds, 10, 900, 60)),
    showClaude: bool(value.showClaude, true),
    showCodex: bool(value.showCodex, true),
    showCursor: value.showCursor != null ? Boolean(value.showCursor) : bool(value.includeCursor, true),
    showAntigravity: bool(value.showAntigravity, true),
    providerOrder: sanitizeOrder(value.providerOrder),
    theme: oneOf(value.theme, ['system', 'dark', 'light'], 'system'),
    valueMode: oneOf(value.valueMode, ['left', 'used'], 'left'),
    resetMode: oneOf(value.resetMode, ['relative', 'absolute'], 'relative'),
    clock: oneOf(value.clock, ['system', '12h', '24h'], 'system'),
    alwaysShowPacing: bool(value.alwaysShowPacing, false),
    trayStyle: oneOf(value.trayStyle, ['meter', 'logo'], 'meter'),
    hiddenMetrics: sanitizeMetricKeys(value.hiddenMetrics),
    starredMetrics: sanitizeMetricKeys(value.starredMetrics, MAX_STARRED),
    expandedProviders: sanitizeProviderIds(value.expandedProviders),
    shortcut: sanitizeShortcut(value.shortcut),
    launchAtLogin: bool(value.launchAtLogin, false)
  };
}

function visibleProviderIds(settings) {
  const enabled = new Set(PROVIDERS.filter(provider => settings[provider.setting]).map(provider => provider.id));
  return sanitizeOrder(settings.providerOrder).filter(id => enabled.has(id));
}

function providerSettingKey(id) {
  return PROVIDERS.find(provider => provider.id === id)?.setting || null;
}

module.exports = {
  PROVIDERS,
  PROVIDER_IDS,
  MAX_STARRED,
  DEFAULT_SHORTCUT,
  sanitizeSettings,
  visibleProviderIds,
  providerSettingKey
};
