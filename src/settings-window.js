const $ = id => document.getElementById(id);
const PROVIDERS = ['claude', 'cursor', 'codex', 'antigravity'];

function settingKey(id) {
  return `show${id[0].toUpperCase()}${id.slice(1)}`;
}

function applySettings(settings) {
  for (const id of PROVIDERS) {
    $(`show-${id}`).setAttribute('aria-checked', settings[settingKey(id)] ? 'true' : 'false');
  }
  $('interval').value = String(settings.refreshSeconds);
  const opacityPercent = Math.round(settings.opacity * 100);
  $('opacity').value = opacityPercent;
  $('opacity-value').value = `${opacityPercent}%`;
}

window.widget.getSettings().then(applySettings);
window.widget.onUsageState(snapshot => {
  if (snapshot?.settings) applySettings(snapshot.settings);
});

for (const id of PROVIDERS) {
  $(`show-${id}`).addEventListener('click', async () => {
    const enabled = $(`show-${id}`).getAttribute('aria-checked') !== 'true';
    const settings = await window.widget.setShowProvider(id, enabled);
    applySettings(settings);
  });
}

$('interval').addEventListener('change', event =>
  window.widget.setRefreshSeconds(Number(event.target.value))
);
$('opacity').addEventListener('input', event => {
  $('opacity-value').value = `${event.target.value}%`;
  window.widget.setOpacity(Number(event.target.value) / 100);
});
$('update').addEventListener('click', async () => {
  const button = $('update');
  const status = $('status');
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
