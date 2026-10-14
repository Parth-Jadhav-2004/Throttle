const $ = id => document.getElementById(id);
const model = window.usageModel;
const { PROVIDER_META } = model;

const PROVIDER_IDS = ['claude', 'codex', 'cursor', 'antigravity'];
const MAX_STARRED = 2;
const MAX_VIEW_HEIGHT = 600;
const PRIMARY_METRICS = 3;
const TICK_MS = 15 * 1000;
const TIP_DELAY_MS = 380;
const CONNECT_LABELS = {
  claude: 'Sign in to Claude',
  codex: 'Sign in to Codex',
  cursor: 'Open Cursor',
  antigravity: 'Open Antigravity CLI'
};
const VIEW_TITLES = { customize: 'Customize', settings: 'Settings' };
const CODEX_PATH = 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.91 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.989 5.989 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zm-9.022 12.608a4.476 4.476 0 0 1-2.876-1.04l.142-.081 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zM3.599 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .781 0l5.843-3.368v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.141-1.646zM2.341 7.896a4.485 4.485 0 0 1 2.365-1.972V11.6a.766.766 0 0 0 .388.676l5.814 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.0 14.014A4.504 4.504 0 0 1 2.34 7.872zm16.596 3.855-5.833-3.387 2.015-1.164a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.407-.667zm2.011-3.023-.142-.085-4.773-2.782a.776.776 0 0 0-.786 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061L14.268 4.05a4.5 4.5 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.375-3.454l-.142.081L8.704 5.459a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z';
const ICONS = {
  flame: '<svg viewBox="0 0 24 24" class="ico-fill"><path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2 .8-3.6 2-4.8.2 1.6 1 2.8 2.2 3.3C10.6 8.6 11 5 12 2z"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  grip: '<svg viewBox="0 0 24 24" class="ico-fill"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>'
};

let state = { settings: {}, providers: {}, nextRefreshAt: null, version: '' };
let view = 'dashboard';
let detailProvider = null;
let menuContext = null;
let tipTimer = null;
let sizeFrame = 0;
let recordingShortcut = false;

function nowSec() {
  return Date.now() / 1000;
}

function settingKey(id) {
  return `show${id[0].toUpperCase()}${id.slice(1)}`;
}

function isEnabled(id) {
  return state.settings[settingKey(id)] !== false;
}

