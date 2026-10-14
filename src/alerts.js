const model = require('./usage-model');

const ALMOST_OUT_PERCENT = 10;
const KINDS = {
  willRunOut: { setting: 'alertWillRunOut', title: 'Will run out' },
  almostOut: { setting: 'alertAlmostOut', title: 'Almost out' },
  cuttingClose: { setting: 'alertCuttingClose', title: 'Cutting it close' }
};

function conditions(metric, pace) {
  const left = 100 - metric.usedPercent;
  return {
    almostOut: left <= ALMOST_OUT_PERCENT,
    cuttingClose: pace?.verdict === 'tight' || pace?.verdict === 'at-limit',
    willRunOut: pace?.verdict === 'over' || pace?.verdict === 'reached'
  };
}

function describe(kind, provider, metric, pace, nowSec) {
  const name = `${model.PROVIDER_META[provider]?.name || provider} ${metric.label}`;
  const left = model.formatValue(metric, 'left');
  if (kind === 'almostOut') return `${name}: ${left}. ${model.formatReset(metric.resetsAt, 'relative', nowSec)}`.trim();
  if (kind === 'willRunOut') {
    const note = model.formatPaceNote(pace, 'relative', nowSec);
    return `${name} is on pace to run out before it resets${note ? ` (${note.toLowerCase()})` : ''}.`;
  }
  return `${name} is projected to finish close to its limit. ${left}.`;
}

// Fires each alert once per reset window, and only on a transition into the condition,
// so the first reading after launch never notifies.
function evaluateAlerts({ providers = {}, settings = {}, memory = {}, nowSec = Date.now() / 1000 }) {
  const next = {};
  const alerts = [];
  for (const provider of model.visibleIds(settings)) {
    const hidden = new Set(settings.hiddenMetrics || []);
    for (const metric of model.metricsForProvider(provider, providers[provider]?.data)) {
      const key = model.metricKey(provider, metric.id);
      if (hidden.has(key)) continue;
      const pace = model.computePace(metric, nowSec);
      const now = conditions(metric, pace);
      const previous = memory[key];
      const sameWindow = previous && previous.resetsAt === metric.resetsAt;
      const fired = sameWindow ? { ...previous.fired } : {};
      let sent = false;
      for (const [kind, info] of Object.entries(KINDS)) {
        const was = sameWindow ? previous.state[kind] : previous ? false : now[kind];
        if (now[kind] && !was && !fired[kind] && settings[info.setting]) {
          fired[kind] = true;
          if (!sent) alerts.push({ key, provider, kind, title: info.title, body: describe(kind, provider, metric, pace, nowSec) });
          sent = true;
        }
      }
      next[key] = { resetsAt: metric.resetsAt, state: now, fired };
    }
  }
  return { alerts, memory: next };
}

module.exports = { evaluateAlerts, conditions, KINDS };
