const model = window.usageModel;
const stripEl = document.getElementById('strip');
let lastWidth = 0;

function toneOf(entry) {
  return entry.pace && entry.pace.tone !== 'ok' ? entry.pace.tone : '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function render(state) {
  document.documentElement.classList.toggle('light', !state.taskbarDark);
  const settings = state.settings || {};
  const groups = model.stripEntries(state.providers, settings);
  const mode = settings.valueMode || 'left';
  const nodes = groups.map(group => {
    const node = el('span', 'group');
    const glyph = el('span', 'glyph');
    glyph.style.setProperty('--logo', `url("assets/${group.provider}.svg")`);
    node.append(glyph);
    if (settings.taskbarStyle === 'bars') {
      const bars = el('span', 'bars');
      for (const entry of group.metrics) {
        const fill = el('i', toneOf(entry));
        fill.style.width = `${model.displayPercent(entry.metric, mode)}%`;
        const bar = el('span', 'bar');
        bar.append(fill);
        bars.append(bar);
      }
      node.append(bars);
    } else {
      const values = el('span', group.metrics.length === 1 ? 'values single' : 'values');
      for (const entry of group.metrics) {
        values.append(el('span', `v ${toneOf(entry)}`.trim(), `${Math.round(model.displayPercent(entry.metric, mode))}%`));
      }
      node.append(values);
    }
    node.title = group.metrics
      .map(entry => `${model.PROVIDER_META[group.provider].name} ${entry.metric.label}: ${model.formatValue(entry.metric, mode)}`)
      .join('\n');
    return node;
  });
  stripEl.replaceChildren(...(nodes.length ? nodes : [el('span', 'empty', 'Throttle')]));
  reportWidth();
}

function reportWidth() {
  requestAnimationFrame(() => {
    const width = Math.ceil(stripEl.getBoundingClientRect().width) + 2;
    if (width !== lastWidth) {
      lastWidth = width;
      window.strip.reportWidth(width);
    }
  });
}

window.strip.onHover(inside => stripEl.classList.toggle('is-hover', inside));
window.strip.onState(render);