function visibleProviders() {
  return (state.settings.providerOrder || PROVIDER_IDS).filter(isEnabled);
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function logoMarkup(id) {
  if (id === 'codex') return `<svg viewBox="0 0 24 24" class="ico-fill"><path d="${CODEX_PATH}"/></svg>`;
  if (id === 'antigravity') return '<img src="assets/antigravity.png" alt="">';
  return `<img src="assets/${id}.svg" alt="">`;
}

function logoTile(id, size = '') {
  const tile = el('span', `logo-tile logo-${id} ${size}`.trim(), logoMarkup(id));
  tile.setAttribute('aria-hidden', 'true');
  return tile;
}

function update(patch) {
  state.settings = { ...state.settings, ...patch };
  renderAll();
  return window.widget.updateSettings(patch);
}

function toggleListValue(list, value, on, limit = Infinity) {
  const next = (list || []).filter(item => item !== value);
  if (on) next.push(value);
  return next.slice(-limit);
}

function providerMetrics(id) {
  const hidden = new Set(state.settings.hiddenMetrics || []);
  return model.metricsForProvider(id, state.providers[id]?.data)
    .filter(m => !hidden.has(model.metricKey(id, m.id)));
}

// ---------- Dashboard ----------

function ensureCard(id) {
  const host = $('cards');
  let card = host.querySelector(`.card[data-provider="${id}"]`);
  if (card) return card;
  card = el('article', 'card');
  card.dataset.provider = id;
  card.style.setProperty('--brand', PROVIDER_META[id].color);

  const head = el('header', 'card-head');
  head.append(logoTile(id));
  const title = el('div', 'card-title');
  title.append(el('strong', '', PROVIDER_META[id].name), el('span', 'plan'));
  const status = el('div', 'card-status');
  const warn = el('span', 'warn-badge', ICONS.warn);
  warn.hidden = true;
  status.append(el('span', 'spinner'), warn);
  head.append(title, status);

  const metrics = el('div', 'metrics');
  const notice = el('div', 'notice');
  notice.hidden = true;

  const more = el('div', 'card-more');
  const moreInner = el('div', 'card-more-inner');
  moreInner.append(el('div', 'metrics more-metrics'), el('div', 'meta'), el('div', 'links'));
  more.append(moreInner);

  const caret = el('button', 'caret', `<span class="more-count"></span>${ICONS.caret}`);
  caret.type = 'button';
  caret.setAttribute('aria-label', `More ${PROVIDER_META[id].name} details`);
  caret.addEventListener('click', () => {
    const open = !(state.settings.expandedProviders || []).includes(id);
    update({ expandedProviders: toggleListValue(state.settings.expandedProviders, id, open) });
  });

  card.append(head, metrics, notice, more, caret);
  host.append(card);
  return card;
}

function ensureMetricRow(host, m) {
  let row = host.querySelector(`.metric[data-metric="${CSS.escape(m.id)}"]`);
  if (row) return row;
  row = el('div', 'metric');
  row.dataset.metric = m.id;
  const top = el('div', 'metric-top');
  top.append(el('span', 'metric-name'), el('span', 'star-mark', ICONS.star), el('button', 'metric-note'));
  const bar = el('div', 'bar');
  bar.append(el('span', 'fill'), el('span', 'tick'));
  const bottom = el('div', 'metric-bottom');
  bottom.append(el('button', 'metric-value'), el('button', 'metric-reset'));
  row.append(top, bar, bottom);
  for (const button of row.querySelectorAll('button')) button.type = 'button';
  host.append(row);
  return row;
}

function renderMetricRow(row, id, m) {
  const mode = state.settings.valueMode || 'left';
  const resetMode = state.settings.resetMode || 'relative';
  const clock = state.settings.clock || 'system';
  const pace = model.computePace(m, nowSec());
  const key = model.metricKey(id, m.id);
  const percent = model.displayPercent(m, mode);
  const showPacing = pace && (pace.tone !== 'ok' || state.settings.alwaysShowPacing);

  row.dataset.tone = pace?.tone || 'ok';
  row.dataset.key = key;
  row.querySelector('.metric-name').textContent = m.label;
  row.querySelector('.star-mark').hidden = !(state.settings.starredMetrics || []).includes(key);

  const note = row.querySelector('.metric-note');
  const noteText = showPacing ? model.formatPaceNote(pace, resetMode, nowSec(), clock) : '';
  const flame = pace && ['over', 'reached', 'at-limit'].includes(pace.verdict);
  note.innerHTML = noteText ? `${flame ? ICONS.flame : ''}<span>${noteText}</span>` : '';
  note.hidden = !noteText;
  note.dataset.tip = model.formatPaceDetail(pace);
  note.classList.toggle('is-clickable', pace?.verdict === 'over' && Boolean(pace.runOutAt));

  const fill = row.querySelector('.fill');
  fill.style.width = `${percent}%`;
  const tick = row.querySelector('.tick');
  const tickAt = pace?.evenPace != null && m.usedPercent > 0 && showPacing
    ? (mode === 'used' ? pace.evenPace : 100 - pace.evenPace)
    : null;
  tick.hidden = tickAt == null;
  if (tickAt != null) tick.style.left = `${tickAt}%`;
  row.querySelector('.bar').dataset.tip = model.formatPaceDetail(pace);

  const value = row.querySelector('.metric-value');
  value.textContent = model.formatValue(m, mode);
  value.dataset.alt = model.formatValue(m, mode === 'used' ? 'left' : 'used');
  value.dataset.main = value.textContent;
  if (m.detail) value.dataset.tip = m.detail;

  const reset = row.querySelector('.metric-reset');
  reset.textContent = model.formatReset(m.resetsAt, resetMode, nowSec(), clock);
  reset.dataset.main = reset.textContent;
  reset.dataset.alt = model.formatReset(m.resetsAt, resetMode === 'relative' ? 'absolute' : 'relative', nowSec(), clock);
  reset.hidden = !m.resetsAt;
}

function renderMetricList(host, id, metrics) {
  const keep = new Set(metrics.map(m => m.id));
  for (const child of [...host.children]) {
    if (!child.classList.contains('metric') || !keep.has(child.dataset.metric)) child.remove();
  }
  metrics.forEach((m, index) => {
    const row = ensureMetricRow(host, m);
    if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    renderMetricRow(row, id, m);
  });
  host.hidden = !metrics.length;
}

function renderNotice(card, id, provider) {
  const notice = card.querySelector('.notice');
  const hasData = Boolean(provider?.data);
  if (hasData) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.replaceChildren();
  if (!provider || (provider.refreshing && !provider.status)) {
    notice.className = 'notice is-loading';
    for (let i = 0; i < 2; i += 1) notice.append(el('div', 'skeleton'));
    return;
  }
  notice.className = 'notice';
  const signedOut = provider.status === 'disconnected';
  notice.append(
    el('p', 'notice-title', signedOut ? 'Not signed in' : 'Couldn’t load usage'),
    el('p', 'notice-copy', signedOut
      ? `Throttle reads ${PROVIDER_META[id].name}’s existing login on this PC.`
      : escapeHtml(provider.error || 'Unknown error'))
  );
  const action = el('button', 'btn btn-small', signedOut ? CONNECT_LABELS[id] : 'Try again');
  action.type = 'button';
  action.addEventListener('click', () => (signedOut ? window.widget.connect(id) : window.widget.refresh(id)));
  notice.append(action);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderCard(id) {
  const card = ensureCard(id);
  const provider = state.providers[id];
  const data = provider?.data;
  const expanded = (state.settings.expandedProviders || []).includes(id);

  card.querySelector('.plan').textContent = data?.planType ? String(data.planType) : '';
  card.classList.toggle('is-refreshing', Boolean(provider?.refreshing));
  card.classList.toggle('is-expanded', expanded);
  card.querySelector('.caret').setAttribute('aria-expanded', String(expanded));

  const warn = card.querySelector('.warn-badge');
  warn.hidden = !(data && provider.error);
  warn.dataset.tip = provider?.error || '';

  const host = card.querySelector('.metrics');
  const metrics = providerMetrics(id);
  renderMetricList(host, id, metrics.slice(0, PRIMARY_METRICS));
  renderMetricList(card.querySelector('.more-metrics'), id, metrics.slice(PRIMARY_METRICS));
  card.querySelector('.more-count').textContent = metrics.length > PRIMARY_METRICS
    ? `${metrics.length - PRIMARY_METRICS} more`
    : '';
  if (data && !metrics.length) {
    host.hidden = false;
    host.replaceChildren(el('p', 'notice-copy', 'All metrics hidden. Right-click the header to customize.'));
  }

  renderNotice(card, id, provider);

  const meta = card.querySelector('.meta');
  const parts = [];
  if (data?.account) parts.push(escapeHtml(data.account));
  if (provider?.updatedAt) parts.push(`Updated ${model.formatAgo(provider.updatedAt)}`);
  if (provider?.error && data) parts.push(`<span class="meta-error">${escapeHtml(provider.error)}</span>`);
  meta.innerHTML = parts.join(' · ') || 'Waiting for first refresh';

  const links = card.querySelector('.links');
  if (!links.childElementCount) {
    for (const link of PROVIDER_META[id].links) {
      const button = el('button', 'link-btn', `<span>${link.label}</span>${ICONS.external}`);
      button.type = 'button';
      button.addEventListener('click', () => window.widget.openExternal(link.url));
      links.append(button);
    }
  }
}

function renderDashboard() {
  const order = visibleProviders();
  const host = $('cards');
  for (const card of host.querySelectorAll('.card')) {
    if (!order.includes(card.dataset.provider)) card.remove();
  }
  order.forEach((id, index) => {
    renderCard(id);
    const card = host.querySelector(`.card[data-provider="${id}"]`);
    if (host.children[index] !== card) host.insertBefore(card, host.children[index] || null);
  });
  $('empty').hidden = order.length > 0;
}

// ---------- Customize ----------

function renderCustomize() {
  const host = $('customize-list');
  if (host.dataset.dragging) return;
  const order = state.settings.providerOrder || PROVIDER_IDS;
  order.forEach((id, index) => {
    let row = host.querySelector(`.provider-row[data-provider="${id}"]`);
    if (!row) {
      row = el('div', 'list-row provider-row');
      row.dataset.provider = id;
      const grip = el('span', 'grip', ICONS.grip);
      grip.title = 'Drag to reorder';
      grip.addEventListener('pointerdown', event => startDrag(event, row, host));
      const open = el('button', 'row-main');
      open.type = 'button';
      const copy = el('span', 'row-copy');
      copy.append(el('span', 'row-title', PROVIDER_META[id].name), el('span', 'row-sub'));
      open.append(logoTile(id, 'small'), copy, el('span', 'row-chevron', ICONS.chevron));
      open.addEventListener('click', () => openProvider(id));
      row.append(grip, open, switchButton(true, `Show ${PROVIDER_META[id].name}`, on => update({ [settingKey(id)]: on })));
    }
    if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    const enabled = isEnabled(id);
    const catalog = model.metricCatalog(id, state.providers[id]?.data);
    const hidden = state.settings.hiddenMetrics || [];
    const shown = catalog.filter(m => !hidden.includes(model.metricKey(id, m.id))).length;
    row.classList.toggle('is-off', !enabled);
    row.querySelector('.row-sub').textContent = catalog.length ? `${shown} of ${catalog.length} metrics shown` : 'Metrics appear after first refresh';
    row.querySelector('.switch').setAttribute('aria-checked', String(enabled));
  });
}

function switchButton(on, label, onChange) {
  const button = el('button', 'switch');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(on));
  button.setAttribute('aria-label', label);
  button.addEventListener('click', event => {
    event.stopPropagation();
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return button;
}

function startDrag(event, row, host) {
  event.preventDefault();
  const rows = () => [...host.querySelectorAll('.provider-row')];
  const grabOffset = event.clientY - row.getBoundingClientRect().top;
  let translate = 0;
  host.dataset.dragging = '1';
  row.classList.add('is-dragging');
  row.setPointerCapture(event.pointerId);

  const flip = before => {
    for (const r of rows()) {
      if (r === row) continue;
      const delta = before.get(r) - r.getBoundingClientRect().top;
      if (!delta) continue;
      r.style.transition = 'none';
      r.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        r.style.transition = '';
        r.style.transform = '';
      });
    }
  };

  const onMove = moveEvent => {
    const others = rows().filter(r => r !== row);
    let index = others.findIndex(r => {
      const box = r.getBoundingClientRect();
      return moveEvent.clientY < box.top + box.height / 2;
    });
    if (index === -1) index = others.length;
    if (rows().indexOf(row) !== index) {
      const before = new Map(others.map(r => [r, r.getBoundingClientRect().top]));
      host.insertBefore(row, others[index] || null);
      flip(before);
    }
    const naturalTop = row.getBoundingClientRect().top - translate;
    translate = moveEvent.clientY - grabOffset - naturalTop;
    row.style.transform = `translateY(${translate}px)`;
  };

  const onUp = () => {
    row.removeEventListener('pointermove', onMove);
    row.removeEventListener('pointerup', onUp);
    row.removeEventListener('pointercancel', onUp);
    row.classList.remove('is-dragging');
    row.style.transform = '';
    delete host.dataset.dragging;
    const order = rows().map(r => r.dataset.provider);
    if (order.join() !== (state.settings.providerOrder || []).join()) update({ providerOrder: order });
  };

  row.addEventListener('pointermove', onMove);
  row.addEventListener('pointerup', onUp);
  row.addEventListener('pointercancel', onUp);
}

function openProvider(id) {
  detailProvider = id;
  renderProvider();
  setView('provider');
}

function renderProvider() {
  const id = detailProvider;
  if (!id) return;
  const provider = state.providers[id];
  const hero = $('provider-hero');
  hero.replaceChildren(logoTile(id, 'large'));
  const copy = el('div', 'hero-copy');
  const status = provider?.data
    ? (provider.error ? `Showing last values · ${provider.error}` : `Connected${provider.data.planType ? ` · ${provider.data.planType}` : ''}`)
    : provider?.status === 'disconnected' ? 'Not signed in' : provider?.error || 'Waiting for first refresh';
  copy.append(el('strong', '', PROVIDER_META[id].name), el('span', '', escapeHtml(status)));
  hero.append(copy, switchButton(isEnabled(id), `Show ${PROVIDER_META[id].name}`, on => update({ [settingKey(id)]: on })));

  const host = $('provider-metrics');
  if (host.dataset.provider !== id) {
    host.replaceChildren();
    host.dataset.provider = id;
  }
  const catalog = model.metricCatalog(id, provider?.data);
  const keys = catalog.map(m => model.metricKey(id, m.id));
  for (const row of host.querySelectorAll('.metric-setting')) if (!keys.includes(row.dataset.key)) row.remove();
  catalog.forEach((m, index) => {
    const key = keys[index];
    let row = host.querySelector(`.metric-setting[data-key="${CSS.escape(key)}"]`);
    if (!row) {
      row = el('div', 'list-row metric-setting');
      row.dataset.key = key;
      const star = el('button', 'star-btn', ICONS.star);
      star.type = 'button';
      star.addEventListener('click', () => {
        const on = !(state.settings.starredMetrics || []).includes(key);
        update({ starredMetrics: toggleListValue(state.settings.starredMetrics, key, on, MAX_STARRED) });
      });
      row.append(el('span', 'row-title'), star, switchButton(true, `Show ${m.label}`, on => {
        update({ hiddenMetrics: toggleListValue(state.settings.hiddenMetrics, key, !on) });
      }));
    }
    if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
    const starred = (state.settings.starredMetrics || []).includes(key);
    row.querySelector('.row-title').textContent = m.label;
    const star = row.querySelector('.star-btn');
    star.classList.toggle('is-on', starred);
    star.title = starred ? 'Remove from tray icon' : 'Show in tray icon';
    row.querySelector('.switch').setAttribute('aria-checked', String(!(state.settings.hiddenMetrics || []).includes(key)));
  });
  $('provider-metrics-empty').hidden = catalog.length > 0;
  $('provider-connect').textContent = CONNECT_LABELS[id];
}

// ---------- Settings ----------

function renderSettings() {
  const s = state.settings;
  for (const seg of document.querySelectorAll('.seg')) {
    const value = s[seg.dataset.setting];
    const buttons = [...seg.querySelectorAll('button')];
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === value)));
    positionSegIndicator(seg);
  }
  for (const toggle of document.querySelectorAll('.switch[data-setting]')) {
    toggle.setAttribute('aria-checked', String(Boolean(s[toggle.dataset.setting])));
  }
  if (!recordingShortcut) $('shortcut').textContent = formatAccelerator(s.shortcut);
  const select = $('refresh-seconds');
  if (![...select.options].some(option => Number(option.value) === s.refreshSeconds) && s.refreshSeconds) {
    select.append(new Option(`${s.refreshSeconds} seconds`, String(s.refreshSeconds)));
  }
  select.value = String(s.refreshSeconds);
  $('about-version').textContent = `Throttle ${state.version || ''}`.trim();
}

