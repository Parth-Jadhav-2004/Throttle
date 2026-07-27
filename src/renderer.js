const $ = id => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 36;
let lastState = null;
let currentDockState = 'hidden';
let currentDockGeneration = 0;

function formatReset(epoch) {
  if (!epoch) return 'Reset unknown';
  const seconds = Math.max(0, epoch - Date.now() / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `Resets in ${days}d ${hours}h`;
  if (hours) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

function renderLimit(prefix, data) {
  const value = $(`${prefix}-value`);
  const left = $(`${prefix}-left`);
  const ring = $(`${prefix}-ring`);
  if (!data) {
    value.textContent = 'N/A';
    value.style.color = '#898d96';
    left.textContent = '';
    ring.style.strokeDashoffset = String(CIRCUMFERENCE);
    ring.style.opacity = '0';
    $(`${prefix}-reset`).textContent = 'Not reported';
    return;
  }
  const remaining = Math.max(0, Math.min(100, data.remainingPercent));
  value.textContent = `${Math.round(remaining)}%`;
  value.style.color = '';
  left.textContent = 'left';
  ring.style.opacity = '1';
  ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - remaining / 100));
  $(`${prefix}-reset`).textContent = formatReset(data.resetsAt);
}

function setConnection(status, text) {
  const dot = $('status-dot');
  dot.className = 'status-dot';
  if (status === 'connected') dot.classList.add('connected');
  if (status === 'disconnected' || status === 'error') dot.classList.add('error');
  $('status').textContent = text;
}

function render(state) {
  lastState = { ...(lastState || {}), ...state };
  $('refresh').classList.toggle('spinning', state.status === 'refreshing');

  if (state.status === 'refreshing') {
    setConnection('refreshing', lastState.data ? 'Refreshing usage…' : 'Connecting to Codex…');
  }
  if (state.status === 'connected' && state.data) {
    setConnection('connected', 'Live · local Codex connection');
    $('connect').hidden = true;
    renderLimit('five', state.data.fiveHour);
    renderLimit('week', state.data.weekly);
    $('plan').textContent = `${(state.data.planType || 'unknown').toUpperCase()} PLAN · LOCAL`;
    $('updated').textContent = `Updated ${new Date(state.updatedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }
  if (state.status === 'disconnected' || state.status === 'error') {
    setConnection(
      state.status,
      state.status === 'disconnected' ? 'Codex login required' : 'Unable to read usage'
    );
    $('connect').hidden = false;
    $('updated').textContent = 'Not updated';
  }
}

function applyPanelOpacity(value) {
  document.documentElement.style.setProperty('--panel-opacity', String(value));
}

function setSettingsView(open) {
  const island = $('island');
  island.dataset.view = open ? 'settings' : 'usage';
  $('settings').setAttribute('aria-label', open ? 'Back to usage' : 'Open settings');
  $('settings').title = open ? 'Back to usage' : 'Settings';
}

window.widget.onUsageState(render);
window.widget.onDockState(({ state, generation }) => {
  currentDockState = state;
  currentDockGeneration = generation;
  document.body.dataset.dockState = state;
  if (state === 'hiding') setSettingsView(false);
});

window.widget.getSettings().then(settings => {
  const opacityPercent = Math.round(settings.opacity * 100);
  const gridPercent = Math.round(settings.gridOpacity * 100);
  $('opacity').value = opacityPercent;
  $('opacity-value').value = `${opacityPercent}%`;
  $('grid-opacity').value = gridPercent;
  $('grid-opacity-value').value = `${gridPercent}%`;
  $('interval').value = String(settings.refreshSeconds);
  applyPanelOpacity(settings.gridOpacity);
});

$('island').addEventListener('transitionend', event => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const completionProperty = reducedMotion ? 'opacity' : 'transform';
  if (event.target !== $('island') || event.propertyName !== completionProperty) return;
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

$('opacity').addEventListener('input', event => {
  $('opacity-value').value = `${event.target.value}%`;
  window.widget.setOpacity(Number(event.target.value) / 100);
});
$('grid-opacity').addEventListener('input', event => {
  const value = Number(event.target.value) / 100;
  $('grid-opacity-value').value = `${event.target.value}%`;
  applyPanelOpacity(value);
  window.widget.setGridOpacity(value);
});
$('interval').addEventListener('change', event =>
  window.widget.setRefreshSeconds(Number(event.target.value))
);
$('refresh').addEventListener('click', () => window.widget.refresh());
$('connect').addEventListener('click', () => window.widget.connect());
$('retract').addEventListener('click', () => window.widget.hideDock());
$('settings').addEventListener('click', () =>
  setSettingsView($('island').dataset.view !== 'settings')
);
$('update').addEventListener('click', async () => {
  const button = $('update');
  const status = $('settings-status');
  button.disabled = true;
  status.textContent = 'Checking for updates…';
  try {
    const result = await window.widget.checkForUpdate();
    status.textContent = result.available
      ? `Throttle ${result.latest} available · opening download`
      : `Throttle ${result.current} is up to date`;
  } catch {
    status.textContent = 'Update check failed · try again later';
  } finally {
    button.disabled = false;
  }
});
$('mobile-pairing').addEventListener('click', () => window.widget.openMobilePairing());

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.widget.hideDock();
});

setInterval(() => {
  if (!lastState?.data) return;
  renderLimit('five', lastState.data.fiveHour);
  renderLimit('week', lastState.data.weekly);
}, 30000);
