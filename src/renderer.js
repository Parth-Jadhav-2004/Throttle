const $ = id => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 48;
let lastState = null;

function updateResponsiveLayout() {
  document.body.dataset.layout = globalThis.getWidgetViewMode(window.innerWidth, window.innerHeight);
}

function formatReset(epoch) {
  if (!epoch) return 'Reset unknown';
  const seconds = Math.max(0, epoch - Date.now() / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `Resets in ${days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`}`;
}

function renderLimit(prefix, data) {
  const value = $(`${prefix}-value`);
  const left = $(`${prefix}-left`);
  const ring = $(`${prefix}-ring`);
  if (!data) {
    value.textContent = 'N/A';
    value.style.color = '#898680';
    left.textContent = '';
    ring.style.strokeDashoffset = String(CIRCUMFERENCE);
    ring.style.opacity = '0';
    $(`${prefix}-reset`).textContent = 'Not reported by account';
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

function render(state) {
  lastState = { ...(lastState || {}), ...state };
  const status = $('status');
  status.className = `status ${state.status || ''}`;
  $('refresh').classList.toggle('spinning', state.status === 'refreshing');
  if (state.status === 'refreshing') status.lastElementChild.textContent = lastState.data ? 'Refreshing…' : 'Connecting to Codex…';
  if (state.status === 'connected' && state.data) {
    status.lastElementChild.textContent = 'Live · local Codex connection';
    $('connect').hidden = true;
    renderLimit('five', state.data.fiveHour);
    renderLimit('week', state.data.weekly);
    $('plan').textContent = `${(state.data.planType || 'unknown').toUpperCase()} PLAN · LOCAL`;
    $('updated').textContent = `Updated ${new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (state.status === 'disconnected' || state.status === 'error') {
    status.classList.add('error');
    status.lastElementChild.textContent = state.status === 'disconnected' ? 'Codex login required' : 'Unable to read usage';
    $('connect').hidden = false;
    $('updated').textContent = 'Not updated';
  }
}

function applyPanelOpacity(value) {
  document.documentElement.style.setProperty('--panel-opacity', String(value));
}

window.widget.onUsageState(render);
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
$('interval').addEventListener('change', event => window.widget.setRefreshSeconds(Number(event.target.value)));
$('refresh').addEventListener('click', () => window.widget.refresh());
$('update').addEventListener('click', async () => {
  const button = $('update');
  const text = $('status').lastElementChild;
  const previous = text.textContent;
  button.disabled = true;
  text.textContent = 'Checking for updates…';
  try {
    const result = await window.widget.checkForUpdate();
    text.textContent = result.available
      ? `Throttle ${result.latest} available · opening download`
      : `Throttle ${result.current} is up to date`;
  } catch {
    text.textContent = 'Update check failed · try again later';
  } finally {
    button.disabled = false;
    setTimeout(() => { text.textContent = previous; }, 2600);
  }
});
$('connect').addEventListener('click', () => window.widget.connect());
$('minimize').addEventListener('click', () => window.widget.minimize());
$('close').addEventListener('click', () => window.widget.close());
$('claude-tab').addEventListener('click', () => {
  const text = $('status').lastElementChild;
  const previous = text.textContent;
  text.textContent = 'Claude tracking is coming soon';
  setTimeout(() => { text.textContent = previous; }, 1800);
});
window.addEventListener('resize', updateResponsiveLayout);
updateResponsiveLayout();

setInterval(() => {
  if (lastState?.data) {
    renderLimit('five', lastState.data.fiveHour);
    renderLimit('week', lastState.data.weekly);
  }
}, 30000);