function positionSegIndicator(seg) {
  let indicator = seg.querySelector('.seg-indicator');
  if (!indicator) {
    indicator = el('span', 'seg-indicator');
    seg.prepend(indicator);
  }
  const active = seg.querySelector('button[aria-pressed="true"]');
  if (!active || !active.offsetWidth) return;
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

function formatAccelerator(accelerator) {
  if (!accelerator) return 'Not set';
  return accelerator.replace('CommandOrControl', 'Ctrl').split('+').join(' + ');
}

const KEY_NAMES = {
  Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Tab: 'Tab'
};

function acceleratorFromEvent(event) {
  let key = null;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (/^F\d{1,2}$/.test(event.code)) key = event.code;
  else if (KEY_NAMES[event.code]) key = KEY_NAMES[event.code];
  if (!key) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  if (!parts.length && !/^F\d/.test(key)) return null;
  return [...parts, key].join('+');
}

function stopRecording(message) {
  recordingShortcut = false;
  $('shortcut').classList.remove('is-recording');
  $('shortcut').textContent = formatAccelerator(state.settings.shortcut);
  $('shortcut-help').textContent = message || 'Toggle Throttle from anywhere';
  void window.widget.suspendShortcut(false);
}

async function handleShortcutKey(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') return stopRecording();
  if (event.key === 'Backspace' || event.key === 'Delete') {
    await window.widget.updateSettings({ shortcut: '' });
    state.settings.shortcut = '';
    return stopRecording('Shortcut cleared');
  }
  const accelerator = acceleratorFromEvent(event);
  if (!accelerator) return;
  const previous = state.settings.shortcut;
  const result = await window.widget.updateSettings({ shortcut: accelerator });
  if (!result.shortcutOk) {
    await window.widget.updateSettings({ shortcut: previous });
    return stopRecording(`${formatAccelerator(accelerator)} is taken by another app`);
  }
  state.settings.shortcut = accelerator;
  stopRecording('Saved');
}

// ---------- Footer, tray, ticking ----------

function renderFooter() {
  const anyRefreshing = PROVIDER_IDS.some(id => state.providers[id]?.refreshing);
  const button = $('next-update');
  button.classList.toggle('is-refreshing', anyRefreshing);
  $('btn-refresh').classList.toggle('is-spinning', anyRefreshing);
  if (anyRefreshing) {
    $('next-update-text').textContent = 'Updating…';
  } else if (state.nextRefreshAt) {
    const seconds = (state.nextRefreshAt - Date.now()) / 1000;
    $('next-update-text').textContent = seconds > 1 ? `Next update in ${model.formatDuration(seconds)}` : 'Updating soon';
  } else {
    $('next-update-text').textContent = 'Refresh now';
  }
  $('version').textContent = state.version ? `v${state.version}` : '';
}

const TONE_COLORS = { ok: '#34c77b', warn: '#f2b13a', danger: '#f0564a' };

function drawTrayImage(entries, size, dark) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const mode = state.settings.valueMode || 'left';
  const count = Math.max(1, entries.length);
  const barHeight = Math.round(size * (count === 1 ? 0.36 : 0.28));
  const gap = Math.round(size * 0.14);
  const total = count * barHeight + (count - 1) * gap;
  const inset = Math.max(1, Math.round(size * 0.06));
  const width = size - inset * 2;
  let y = Math.round((size - total) / 2);
  const round = (x, top, w, h) => {
    const r = Math.min(h / 2, w / 2);
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, r);
    ctx.fill();
  };
  for (const entry of entries) {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.26)';
    round(inset, y, width, barHeight);
    const pct = model.displayPercent(entry.metric, mode) / 100;
    if (pct > 0) {
      ctx.fillStyle = TONE_COLORS[entry.pace?.tone || 'ok'];
      round(inset, y, Math.max(barHeight, width * pct), barHeight);
    }
    y += barHeight + gap;
  }
  return canvas.toDataURL('image/png');
}

