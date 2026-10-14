const $ = id => document.getElementById(id);
const model = window.usageModel;
const { PROVIDER_META } = model;

const PROVIDER_IDS = ['claude', 'codex', 'cursor', 'antigravity'];
const MAX_STARRED = 2;
const MAX_VIEW_HEIGHT = 640;
const TICK_MS = 15 * 1000;
const TIP_DELAY_MS = 380;
const UNDO_LIMIT = 30;
const LAYOUT_KEYS = [
  'providerOrder', 'showClaude', 'showCodex', 'showCursor', 'showAntigravity',
  'hiddenMetrics', 'starredMetrics', 'placements', 'taskbarHiddenProviders'
];
const CONNECT_LABELS = {
  claude: 'Sign in to Claude',
  codex: 'Sign in to Codex',
  cursor: 'Open Cursor',
  antigravity: 'Open Antigravity CLI'
};
const SPEND_METRICS = { cost: 'Cost', rate: 'Cost/MTok', tokens: 'Tokens' };
const SPEND_PERIOD_LABELS = { today: 'today', yesterday: 'yesterday', last30: 'in the last 30 days' };
const DEPTH = { welcome: 0, dashboard: 0, customize: 1, settings: 1, about: 1, provider: 2 };
const ICONS = {
  flame: '<svg viewBox="0 0 24 24" class="ico-fill"><path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2 .8-3.6 2-4.8.2 1.6 1 2.8 2.2 3.3C10.6 8.6 11 5 12 2z"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  grip: '<svg viewBox="0 0 24 24" class="ico-fill"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>'
};

let state = { settings: {}, providers: {}, spend: {}, nextRefreshAt: null, version: '' };
let view = 'dashboard';
let detailProvider = null;
let menuOpen = false;
let tipTimer = null;
let toastTimer = null;
let sizeFrame = 0;
let recordingShortcut = false;
let hoveredSlice = null;
let welcomeChoices = null;
let resetArmed = false;
const undoStack = [];

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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function logoTile(id, size = '') {
  const tile = el('span', `logo-tile logo-${id} ${size}`.trim());
  const glyph = el('span', 'logo-glyph');
  glyph.style.setProperty('--logo', `url("assets/${id}.svg")`);
  tile.append(glyph);
  tile.setAttribute('aria-hidden', 'true');
  return tile;
}

function layoutSnapshot() {
  return Object.fromEntries(LAYOUT_KEYS.map(key => [key, structuredClone(state.settings[key])]));
}

