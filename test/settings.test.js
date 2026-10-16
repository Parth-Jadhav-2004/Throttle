const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSettings, visibleProviderIds, DEFAULT_SHORTCUT } = require('../src/settings');

test('uses safe defaults with every provider on', () => assert.deepEqual(sanitizeSettings({}), {
  refreshSeconds: 60,
  showClaude: true,
  showCodex: true,
  showCursor: true,
  showAntigravity: true,
  showOpenCode: true,
  providerOrder: ['claude', 'codex', 'cursor', 'antigravity', 'opencode'],
  theme: 'system',
  density: 'default',
  reduceAnimations: false,
  transparency: false,
  valueMode: 'left',
  resetMode: 'relative',
  clock: 'system',
  alwaysShowPacing: false,
  trayStyle: 'logo',
  taskbarStyle: 'text',
  taskbarHiddenProviders: [],
  showTotalSpend: true,
  spendMetric: 'cost',
  spendPeriod: 'last30',
  hiddenMetrics: [],
  starredMetrics: [],
  placements: {},
  expandedProviders: [],
  alertAlmostOut: false,
  alertCuttingClose: false,
  alertWillRunOut: false,
  hideFromScreenShare: false,
  localApi: true,
  shortcut: DEFAULT_SHORTCUT,
  launchAtLogin: false,
  welcomed: false,
  welcomeCardDismissed: false
}));

test('clamps the refresh interval', () => {
  assert.equal(sanitizeSettings({ refreshSeconds: 2 }).refreshSeconds, 10);
  assert.equal(sanitizeSettings({ refreshSeconds: 9999 }).refreshSeconds, 900);
});

test('drops legacy dock settings', () => {
  const settings = sanitizeSettings({ opacity: 0.8, gridOpacity: 0.4, windowPosition: { x: 1, y: 2 } });
  assert.equal('opacity' in settings, false);
  assert.equal('windowPosition' in settings, false);
});

test('migrates includeCursor into showCursor and honors explicit toggles', () => {
  assert.equal(sanitizeSettings({ includeCursor: false }).showCursor, false);
  assert.equal(sanitizeSettings({ includeCursor: false, showCursor: true }).showCursor, true);
  assert.equal(sanitizeSettings({ showClaude: false }).showClaude, false);
});

test('repairs provider order, keeping known ids once and appending missing ones', () => {
  assert.deepEqual(
    sanitizeSettings({ providerOrder: ['cursor', 'bogus', 'cursor', 'claude'] }).providerOrder,
    ['cursor', 'claude', 'codex', 'antigravity', 'opencode']
  );
});

test('lists visible providers in the saved order', () => {
  assert.deepEqual(
    visibleProviderIds(sanitizeSettings({ providerOrder: ['cursor', 'codex'], showClaude: false })),
    ['cursor', 'codex', 'antigravity', 'opencode']
  );
});

test('validates metric keys and caps starred metrics at two per provider', () => {
  const settings = sanitizeSettings({
    hiddenMetrics: ['claude:weekly', 'nope:x', 'codex', 'claude:weekly', 5],
    starredMetrics: ['claude:session', 'claude:weekly', 'claude:extra', 'codex:weekly']
  });
  assert.deepEqual(settings.hiddenMetrics, ['claude:weekly']);
  assert.deepEqual(settings.starredMetrics, ['claude:session', 'claude:weekly', 'codex:weekly']);
});

test('rejects unknown enum values and unsafe shortcuts', () => {
  const settings = sanitizeSettings({ theme: 'neon', valueMode: 'x', shortcut: 'Ctrl+;rm -rf' });
  assert.equal(settings.theme, 'system');
  assert.equal(settings.valueMode, 'left');
  assert.equal(settings.shortcut, DEFAULT_SHORTCUT);
  assert.equal(sanitizeSettings({ shortcut: '' }).shortcut, '');
  assert.equal(sanitizeSettings({ shortcut: 'Alt+Shift+F5' }).shortcut, 'Alt+Shift+F5');
});

test('keeps only valid metric placements', () => {
  assert.deepEqual(
    sanitizeSettings({ placements: { 'claude:today': 'always', 'codex:trend': 'demand', 'claude:x': 'sideways', bogus: 'always' } }).placements,
    { 'claude:today': 'always', 'codex:trend': 'demand' }
  );
  assert.deepEqual(sanitizeSettings({ placements: ['claude:today'] }).placements, {});
});

test('validates taskbar, spend and alert settings', () => {
  const settings = sanitizeSettings({ taskbarStyle: 'neon', spendMetric: 'rate', spendPeriod: 'week', taskbarHiddenProviders: ['codex', 'nope', 'codex'], alertWillRunOut: 1 });
  assert.equal(settings.taskbarStyle, 'text');
  assert.equal(settings.spendMetric, 'rate');
  assert.equal(settings.spendPeriod, 'last30');
  assert.deepEqual(settings.taskbarHiddenProviders, ['codex']);
  assert.equal(settings.alertWillRunOut, true);
});