let lastTraySignature = '';

function renderTray() {
  const entries = model.trayMetrics(state.providers, state.settings, nowSec());
  const mode = state.settings.valueMode || 'left';
  const tooltip = model.trayTooltip(entries, mode);
  const dark = state.taskbarDark !== false;
  const signature = JSON.stringify([
    state.settings.trayStyle,
    dark,
    mode,
    entries.map(entry => [entry.key, Math.round(entry.metric.usedPercent), entry.pace?.tone])
  ]);
  if (signature === lastTraySignature) return;
  lastTraySignature = signature;
  const images = state.settings.trayStyle === 'logo' || !entries.length
    ? []
    : [[1, 16], [1.25, 20], [1.5, 24], [2, 32]].map(([scale, size]) => ({
        scale,
        dataUrl: drawTrayImage(entries.slice(0, MAX_STARRED), size, dark)
      }));
  window.widget.setTrayImage({ images, tooltip });
}

function renderAll() {
  document.documentElement.dataset.theme = state.settings.theme || 'system';
  renderDashboard();
  if (view === 'customize') renderCustomize();
  if (view === 'provider') renderProvider();
  renderSettings();
  renderFooter();
  renderTray();
  scheduleSize();
}

// ---------- Views and sizing ----------

function setView(next) {
  const previous = view;
  view = next;
  const app = $('app');
  app.dataset.view = next;
  const depth = { dashboard: 0, customize: 1, settings: 1, provider: 2 };
  for (const section of document.querySelectorAll('.view')) {
    const name = section.id.replace('view-', '');
    section.classList.toggle('is-active', name === next);
    const relative = depth[name] - depth[next];
    section.dataset.pos = name === next ? 'center' : relative < 0 ? 'left' : 'right';
    if (name !== next) section.setAttribute('inert', '');
    else section.removeAttribute('inert');
  }
  $('view-title').textContent = next === 'provider' ? PROVIDER_META[detailProvider]?.name || '' : VIEW_TITLES[next] || '';
  if (next === 'customize') renderCustomize();
  if (next === 'settings') requestAnimationFrame(() => document.querySelectorAll('.seg').forEach(positionSegIndicator));
  if (previous !== next) $(`view-${next}`).querySelector('.view-inner').scrollTop = 0;
  hideMenu();
  hideTip();
  scheduleSize();
}