function update(patch) {
  if (LAYOUT_KEYS.some(key => key in patch)) {
    undoStack.push(layoutSnapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  state.settings = { ...state.settings, ...patch };
  renderAll();
  return window.widget.updateSettings(patch);
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) return showToast('Nothing to undo');
  state.settings = { ...state.settings, ...previous };
  renderAll();
  void window.widget.updateSettings(previous);
  showToast('Undid last change');
}

function toggleListValue(list, value, on) {
  const next = (list || []).filter(item => item !== value);
  if (on) next.push(value);
  return next;
}

function toggleStar(id, key) {
  const starred = state.settings.starredMetrics || [];
  if (starred.includes(key)) return update({ starredMetrics: starred.filter(item => item !== key) });
  const mine = starred.filter(item => item.startsWith(`${id}:`));
  const drop = mine.length >= MAX_STARRED ? mine[0] : null;
  return update({ starredMetrics: [...starred.filter(item => item !== drop), key] });
}

function setPlacement(key, placement) {
  update({ placements: { ...(state.settings.placements || {}), [key]: placement } });
}

function catalogFor(id) {
  return model.metricCatalog(id, state.providers[id]?.data).map(entry => {
    const key = model.metricKey(id, entry.id);
    return { ...entry, key, placement: model.placementFor(key, entry, state.settings) };
  });
}

// ---------- Total spend ----------

function spendSummary(id) {
  return state.spend?.[id]?.summary || null;
}

function anySpend() {
  return visibleProviders().some(id => spendSummary(id));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CIRCUMFERENCE = 2 * Math.PI * 46;

function renderSpendCard() {
  const card = $('spend-card');
  const show = state.settings.showTotalSpend !== false && anySpend();
  card.hidden = !show;
  if (!show) return;
  const metric = state.settings.spendMetric || 'cost';
  const period = state.settings.spendPeriod || 'last30';
  $('spend-metric-label').textContent = SPEND_METRICS[metric];
  const total = model.totalSpend(state.spend, state.settings, period, metric);
  const weights = total.slices.map(slice => (metric === 'tokens' ? slice.period.tokens : slice.period.cost));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);

  const group = $('donut-slices');
  const existing = new Map([...group.children].map(node => [node.dataset.provider, node]));
  const gap = total.slices.length > 1 ? 2.2 : 0;
  let offset = 0;
  const seen = new Set();
  total.slices.forEach((slice, index) => {
    const fraction = weightSum ? weights[index] / weightSum : 0;
    const length = Math.max(0, fraction * CIRCUMFERENCE - gap);
    let circle = existing.get(slice.provider);
    if (!circle) {
      circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', '60');
      circle.setAttribute('cy', '60');
      circle.setAttribute('r', '46');
      circle.setAttribute('class', 'donut-slice');
      circle.dataset.provider = slice.provider;
      circle.style.stroke = PROVIDER_META[slice.provider].color;
      circle.style.strokeDasharray = `0 ${CIRCUMFERENCE}`;
      circle.addEventListener('mouseenter', () => setHoveredSlice(slice.provider));
      circle.addEventListener('mouseleave', () => setHoveredSlice(null));
      group.append(circle);
      void circle.getBoundingClientRect();
    }
    seen.add(slice.provider);
    circle.style.strokeDasharray = `${length} ${CIRCUMFERENCE - length}`;
    circle.style.strokeDashoffset = String(-offset);
    circle.classList.toggle('is-dim', Boolean(hoveredSlice && hoveredSlice !== slice.provider));
    offset += fraction * CIRCUMFERENCE;
  });
  for (const [provider, node] of existing) if (!seen.has(provider)) node.remove();

  const focus = hoveredSlice && total.slices.find(slice => slice.provider === hoveredSlice);
  const centerValue = focus ? focus.value : total.value;
  $('donut-value').textContent = weightSum || centerValue ? model.formatSpendValue(centerValue, metric) : '—';
  $('donut-unit').textContent = focus ? PROVIDER_META[focus.provider].name : (weightSum ? model.spendUnit(metric) : `no usage ${period === 'last30' ? 'yet' : SPEND_PERIOD_LABELS[period]}`);
  $('donut-value').dataset.tip = weightSum ? model.formatSpendValue(centerValue, metric, true) : '';

  const legend = $('spend-legend');
  legend.replaceChildren(...total.slices.map(slice => {
    const share = weightSum ? Math.round(((metric === 'tokens' ? slice.period.tokens : slice.period.cost) / weightSum) * 100) : 0;
    const row = el('li', `legend-row${hoveredSlice === slice.provider ? ' is-hot' : ''}`);
    row.dataset.provider = slice.provider;
    row.style.setProperty('--dot', PROVIDER_META[slice.provider].color);
    row.append(
      el('span', 'legend-dot'),
      el('span', 'legend-name', PROVIDER_META[slice.provider].name),
      el('span', 'legend-share', `${share}%`),
      el('span', 'legend-value', escapeHtml(model.formatSpendValue(slice.value, metric)))
    );
    row.dataset.tip = breakdownTip(slice.period);
    row.addEventListener('mouseenter', () => setHoveredSlice(slice.provider));
    row.addEventListener('mouseleave', () => setHoveredSlice(null));
    return row;
  }));
  if (!total.slices.length) legend.append(el('li', 'legend-empty', `No spend ${SPEND_PERIOD_LABELS[period]}`));

  const providers = visibleProviders().filter(id => model.SPEND_PROVIDERS.includes(id)).map(id => PROVIDER_META[id].name);
  const unpriced = visibleProviders().flatMap(id => spendSummary(id)?.unpriced || []);
  $('spend-info').dataset.tip = [
    `Spend across ${providers.join(', ')}.`,
    'Claude and Codex are estimated from local logs at API list prices. Cursor shows the cost Cursor reports.',
    unpriced.length ? `No price for: ${unpriced.slice(0, 4).join(', ')}${unpriced.length > 4 ? '…' : ''}` : ''
  ].filter(Boolean).join('\n');
  syncSeg(card.querySelector('.seg'));
}

function setHoveredSlice(provider) {
  if (hoveredSlice === provider) return;
  hoveredSlice = provider;
  renderSpendCard();
}

function breakdownTip(period) {
  if (!period?.models?.length) return '';
  const lines = period.models.slice(0, 6).map(m => `${m.name}  ${model.formatMoney(m.cost)} · ${model.formatTokens(m.tokens)}`);
  if (period.models.length > 6) lines.push(`+${period.models.length - 6} more`);
  return lines.join('\n');
}

// ---------- Provider sections ----------

function ensureSection(id) {
  const host = $('cards');
  let section = host.querySelector(`.provider-section[data-provider="${id}"]`);
  if (section) return section;
  section = el('section', 'provider-section');
  section.dataset.provider = id;
  section.style.setProperty('--brand', PROVIDER_META[id].color);

  const head = el('header', 'section-head');
  const grip = el('span', 'grip', ICONS.grip);
  grip.title = 'Drag to reorder';
  grip.addEventListener('pointerdown', event => startDrag(event, section, host, '.provider-section'));
  head.append(grip, logoTile(id, 'mini'), el('strong', 'section-name', PROVIDER_META[id].name), el('span', 'plan'));
  const status = el('span', 'section-status');
  const warn = el('span', 'warn-badge', ICONS.warn);
  warn.hidden = true;
  status.append(el('span', 'spinner'), warn);
  head.append(status);

  const card = el('article', 'card');
  const notice = el('div', 'notice');
  notice.hidden = true;
  const more = el('div', 'card-more');
  const moreInner = el('div', 'card-more-inner');
  moreInner.append(el('div', 'rows more-rows'), el('div', 'meta'), el('div', 'links'));
  more.append(moreInner);
  const caret = el('button', 'caret', `<span class="more-count"></span>${ICONS.caret}`);
  caret.type = 'button';
  caret.setAttribute('aria-label', `More ${PROVIDER_META[id].name} details`);
  caret.addEventListener('click', () => {
    const open = !(state.settings.expandedProviders || []).includes(id);
    update({ expandedProviders: toggleListValue(state.settings.expandedProviders, id, open) });
  });
  card.append(el('div', 'rows main-rows'), notice, more, caret);
  section.append(head, card);
  host.append(section);
  return section;
}

function ensureRow(host, entry, className, build) {
  let row = host.querySelector(`[data-key="${CSS.escape(entry.key)}"]`);
  if (row && !row.classList.contains(className)) {
    row.remove();
    row = null;
  }
  if (row) return row;
  row = build();
  row.classList.add(className);
  row.dataset.key = entry.key;
  for (const button of row.querySelectorAll('button')) button.type = 'button';
  return row;
}

function buildMeterRow() {
  const row = el('div', 'row metric');
  const top = el('div', 'metric-top');
  top.append(el('span', 'metric-name'), el('span', 'star-mark', ICONS.star), el('button', 'metric-note'));
  const bar = el('div', 'bar');
  bar.append(el('span', 'fill'), el('span', 'tick'));
  const bottom = el('div', 'metric-bottom');
  bottom.append(el('button', 'metric-value'), el('button', 'metric-reset'));
  row.append(top, bar, bottom);
  return row;
}

function renderMeterRow(row, id, m) {
  const mode = state.settings.valueMode || 'left';
  const resetMode = state.settings.resetMode || 'relative';
  const clock = state.settings.clock || 'system';
  const pace = model.computePace(m, nowSec());
  const key = model.metricKey(id, m.id);
  const percent = model.displayPercent(m, mode);
  const showPacing = pace && (pace.tone !== 'ok' || state.settings.alwaysShowPacing);

  row.dataset.tone = pace?.tone || 'ok';
  row.querySelector('.metric-name').textContent = m.label;
  row.querySelector('.star-mark').hidden = !(state.settings.starredMetrics || []).includes(key);

  const note = row.querySelector('.metric-note');
  const noteText = showPacing ? model.formatPaceNote(pace, resetMode, nowSec(), clock) : '';
  const flame = pace && ['over', 'reached', 'at-limit'].includes(pace.verdict);
  note.innerHTML = noteText ? `${flame ? ICONS.flame : ''}<span>${noteText}</span>` : '';
  note.hidden = !noteText;
  note.dataset.tip = model.formatPaceDetail(pace);
  note.classList.toggle('is-clickable', pace?.verdict === 'over' && Boolean(pace.runOutAt));

  row.querySelector('.fill').style.width = `${percent}%`;
  const tick = row.querySelector('.tick');
  const tickAt = pace?.evenPace != null && m.usedPercent > 0 && showPacing
    ? (mode === 'used' ? pace.evenPace : 100 - pace.evenPace)
    : null;
  tick.hidden = tickAt == null;
  if (tickAt != null) tick.style.left = `${tickAt}%`;
  row.querySelector('.bar').dataset.tip = model.formatPaceDetail(pace);

  const value = row.querySelector('.metric-value');
  if (!value.dataset.hovering) value.textContent = model.formatValue(m, mode);
  value.dataset.main = model.formatValue(m, mode);
  value.dataset.alt = model.formatValue(m, mode === 'used' ? 'left' : 'used');
  value.dataset.tip = m.detail || '';

  const reset = row.querySelector('.metric-reset');
  const resetText = model.formatReset(m.resetsAt, resetMode, nowSec(), clock);
  if (!reset.dataset.hovering) reset.textContent = resetText;
  reset.dataset.main = resetText;
  reset.dataset.alt = model.formatReset(m.resetsAt, resetMode === 'relative' ? 'absolute' : 'relative', nowSec(), clock);
  reset.hidden = !m.resetsAt;
}

function buildSpendRow() {
  const row = el('div', 'row spend-row');
  row.append(el('span', 'spend-label'), el('span', 'spend-value'));
  return row;
}

function renderSpendRow(row, entry, summary) {
  const period = summary?.[entry.id];
  row.querySelector('.spend-label').textContent = entry.label;
  const value = row.querySelector('.spend-value');
  value.textContent = model.formatSpendRow(period);
  value.classList.toggle('is-empty', !period);
  value.dataset.tip = breakdownTip(period);
}

function buildTrendRow() {
  const row = el('div', 'row trend-row');
  const head = el('div', 'trend-head');
  head.append(el('span', 'spend-label', 'Usage Trend'), el('span', 'trend-note'));
  row.append(head, el('div', 'trend-bars'));
  return row;
}

function renderTrendRow(row, id, summary) {
  const trend = summary?.trend || [];
  const max = Math.max(1, ...trend.map(day => day.tokens));
  const bars = row.querySelector('.trend-bars');
  while (bars.children.length < trend.length) bars.append(el('span', 'trend-bar', '<i></i>'));
  while (bars.children.length > trend.length) bars.lastChild.remove();
  trend.forEach((day, index) => {
    const bar = bars.children[index];
    const height = day.tokens ? Math.max(6, (day.tokens / max) * 100) : 0;
    bar.firstChild.style.height = `${height}%`;
    bar.classList.toggle('is-today', index === trend.length - 1);
    const date = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    bar.dataset.tip = day.tokens
      ? `${date} · ${model.formatMoney(day.cost)} · ${model.formatTokens(day.tokens)} tokens`
      : `${date} · no usage`;
  });
  const source = state.spend?.[id]?.source === 'cursor' ? 'Reported by Cursor' : 'Estimated at API rates';
  row.querySelector('.trend-note').textContent = `30 days · ${source}`;
}

function renderRows(host, id, entries) {
  const summary = spendSummary(id);
  const metrics = model.metricsForProvider(id, state.providers[id]?.data);
  const rows = [];
  for (const entry of entries) {
    if (entry.kind === 'quota') {
      const m = metrics.find(item => item.id === entry.id);
      if (!m) continue;
      const row = ensureRow(host, entry, 'metric', buildMeterRow);
      renderMeterRow(row, id, m);
      rows.push(row);
    } else if (entry.kind === 'spend') {
      if (!summary) continue;
      const row = ensureRow(host, entry, 'spend-row', buildSpendRow);
      renderSpendRow(row, entry, summary);
      rows.push(row);
    } else if (entry.kind === 'trend') {
      if (!summary) continue;
      const row = ensureRow(host, entry, 'trend-row', buildTrendRow);
      renderTrendRow(row, id, summary);
      rows.push(row);
    }
  }
  const keep = new Set(rows);
  for (const child of [...host.children]) if (!keep.has(child)) child.remove();
  rows.forEach((row, index) => {
    if (host.children[index] !== row) host.insertBefore(row, host.children[index] || null);
  });
  host.hidden = !rows.length;
  return rows.length;
}

function renderNotice(card, id, provider) {
  const notice = card.querySelector('.notice');
  if (provider?.data) {
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

function renderSection(id) {
  const section = ensureSection(id);
  const card = section.querySelector('.card');
  const provider = state.providers[id];
  const data = provider?.data;
  const expanded = (state.settings.expandedProviders || []).includes(id);

  section.querySelector('.plan').textContent = data?.planType ? String(data.planType) : '';
  section.classList.toggle('is-refreshing', Boolean(provider?.refreshing));
  section.classList.toggle('is-expanded', expanded);
  card.querySelector('.caret').setAttribute('aria-expanded', String(expanded));
  const warn = section.querySelector('.warn-badge');
  warn.hidden = !(data && provider.error);
  warn.dataset.tip = provider?.error || '';

  const hidden = new Set(state.settings.hiddenMetrics || []);
  const catalog = catalogFor(id).filter(entry => !hidden.has(entry.key));
  const mainHost = card.querySelector('.main-rows');
  const shown = renderRows(mainHost, id, catalog.filter(entry => entry.placement === 'always'));
  const extra = renderRows(card.querySelector('.more-rows'), id, catalog.filter(entry => entry.placement === 'demand'));
  card.querySelector('.more-count').textContent = extra && !expanded ? `${extra} more` : '';
  if (data && !shown && !extra) {
    mainHost.hidden = false;
    mainHost.replaceChildren(el('p', 'notice-copy', 'All metrics hidden. Right-click to customize.'));
  }
  renderNotice(card, id, provider);

  const parts = [];
  if (data?.account) parts.push(escapeHtml(data.account));
  if (provider?.updatedAt) parts.push(`Updated ${model.formatAgo(provider.updatedAt)}`);
  if (provider?.error && data) parts.push(`<span class="meta-error">${escapeHtml(provider.error)}</span>`);
  card.querySelector('.meta').innerHTML = parts.join(' · ') || 'Waiting for first refresh';

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
  renderSpendCard();
  const host = $('cards');
  if (host.dataset.dragging) return;
  const order = visibleProviders();
  for (const section of host.querySelectorAll('.provider-section')) {
    if (!order.includes(section.dataset.provider)) section.remove();
  }
  order.forEach((id, index) => {
    renderSection(id);
    const section = host.querySelector(`.provider-section[data-provider="${id}"]`);
    if (host.children[index] !== section) host.insertBefore(section, host.children[index] || null);
  });
  $('empty').hidden = order.length > 0;
}

// ---------- Welcome ----------

function renderWelcome() {
  const host = $('welcome-list');
  welcomeChoices ||= Object.fromEntries(PROVIDER_IDS.map(id => [id, state.detected ? Boolean(state.detected[id]) : true]));
  host.replaceChildren(...PROVIDER_IDS.map(id => {
    const row = el('div', 'list-row welcome-row');
    const copy = el('span', 'row-copy');
    copy.append(el('span', 'row-title', PROVIDER_META[id].name), el('span', 'row-sub', state.detected?.[id] ? 'Found on this PC' : 'Not found'));
    const main = el('span', 'row-main');
    main.append(logoTile(id, 'small'), copy);
    row.append(main, switchButton(welcomeChoices[id], `Track ${PROVIDER_META[id].name}`, on => { welcomeChoices[id] = on; }));
    return row;
  }));
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
      grip.addEventListener('pointerdown', event => startDrag(event, row, host, '.provider-row'));
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
    const catalog = catalogFor(id);
    const hidden = state.settings.hiddenMetrics || [];
    const shown = catalog.filter(entry => !hidden.includes(entry.key));
    const always = shown.filter(entry => entry.placement === 'always').length;
    row.classList.toggle('is-off', !enabled);
    row.querySelector('.row-sub').textContent = `${always} always visible · ${shown.length - always} on demand`;
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

function startDrag(event, row, host, selector) {
  event.preventDefault();
  const rows = () => [...host.querySelectorAll(selector)];
  const grabOffset = event.clientY - row.getBoundingClientRect().top;
  let translate = 0;
  host.dataset.dragging = '1';
  row.classList.add('is-dragging');
  row.setPointerCapture(event.pointerId);
  hideTip();

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
    const moved = rows().map(r => r.dataset.provider);
    const full = state.settings.providerOrder || PROVIDER_IDS;
    const queue = [...moved];
    const order = full.map(id => (moved.includes(id) ? queue.shift() : id));
    if (order.join() !== full.join()) update({ providerOrder: order });
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
  $('provider-title').textContent = PROVIDER_META[id].name;
  const hero = $('provider-hero');
  hero.replaceChildren(logoTile(id, 'large'));
  const copy = el('div', 'hero-copy');
  const status = provider?.data
    ? (provider.error ? `Showing last values · ${provider.error}` : `Connected${provider.data.planType ? ` · ${provider.data.planType}` : ''}`)
    : provider?.status === 'disconnected' ? 'Not signed in' : provider?.error || 'Waiting for first refresh';
  copy.append(el('strong', '', PROVIDER_META[id].name), el('span', '', escapeHtml(status)));
  hero.append(copy, switchButton(isEnabled(id), `Show ${PROVIDER_META[id].name}`, on => update({ [settingKey(id)]: on })));

  const taskbar = $('provider-taskbar');
  taskbar.replaceChildren();
  const taskbarRow = el('div', 'list-row metric-setting');
  const onTaskbar = !(state.settings.taskbarHiddenProviders || []).includes(id);
  taskbarRow.append(
    el('span', 'row-title', 'Show on taskbar'),
    switchButton(onTaskbar, 'Show on taskbar', on => update({ taskbarHiddenProviders: toggleListValue(state.settings.taskbarHiddenProviders, id, !on) }))
  );
  taskbar.append(taskbarRow);
  taskbar.hidden = !state.stripSupported || state.settings.taskbarStyle === 'off';

  const catalog = catalogFor(id);
  const quota = model.metricsForProvider(id, provider?.data);
  const taskbarKeys = new Set(model.starredFor(id, quota, state.settings).map(m => model.metricKey(id, m.id)));
  for (const placement of ['always', 'demand']) {
    const host = $(`provider-${placement}`);
    const entries = catalog.filter(entry => entry.placement === placement);
    host.replaceChildren(...entries.map(entry => metricSettingRow(id, entry, taskbarKeys)));
    if (!entries.length) host.append(el('div', 'list-empty', placement === 'always' ? 'Nothing pinned here' : 'Nothing tucked away'));
  }
  $('provider-metrics-empty').hidden = catalog.length > 0;
  $('provider-connect').textContent = CONNECT_LABELS[id];
}

function metricSettingRow(id, entry, taskbarKeys) {
  const row = el('div', 'list-row metric-setting');
  row.dataset.key = entry.key;
  const hidden = (state.settings.hiddenMetrics || []).includes(entry.key);
  row.classList.toggle('is-off', hidden);
  const title = el('span', 'row-title', escapeHtml(entry.label));
  if (entry.kind !== 'quota') title.append(el('span', 'row-kind', entry.kind === 'trend' ? 'chart' : 'spend'));
  row.append(title);
  if (entry.kind === 'quota') {
    const explicit = (state.settings.starredMetrics || []).includes(entry.key);
    const star = el('button', `star-btn${explicit ? ' is-on' : taskbarKeys.has(entry.key) ? ' is-auto' : ''}`, ICONS.star);
    star.type = 'button';
    star.dataset.tip = explicit ? 'On the taskbar · click to unstar' : taskbarKeys.has(entry.key) ? 'On the taskbar by default · click to star' : 'Show on the taskbar';
    star.addEventListener('click', () => toggleStar(id, entry.key));
    row.append(star);
  }
  const move = el('button', 'star-btn', entry.placement === 'always' ? ICONS.down : ICONS.up);
  move.type = 'button';
  move.dataset.tip = entry.placement === 'always' ? 'Move to On demand' : 'Move to Always visible';
  move.addEventListener('click', () => setPlacement(entry.key, entry.placement === 'always' ? 'demand' : 'always'));
  row.append(move, switchButton(!hidden, `Show ${entry.label}`, on => {
    update({ hiddenMetrics: toggleListValue(state.settings.hiddenMetrics, entry.key, !on) });
  }));
  return row;
}

// ---------- Settings ----------

function syncSeg(seg) {
  const value = state.settings[seg.dataset.setting];
  for (const button of seg.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  positionSegIndicator(seg);
}

function renderSettings() {
  const s = state.settings;
  for (const seg of document.querySelectorAll('#view-settings .seg')) syncSeg(seg);
  for (const toggle of document.querySelectorAll('.switch[data-setting]')) {
    toggle.setAttribute('aria-checked', String(Boolean(s[toggle.dataset.setting])));
  }
  const supported = state.stripSupported !== false;
  $('taskbar-field').classList.toggle('is-disabled', !supported);
  $('taskbar-help').textContent = supported ? 'Starred meters, next to the clock' : 'Not available on this taskbar';
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
  indicator.style.transform = `translateX(${active.offsetLeft - 2}px)`;
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

// ---------- Footer and tray ----------

function renderFooter() {
  const anyRefreshing = PROVIDER_IDS.some(id => state.providers[id]?.refreshing);
  $('next-update').classList.toggle('is-refreshing', anyRefreshing);
  if (anyRefreshing) {
    $('next-update-text').textContent = 'Updating…';
  } else if (state.nextRefreshAt) {
    const seconds = (state.nextRefreshAt - Date.now()) / 1000;
    $('next-update-text').textContent = seconds > 1 ? `Next update in ${model.formatDuration(seconds)}` : 'Updating soon';
  } else {
    $('next-update-text').textContent = 'Refresh now';
  }
  $('footer-brand').textContent = `Throttle ${state.version || ''}`.trim();
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
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, Math.min(h / 2, w / 2));
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
    state.settings.trayStyle, dark, mode,
    entries.map(entry => [entry.key, Math.round(entry.metric.usedPercent), entry.pace?.tone])
  ]);
  if (signature === lastTraySignature) return;
  lastTraySignature = signature;
  const images = state.settings.trayStyle === 'logo' || !entries.length
    ? []
    : [[1, 16], [1.25, 20], [1.5, 24], [2, 32]].map(([scale, size]) => ({ scale, dataUrl: drawTrayImage(entries, size, dark) }));
  window.widget.setTrayImage({ images, tooltip });
}

function applyAppearance() {
  const root = document.documentElement;
  const s = state.settings;
  root.dataset.theme = s.theme || 'system';
  root.classList.toggle('density-compact', s.density === 'compact');
  root.classList.toggle('reduce-motion', Boolean(s.reduceAnimations));
  root.classList.toggle('more-transparent', Boolean(s.transparency));
}

function renderAll() {
  applyAppearance();
  if (!state.settings.welcomed && state.settings.welcomed !== undefined && view === 'dashboard') setView('welcome');
  if (view === 'welcome') renderWelcome();
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
  $('app').dataset.view = next;
  for (const section of document.querySelectorAll('.view')) {
    const name = section.id.replace('view-', '');
    const relative = DEPTH[name] - DEPTH[next];
    section.dataset.pos = name === next ? 'center' : relative < 0 || (relative === 0 && name === 'welcome') ? 'left' : 'right';
    section.toggleAttribute('inert', name !== next);
  }
  if (next === 'customize') renderCustomize();
  if (next === 'welcome') renderWelcome();
  if (next === 'settings') requestAnimationFrame(() => document.querySelectorAll('#view-settings .seg').forEach(positionSegIndicator));
  if (previous !== next) $(`view-${next}`).querySelector('.view-inner').scrollTop = 0;
  resetArmed = false;
  $('reset-all').textContent = 'Reset';
  hideMenu();
  hideTip();
  scheduleSize();
}

function back() {
  if (view === 'provider') setView('customize');
  else if (view !== 'dashboard' && view !== 'welcome') setView('dashboard');
}

function scheduleSize() {
  cancelAnimationFrame(sizeFrame);
  sizeFrame = requestAnimationFrame(applySize);
}

function applySize() {
  const inner = $(`view-${view}`).querySelector('.view-inner');
  const maxHeight = Math.min(MAX_VIEW_HEIGHT, window.screen.availHeight - 140);
  document.documentElement.style.setProperty('--max-view', `${maxHeight}px`);
  const contentHeight = Math.min(inner.scrollHeight, maxHeight);
  $('viewport').style.height = `${contentHeight}px`;
  window.widget.reportSize(contentHeight + $('footer').offsetHeight);
}

const resizeObserver = new ResizeObserver(scheduleSize);
for (const inner of document.querySelectorAll('.view-inner')) {
  for (const child of inner.children) resizeObserver.observe(child);
  new MutationObserver(() => {
    for (const child of inner.children) resizeObserver.observe(child);
    scheduleSize();
  }).observe(inner, { childList: true });
}

// ---------- Menus, tips and toasts ----------

function showMenu(items, anchor, { align = 'left', above = false } = {}) {
  const menu = $('menu');
  menu.replaceChildren();
  for (const item of items) {
    if (item === 'separator') {
      menu.append(el('div', 'menu-sep'));
      continue;
    }
    const button = el('button', `menu-item${item.danger ? ' is-danger' : ''}${item.submenu ? ' has-sub' : ''}`);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.append(el('span', 'menu-check', item.checked ? ICONS.check : ''), el('span', 'menu-label', escapeHtml(item.label)));
    if (item.hint) button.append(el('span', 'menu-hint', escapeHtml(item.hint)));
    if (item.submenu) button.append(el('span', 'menu-hint', ICONS.chevron));
    button.disabled = Boolean(item.disabled);
    button.addEventListener('click', () => {
      if (item.submenu) {
        showMenu([{ label: 'Back', action: () => showMenu(items, anchor, { align, above }), keepOpen: true }, 'separator', ...item.submenu], anchor, { align, above });
        return;
      }
      if (!item.keepOpen) hideMenu();
      item.action();
    });
    menu.append(button);
  }
  menu.hidden = false;
  menu.classList.remove('is-open');
  const rect = menu.getBoundingClientRect();
  let left = align === 'right' ? anchor.right - rect.width : anchor.left;
  let top = above ? anchor.top - rect.height - 6 : anchor.bottom + 4;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = `${align === 'right' ? 'right' : 'left'} ${above ? 'bottom' : 'top'}`;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menuOpen = true;
}

function pointAnchor(x, y) {
  return { left: x, right: x, top: y, bottom: y };
}

function hideMenu() {
  const menu = $('menu');
  menu.classList.remove('is-open');
  menu.hidden = true;
  menuOpen = false;
}

function providerMenuItems(id, key) {
  const name = PROVIDER_META[id].name;
  const items = [];
  if (key) {
    const entry = catalogFor(id).find(item => item.key === key);
    if (entry?.kind === 'quota') {
      const starred = (state.settings.starredMetrics || []).includes(key);
      items.push({ label: starred ? 'Unstar from taskbar' : 'Star for taskbar', action: () => toggleStar(id, key) });
    }
    if (entry) {
      items.push({
        label: entry.placement === 'always' ? 'Move to On demand' : 'Move to Always visible',
        action: () => setPlacement(key, entry.placement === 'always' ? 'demand' : 'always')
      });
    }
    items.push({ label: 'Hide', action: () => { update({ hiddenMetrics: toggleListValue(state.settings.hiddenMetrics, key, true) }); showToast('Hidden · Ctrl+Z to undo'); } }, 'separator');
  }
  items.push(
    { label: `Refresh ${name}`, action: () => window.widget.refresh(id) },
    { label: `Copy ${name} screenshot`, action: () => shareScreenshot(id) },
    { label: `Customize ${name}…`, action: () => openProvider(id) },
    'separator',
    { label: `Hide ${name}`, danger: true, action: () => { update({ [settingKey(id)]: false }); showToast(`${name} hidden · Ctrl+Z to undo`); } }
  );
  return items;
}

function optionsMenuItems() {
  const shareTargets = [];
  if (!$('spend-card').hidden) shareTargets.push({ label: 'Total Spend', action: () => shareScreenshot('spend') });
  for (const id of visibleProviders()) shareTargets.push({ label: PROVIDER_META[id].name, action: () => shareScreenshot(id) });
  return [
    { label: 'Customize…', hint: '', action: () => setView('customize') },
    { label: 'Settings…', hint: 'Ctrl+,', action: () => setView('settings') },
    { label: 'Share Screenshot', submenu: shareTargets.length ? shareTargets : [{ label: 'Nothing to share yet', disabled: true, action: () => {} }] },
    { label: 'Refresh All', hint: 'Ctrl+R', action: () => window.widget.refresh() },
    'separator',
    { label: 'Check for Updates…', action: () => { setView('about'); void checkUpdate(); } },
    { label: 'Report an Issue…', action: () => window.widget.reportIssue() },
    { label: 'About Throttle', action: () => setView('about') },
    'separator',
    { label: 'Quit Throttle', danger: true, action: () => window.widget.quit() }
  ];
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

function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-open'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-open');
    setTimeout(() => { toast.hidden = true; }, 220);
  }, 2200);
}

