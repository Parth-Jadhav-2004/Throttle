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
  { id: 'antigravity', setting: 'showAntigravity', label: 'Antigravity' },
  { id: 'opencode', setting: 'showOpenCode', label: 'OpenCode' }
];
const PROVIDER_IDS = PROVIDERS.map(provider => provider.id);
const MAX_STARRED_PER_PROVIDER = 2;
const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+U';
const LAYOUT_KEYS = [
  'providerOrder', 'showClaude', 'showCodex', 'showCursor', 'showAntigravity', 'showOpenCode',
  'hiddenMetrics', 'starredMetrics', 'placements', 'taskbarHiddenProviders'
];

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

function isMetricKey(key) {
  if (typeof key !== 'string') return false;
  const [provider, metric, extra] = key.split(':');
  return PROVIDER_IDS.includes(provider) && Boolean(metric) && extra === undefined && /^[\w.-]+$/.test(metric);
}

function sanitizeMetricKeys(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(isMetricKey))];
}

function sanitizeStarred(value) {
  const counts = {};
  return sanitizeMetricKeys(value).filter(key => {
    const provider = key.split(':')[0];
    counts[provider] = (counts[provider] || 0) + 1;
    return counts[provider] <= MAX_STARRED_PER_PROVIDER;
  });
}

function sanitizePlacements(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, placement] of Object.entries(value)) {
    if (isMetricKey(key) && (placement === 'always' || placement === 'demand')) out[key] = placement;
  }
  return out;
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
    showOpenCode: bool(value.showOpenCode, true),
    providerOrder: sanitizeOrder(value.providerOrder),
    theme: oneOf(value.theme, ['system', 'dark', 'light'], 'system'),
    density: oneOf(value.density, ['default', 'compact'], 'default'),
    reduceAnimations: bool(value.reduceAnimations, false),
    transparency: bool(value.transparency, false),
    valueMode: oneOf(value.valueMode, ['left', 'used'], 'left'),
    resetMode: oneOf(value.resetMode, ['relative', 'absolute'], 'relative'),
    clock: oneOf(value.clock, ['system', '12h', '24h'], 'system'),
    alwaysShowPacing: bool(value.alwaysShowPacing, false),
    trayStyle: oneOf(value.trayStyle, ['meter', 'logo'], 'logo'),
    taskbarStyle: oneOf(value.taskbarStyle, ['text', 'bars', 'off'], 'text'),
    taskbarHiddenProviders: sanitizeProviderIds(value.taskbarHiddenProviders),
    showTotalSpend: bool(value.showTotalSpend, true),
    spendMetric: oneOf(value.spendMetric, ['cost', 'rate', 'tokens'], 'cost'),
    spendPeriod: oneOf(value.spendPeriod, ['today', 'yesterday', 'last30'], 'last30'),
    hiddenMetrics: sanitizeMetricKeys(value.hiddenMetrics),
    starredMetrics: sanitizeStarred(value.starredMetrics),
    placements: sanitizePlacements(value.placements),
    expandedProviders: sanitizeProviderIds(value.expandedProviders),
    alertAlmostOut: bool(value.alertAlmostOut, false),
    alertCuttingClose: bool(value.alertCuttingClose, false),
    alertWillRunOut: bool(value.alertWillRunOut, false),
    hideFromScreenShare: bool(value.hideFromScreenShare, false),
    localApi: bool(value.localApi, true),
    shortcut: sanitizeShortcut(value.shortcut),
    launchAtLogin: bool(value.launchAtLogin, false),
    welcomed: bool(value.welcomed, false),
    welcomeCardDismissed: bool(value.welcomeCardDismissed, false)
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
  MAX_STARRED_PER_PROVIDER,
  DEFAULT_SHORTCUT,
  LAYOUT_KEYS,
  sanitizeSettings,
  visibleProviderIds,
  providerSettingKey
};
