const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAlerts } = require('../src/alerts');

const NOW = 1_800_000_000;
const ALL_ON = {
  providerOrder: ['claude', 'codex', 'cursor', 'antigravity'],
  alertAlmostOut: true,
  alertCuttingClose: true,
  alertWillRunOut: true
};

function claude(used, elapsedFraction = 0.5, resetsAt = NOW + 300 * 60 * (1 - elapsedFraction)) {
  return { claude: { data: { fiveHour: { usedPercent: used, resetsAt, windowDurationMins: 300 } } } };
}

test('never alerts on the first reading after launch', () => {
  const { alerts } = evaluateAlerts({ providers: claude(95), settings: ALL_ON, memory: {}, nowSec: NOW });
  assert.deepEqual(alerts, []);
});

function gemini(used, resetsAt = NOW + 3600) {
  return { antigravity: { data: { windows: [{ label: 'Gemini', usedPercent: used, resetsAt }] } } };
}

test('alerts once when a meter crosses into almost out', () => {
  let result = evaluateAlerts({ providers: gemini(70), settings: ALL_ON, memory: {}, nowSec: NOW });
  result = evaluateAlerts({ providers: gemini(92), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.deepEqual(result.alerts.map(a => a.kind), ['almostOut']);
  assert.match(result.alerts[0].body, /Antigravity Gemini: 8% left/);
  result = evaluateAlerts({ providers: gemini(93), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.deepEqual(result.alerts, []);
});

test('alerts when the pace projects finishing near the limit', () => {
  let result = evaluateAlerts({ providers: claude(30, 0.5), settings: ALL_ON, memory: {}, nowSec: NOW });
  result = evaluateAlerts({ providers: claude(46, 0.5), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.deepEqual(result.alerts.map(a => a.kind), ['cuttingClose']);
});

test('sends only the most severe alert for one reading', () => {
  const resetsAt = NOW + 225 * 60;
  let result = evaluateAlerts({ providers: claude(10, 0.25, resetsAt), settings: ALL_ON, memory: {}, nowSec: NOW });
  result = evaluateAlerts({ providers: claude(92, 0.25, resetsAt), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.deepEqual(result.alerts.map(a => a.kind), ['willRunOut']);
});

test('respects disabled alert kinds', () => {
  const settings = { ...ALL_ON, alertAlmostOut: false };
  let result = evaluateAlerts({ providers: gemini(70), settings, memory: {}, nowSec: NOW });
  result = evaluateAlerts({ providers: gemini(92), settings, memory: result.memory, nowSec: NOW });
  assert.deepEqual(result.alerts, []);
});

test('a new reset window can alert again', () => {
  let result = evaluateAlerts({ providers: gemini(70), settings: ALL_ON, memory: {}, nowSec: NOW });
  result = evaluateAlerts({ providers: gemini(95), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.equal(result.alerts.length, 1);
  result = evaluateAlerts({ providers: gemini(95, NOW + 7200), settings: ALL_ON, memory: result.memory, nowSec: NOW });
  assert.equal(result.alerts.length, 1);
});
