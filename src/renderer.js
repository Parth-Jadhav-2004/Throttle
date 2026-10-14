const $ = id => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 27;
const PROVIDERS = ['claude', 'cursor', 'codex', 'antigravity'];
const CONNECT_LABELS = {
  claude: 'Connect Claude',
  cursor: 'Open Cursor',
  codex: 'Connect Codex',
  antigravity: 'Open Antigravity CLI'
};
const { PROVIDER_TITLES, usageColor, formatResetLabel, limitsForProvider } = window.usageUi || {
  PROVIDER_TITLES: {
    claude: 'Claude Usage',
    cursor: 'Cursor Usage',
    codex: 'Codex Usage',
    antigravity: 'Antigravity Usage'
  },
  usageColor: () => '#ffffff',
  formatResetLabel: () => '',
  limitsForProvider: () => []
};

let currentDockState = 'hidden';
let currentDockGeneration = 0;
let currentSnapshot = { settings: {}, providers: {} };
let hoveredProvider = null;
let tooltipTimer = null;

function settingKey(id) {
  return `show${id[0].toUpperCase()}${id.slice(1)}`;
}

function usedPercent(provider, state) {
  const data = state?.data;
  if (!data) return null;
  if (provider === 'antigravity') return finitePercent(data.usedPercent);
  if (provider === 'cursor') return finitePercent(data.included?.usedPercent);
  if (provider === 'claude') return maxPercent(data.fiveHour?.usedPercent, data.weekly?.usedPercent);
  if (data.isFree) return finitePercent(data.monthly?.usedPercent);
  return maxPercent(data.fiveHour?.usedPercent, data.weekly?.usedPercent, data.monthly?.usedPercent);
}

function finitePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function maxPercent(...values) {
  const percents = values.map(finitePercent).filter(value => value != null);
  return percents.length ? Math.max(...percents) : null;
}

function providerIconMarkup(id) {
  const slot = $(`slot-${id}`);
  const logo = slot?.querySelector('.logo');
  if (!logo) return '';
  return logo.innerHTML.trim();
}