function back() {
  if (view === 'provider') setView('customize');
  else if (view !== 'dashboard') setView('dashboard');
}

function scheduleSize() {
  cancelAnimationFrame(sizeFrame);
  sizeFrame = requestAnimationFrame(applySize);
}

function applySize() {
  const inner = $(`view-${view}`).querySelector('.view-inner');
  const maxHeight = Math.min(MAX_VIEW_HEIGHT, window.screen.availHeight - 160);
  document.documentElement.style.setProperty('--max-view', `${maxHeight}px`);
  const contentHeight = Math.min(inner.scrollHeight, maxHeight);
  $('viewport').style.height = `${contentHeight}px`;
  const total = $('topbar').offsetHeight + contentHeight + $('footer').offsetHeight;
  window.widget.reportSize(total);
}

const resizeObserver = new ResizeObserver(scheduleSize);
for (const inner of document.querySelectorAll('.view-inner')) {
  for (const child of inner.children) resizeObserver.observe(child);
  new MutationObserver(() => {
    for (const child of inner.children) resizeObserver.observe(child);
    scheduleSize();
  }).observe(inner, { childList: true });
}

// ---------- Menus and tips ----------

function showMenu(items, x, y) {
  const menu = $('menu');
  menu.replaceChildren();
  for (const item of items) {
    if (item === 'separator') {
      menu.append(el('div', 'menu-sep'));
      continue;
    }
    const button = el('button', `menu-item${item.danger ? ' is-danger' : ''}`, escapeHtml(item.label));
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      hideMenu();
      item.action();
    });
    menu.append(button);
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menuContext = true;
}

