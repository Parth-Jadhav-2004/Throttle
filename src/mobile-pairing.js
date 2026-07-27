const enable = document.getElementById('enable');
const setup = document.getElementById('setup');
const setupStatus = document.getElementById('setup-status');
const pairing = document.getElementById('pairing');
const qr = document.getElementById('qr');
const endpoint = document.getElementById('endpoint');

async function showPairing() {
  const result = await window.widget.getMobilePairing();
  qr.src = result.qrDataUrl;
  endpoint.textContent = result.endpoint;
  setup.hidden = true;
  pairing.hidden = false;
}

async function load() {
  const status = await window.widget.getMobileAccessStatus();
  if (status.enabled) await showPairing();
}

enable.addEventListener('click', async () => {
  enable.disabled = true;
  setupStatus.textContent = 'Configuring private HTTPS through Tailscale…';
  try {
    await window.widget.enableMobileAccess();
    await showPairing();
  } catch (error) {
    setupStatus.textContent = String(error?.message || error);
  } finally {
    enable.disabled = false;
  }
});

load().catch(error => {
  setupStatus.textContent = String(error?.message || error);
});