function renderTooltip(provider) {
  const tooltip = $('tooltip');
  const rowsHost = $('tooltip-rows');
  const state = currentSnapshot.providers?.[provider];
  const data = state?.status === 'connected' ? state.data : null;
  const rows = limitsForProvider(provider, data);

  if (!rows.length || document.body.dataset.dockState === 'hidden' || document.body.dataset.dockState === 'hiding') {
    hideTooltip();
    return;
  }

  $('tooltip-title').textContent = PROVIDER_TITLES[provider] || 'Usage';
  $('tooltip-icon').innerHTML = providerIconMarkup(provider);
  rowsHost.replaceChildren();

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = `usage-tooltip-row${row.primary ? ' is-primary' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'usage-tooltip-meta';
    meta.innerHTML = `<span>${row.label}</span><span>${formatResetLabel(row.resetsAt)}</span>`;

    const bar = document.createElement('div');
    bar.className = 'usage-tooltip-bar';
    const fill = document.createElement('span');
    const color = usageColor(row.usedPercent);
    fill.style.width = `${Math.round(row.usedPercent)}%`;
    fill.style.backgroundColor = color;
    bar.appendChild(fill);

    const value = document.createElement('div');
    value.className = 'usage-tooltip-value';
    value.textContent = `${Math.round(row.usedPercent)}% Used`;

    item.append(meta, bar, value);
    rowsHost.appendChild(item);
  }

  const slot = $(`slot-${provider}`);
  const slotRect = slot.getBoundingClientRect();
  const tooltipWidth = 268;
  const left = Math.max(12, slotRect.left - tooltipWidth - 18);
  const top = Math.max(12, slotRect.top + slotRect.height / 2 - 72);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.setProperty('--tooltip-tail-y', `${Math.max(18, slotRect.top + slotRect.height / 2 - top - 7)}px`);
  tooltip.hidden = false;
  tooltip.setAttribute('aria-hidden', 'false');
  tooltip.classList.add('is-visible');
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  hoveredProvider = null;
  const tooltip = $('tooltip');
  tooltip.classList.remove('is-visible');
  tooltip.hidden = true;
  tooltip.setAttribute('aria-hidden', 'true');
}

function scheduleTooltip(provider) {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    if (hoveredProvider === provider) renderTooltip(provider);
  }, 120);
}

function renderSlot(id, state) {
  const slot = $(`slot-${id}`);
  const ring = $(`${id}-ring`);
  const label = $(`${id}-pct`);
  const status = state?.status;
  const used = status === 'connected' ? usedPercent(id, state) : null;
  const actionable = status === 'disconnected' || status === 'error';

  slot.classList.toggle('is-actionable', true);
  slot.classList.toggle('is-empty', used == null);
  slot.classList.toggle('is-error', status === 'disconnected' || status === 'error');
  slot.title = actionable ? CONNECT_LABELS[id] : 'Refresh usage';

  if (used == null) {
    label.textContent = '—';
    ring.style.strokeDashoffset = String(CIRCUMFERENCE);
    ring.style.stroke = '#ffffff';
    return;
  }

  const color = usageColor(used);
  label.textContent = `${Math.round(used)}%`;
  label.style.color = color;
  ring.style.stroke = color;
  ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - used / 100));
}

function render(snapshot = {}) {
  currentSnapshot = snapshot;
  const settings = snapshot.settings || {};
  const providers = snapshot.providers || {};
  for (const id of PROVIDERS) {
    $(`slot-${id}`).hidden = settings[settingKey(id)] === false;
    renderSlot(id, providers[id]);
  }
  if (hoveredProvider) renderTooltip(hoveredProvider);
}

window.widget.onUsageState(render);
window.widget.onDockState(({ state, generation }) => {
  currentDockState = state;
  currentDockGeneration = generation;
  document.body.dataset.dockState = state;
  if (state === 'hidden' || state === 'hiding') hideTooltip();
});
window.widget.getSettings().then(settings => render({ settings, providers: {} }));

document.querySelector('.dock-shell').addEventListener('transitionend', event => {
  if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
  if (currentDockState === 'showing') {
    const generation = currentDockGeneration;
    currentDockState = 'visible';
    document.body.dataset.dockState = 'visible';
    window.widget.dockTransitionComplete('visible', generation);
  } else if (currentDockState === 'hiding') {
    const generation = currentDockGeneration;
    currentDockState = 'hidden';
    document.body.dataset.dockState = 'hidden';
    window.widget.dockTransitionComplete('hidden', generation);
  }
});

for (const id of PROVIDERS) {
  const slot = $(`slot-${id}`);
  slot.addEventListener('click', async () => {
    const state = currentSnapshot.providers?.[id];
    if (state?.status === 'disconnected' || state?.status === 'error') {
      window.widget.connect(id);
      return;
    }
    if (slot.classList.contains('is-refreshing')) return;
    slot.classList.add('is-refreshing');
    try {
      await window.widget.refresh();
    } finally {
      slot.classList.remove('is-refreshing');
    }
  });
  slot.addEventListener('mouseenter', () => {
    if (document.body.dataset.dockState === 'hidden' || document.body.dataset.dockState === 'hiding') return;
    hoveredProvider = id;
    scheduleTooltip(id);
  });
  slot.addEventListener('mouseleave', () => {
    if (hoveredProvider === id) hideTooltip();
  });
  slot.addEventListener('focus', () => {
    if (document.body.dataset.dockState === 'hidden' || document.body.dataset.dockState === 'hiding') return;
    hoveredProvider = id;
    scheduleTooltip(id);
  });
  slot.addEventListener('blur', () => {
    if (hoveredProvider === id) hideTooltip();
  });
}

$('open-settings').addEventListener('click', () => {
  hideTooltip();
  window.widget.openSettings();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideTooltip();
});