function hideMenu() {
  const menu = $('menu');
  menu.classList.remove('is-open');
  menu.hidden = true;
  menuContext = null;
}

function providerMenuItems(id, metricKey) {
  const name = PROVIDER_META[id].name;
  const items = [];
  if (metricKey) {
    const starred = (state.settings.starredMetrics || []).includes(metricKey);
    items.push(
      { label: starred ? 'Remove from tray icon' : 'Show in tray icon', action: () => update({ starredMetrics: toggleListValue(state.settings.starredMetrics, metricKey, !starred, MAX_STARRED) }) },
      { label: 'Hide metric', action: () => update({ hiddenMetrics: toggleListValue(state.settings.hiddenMetrics, metricKey, true) }) },
      'separator'
    );
  }
  items.push(
    { label: `Refresh ${name}`, action: () => window.widget.refresh(id) },
    { label: `Customize ${name}…`, action: () => { detailProvider = id; renderProvider(); setView('provider'); } },
    'separator',
    { label: `Hide ${name}`, danger: true, action: () => update({ [settingKey(id)]: false }) }
  );
  return items;
}

function showTip(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const tip = $('tip');
  tip.textContent = text;
  tip.hidden = false;
  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tipRect.width / 2, window.innerWidth - tipRect.width - 8));
  const above = rect.top - tipRect.height - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${above > 8 ? above : rect.bottom + 8}px`;
  requestAnimationFrame(() => tip.classList.add('is-open'));
}

function hideTip() {
  clearTimeout(tipTimer);
  const tip = $('tip');
  tip.classList.remove('is-open');
  tip.hidden = true;
}

// ---------- Events ----------

document.addEventListener('mouseover', event => {
  const swap = event.target.closest('.metric-value, .metric-reset');
  if (swap && swap.dataset.alt && !swap.dataset.hovering) {
    swap.dataset.hovering = '1';
    swap.textContent = swap.dataset.alt;
  }
  const target = event.target.closest('[data-tip]');
  if (!target || !target.dataset.tip) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
});

document.addEventListener('mouseout', event => {
  const swap = event.target.closest('.metric-value, .metric-reset');
  if (swap && !swap.contains(event.relatedTarget)) {
    delete swap.dataset.hovering;
    swap.textContent = swap.dataset.main || swap.textContent;
  }
  if (event.target.closest('[data-tip]')) hideTip();
});

$('cards').addEventListener('click', event => {
  const value = event.target.closest('.metric-value');
  if (value) {
    delete value.dataset.hovering;
    update({ valueMode: state.settings.valueMode === 'used' ? 'left' : 'used' });
    return;
  }
  if (event.target.closest('.metric-reset') || event.target.closest('.metric-note.is-clickable')) {
    const reset = event.target.closest('.metric-reset');
    if (reset) delete reset.dataset.hovering;
    update({ resetMode: state.settings.resetMode === 'absolute' ? 'relative' : 'absolute' });
  }
});

$('cards').addEventListener('contextmenu', event => {
  const card = event.target.closest('.card');
  if (!card) return;
  event.preventDefault();
  const metric = event.target.closest('.metric');
  showMenu(providerMenuItems(card.dataset.provider, metric?.dataset.key || null), event.clientX, event.clientY);
});

document.addEventListener('contextmenu', event => event.preventDefault());

document.addEventListener('pointerdown', event => {
  if (menuContext && !event.target.closest('#menu')) hideMenu();
});

$('btn-back').addEventListener('click', back);
$('btn-refresh').addEventListener('click', () => window.widget.refresh());
$('next-update').addEventListener('click', () => window.widget.refresh());
$('btn-customize').addEventListener('click', () => setView(view === 'customize' ? 'dashboard' : 'customize'));
$('btn-settings').addEventListener('click', () => setView(view === 'settings' ? 'dashboard' : 'settings'));
$('empty-customize').addEventListener('click', () => setView('customize'));
$('provider-connect').addEventListener('click', () => detailProvider && window.widget.connect(detailProvider));
$('provider-reset').addEventListener('click', () => {
  const prefix = `${detailProvider}:`;
  update({
    hiddenMetrics: (state.settings.hiddenMetrics || []).filter(key => !key.startsWith(prefix)),
    starredMetrics: (state.settings.starredMetrics || []).filter(key => !key.startsWith(prefix))
  });
});

for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (button) update({ [seg.dataset.setting]: button.dataset.value });
  });
}
for (const toggle of document.querySelectorAll('.switch[data-setting]')) {
  toggle.addEventListener('click', () => update({ [toggle.dataset.setting]: toggle.getAttribute('aria-checked') !== 'true' }));
}
$('refresh-seconds').addEventListener('change', event => update({ refreshSeconds: Number(event.target.value) }));
$('shortcut').addEventListener('click', () => {
  if (recordingShortcut) return stopRecording();
  recordingShortcut = true;
  $('shortcut').classList.add('is-recording');
  $('shortcut').textContent = 'Press keys…';
  $('shortcut-help').textContent = 'Esc to cancel · Backspace to clear';
  void window.widget.suspendShortcut(true);
});
$('mobile-pairing').addEventListener('click', () => window.widget.openMobilePairing());
$('quit').addEventListener('click', () => window.widget.quit());
$('check-update').addEventListener('click', async () => {
  const button = $('check-update');
  button.disabled = true;
  $('update-status').textContent = 'Checking for updates…';
  try {
    const result = await window.widget.checkForUpdate();
    $('update-status').textContent = result.available
      ? `Throttle ${result.latest} is available · opening download`
      : `You’re on the latest version`;
  } catch {
    $('update-status').textContent = 'Update check failed · try again later';
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('keydown', event => {
  if (recordingShortcut) {
    void handleShortcutKey(event);
    return;
  }
  if (event.key === 'Escape') {
    if (menuContext) hideMenu();
    else if (view !== 'dashboard') back();
    else window.widget.hide();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    window.widget.refresh();
  } else if (event.ctrlKey && event.key === ',') {
    event.preventDefault();
    setView(view === 'settings' ? 'dashboard' : 'settings');
  }
});

window.widget.onUsageState(next => {
  state = next;
  renderAll();
});

window.widget.onShown(({ edge, view: requested } = {}) => {
  const app = $('app');
  app.dataset.edge = edge || 'bottom';
  if (requested && requested !== view) {
    if (requested === 'provider') return;
    setView(requested);
  }
  renderAll();
  app.classList.remove('is-entering');
  app.classList.add('pre-enter');
  void app.offsetWidth;
  requestAnimationFrame(() => {
    app.classList.remove('pre-enter');
    app.classList.add('is-entering');
  });
});

window.widget.onHidden(() => {
  if (recordingShortcut) stopRecording();
  hideMenu();
  hideTip();
  setView('dashboard');
});

setInterval(() => {
  renderDashboard();
  renderFooter();
  renderTray();
}, TICK_MS);

setView('dashboard');
window.widget.getState().then(next => {
  state = next;
  renderAll();
});