async function shareScreenshot(target) {
  if (view !== 'dashboard') setView('dashboard');
  const node = target === 'spend' ? $('spend-card') : $('cards').querySelector(`.provider-section[data-provider="${target}"]`);
  if (!node) return;
  node.scrollIntoView({ block: 'nearest' });
  const app = $('app');
  app.classList.add('is-capturing');
  node.classList.add('capture-target');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise(resolve => setTimeout(resolve, 120));
  const rect = node.getBoundingClientRect();
  const pad = 8;
  const clip = {
    x: rect.left - pad,
    y: rect.top - pad,
    width: rect.width + pad * 2,
    height: Math.min(rect.height, window.innerHeight - rect.top) + pad * 2
  };
  let ok = false;
  try {
    ok = await window.widget.copyScreenshot(clip);
  } finally {
    app.classList.remove('is-capturing');
    node.classList.remove('capture-target');
  }
  showToast(ok ? 'Screenshot copied to clipboard' : 'Couldn’t copy screenshot');
}

async function checkUpdate() {
  const button = $('check-update');
  button.disabled = true;
  $('update-status').textContent = 'Checking for updates…';
  try {
    const result = await window.widget.checkForUpdate();
    $('update-status').textContent = result.available
      ? `Throttle ${result.latest} is available · opening download`
      : 'You’re on the latest version';
  } catch {
    $('update-status').textContent = 'Update check failed · try again later';
  } finally {
    button.disabled = false;
  }
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
  const reset = event.target.closest('.metric-reset');
  if (reset || event.target.closest('.metric-note.is-clickable')) {
    if (reset) delete reset.dataset.hovering;
    update({ resetMode: state.settings.resetMode === 'absolute' ? 'relative' : 'absolute' });
  }
});

$('cards').addEventListener('contextmenu', event => {
  const section = event.target.closest('.provider-section');
  if (!section) return;
  event.preventDefault();
  const row = event.target.closest('.row');
  showMenu(providerMenuItems(section.dataset.provider, row?.dataset.key || null), pointAnchor(event.clientX, event.clientY));
});

document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('pointerdown', event => {
  if (menuOpen && !event.target.closest('#menu') && !event.target.closest('.pulldown')) hideMenu();
});

for (const button of document.querySelectorAll('.back-btn')) button.addEventListener('click', back);
for (const button of document.querySelectorAll('[data-url]')) button.addEventListener('click', () => window.widget.openExternal(button.dataset.url));

$('next-update').addEventListener('click', () => window.widget.refresh());
$('options-btn').addEventListener('click', event => {
  if (menuOpen) return hideMenu();
  showMenu(optionsMenuItems(), event.currentTarget.getBoundingClientRect(), { align: 'right', above: true });
});
$('spend-metric').addEventListener('click', event => {
  if (menuOpen) return hideMenu();
  const current = state.settings.spendMetric || 'cost';
  showMenu(Object.entries(SPEND_METRICS).map(([value, label]) => ({
    label: value === 'rate' ? 'Cost per MTok' : label,
    checked: value === current,
    action: () => update({ spendMetric: value })
  })), event.currentTarget.getBoundingClientRect());
});
$('spend-share').addEventListener('click', () => shareScreenshot('spend'));
$('empty-customize').addEventListener('click', () => setView('customize'));
$('provider-connect').addEventListener('click', () => detailProvider && window.widget.connect(detailProvider));
$('provider-reset').addEventListener('click', () => {
  const prefix = `${detailProvider}:`;
  const placements = Object.fromEntries(Object.entries(state.settings.placements || {}).filter(([key]) => !key.startsWith(prefix)));
  update({
    hiddenMetrics: (state.settings.hiddenMetrics || []).filter(key => !key.startsWith(prefix)),
    starredMetrics: (state.settings.starredMetrics || []).filter(key => !key.startsWith(prefix)),
    placements
  });
});
$('welcome-done').addEventListener('click', () => {
  const patch = { welcomed: true };
  for (const id of PROVIDER_IDS) patch[settingKey(id)] = welcomeChoices?.[id] !== false;
  update(patch);
  setView('dashboard');
  window.widget.refresh();
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
$('check-update').addEventListener('click', () => void checkUpdate());
$('about-issue').addEventListener('click', () => window.widget.reportIssue());
$('reset-all').addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = true;
    $('reset-all').textContent = 'Click to confirm';
    return;
  }
  resetArmed = false;
  $('reset-all').textContent = 'Reset';
  undoStack.length = 0;
  state.settings = await window.widget.resetSettings();
  renderAll();
  showToast('Settings reset');
});

document.addEventListener('keydown', event => {
  if (recordingShortcut) {
    void handleShortcutKey(event);
    return;
  }
  const key = event.key.toLowerCase();
  if (event.key === 'Escape') {
    if (menuOpen) hideMenu();
    else if (view !== 'dashboard' && view !== 'welcome') back();
    else window.widget.hide();
  } else if (event.ctrlKey && key === 'r') {
    event.preventDefault();
    window.widget.refresh();
  } else if (event.ctrlKey && key === 'z' && !event.target.closest('input, select')) {
    event.preventDefault();
    undo();
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
  if (requested && requested !== view && requested !== 'provider' && DEPTH[requested] != null) setView(requested);
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
  if (view !== 'welcome') setView('dashboard');
  $('view-dashboard').querySelector('.view-inner').scrollTop = 0;
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
