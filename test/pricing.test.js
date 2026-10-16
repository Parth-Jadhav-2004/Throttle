const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PricingCatalog, normalizeSupplement, SUPPLEMENT_URL, LITELLM_URL } = require('../src/pricing');

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();
const bundled = require('../src/pricing-supplement.json');

// Cost of one million tokens of a single kind, which is the model's rate per million.
function cost(pricing, model, tokens) {
  return pricing.cost(model, tokens);
}

function pricing({ models = {}, supplement = null } = {}) {
  const catalog = new PricingCatalog({ fetchFn: null, now: () => NOW, supplement });
  catalog.models = models;
  catalog.resolved.clear();
  return catalog;
}

test('prices Cursor-native models no public catalog carries', () => {
  const catalog = pricing();
  assert.equal(cost(catalog, 'auto', { input: 1e6 }), 1.25);
  assert.equal(cost(catalog, 'auto', { cacheRead: 1e6 }), 0.25);
  assert.equal(cost(catalog, 'composer-2.5', { output: 1e6 }), 2.5);
  assert.equal(cost(catalog, 'composer-2.5-fast', { input: 1e6 }), 3);
  assert.equal(cost(catalog, 'grok-4.7', { input: 1e6 }), 2);
});

test('resolves provider model slugs through the supplement alias rules', () => {
  const catalog = pricing();
  // Cursor event list prices: Grok Bot default tracks 4.6 Fast, automation tracks 4.6 base.
  assert.equal(cost(catalog, 'grok-bot-default', { input: 1e6 }), 4);
  assert.equal(cost(catalog, 'grok-bot-default', { cacheRead: 1e6 }), 1);
  assert.equal(cost(catalog, 'grok-bot-automation', { output: 1e6 }), 6);
  assert.equal(cost(catalog, 'default', { input: 1e6 }), 1.25);
  assert.equal(cost(catalog, 'cursor-grok-4.7-high', { input: 1e6 }), 2);
  // Cursor Router names the routed model in prose instead of a slug.
  assert.equal(cost(catalog, 'Opus 5 (Auto Balanced)', { input: 1e6 }), 5);
  assert.equal(cost(catalog, 'Composer 2.5 Fast (Auto Balanced)', { input: 1e6 }), 3);
});

test('lets the supplement outrank the public catalog for the same model', () => {
  const catalog = pricing({ models: { 'composer-2.5': { input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 } } });
  assert.equal(cost(catalog, 'composer-2.5', { input: 1e6 }), 0.5);
});

test('aliases that name a public model still price from that catalog', () => {
  const catalog = pricing({ models: { 'claude-haiku-4-5': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 } } });
  assert.equal(cost(catalog, 'claude-4.5-haiku-thinking', { input: 1e6 }), 1);
});

test('applies a published fast multiplier to the base rate', () => {
  const catalog = pricing({ models: { 'gpt-5.5': { input_cost_per_token: 2e-6, output_cost_per_token: 20e-6 } } });
  assert.equal(cost(catalog, 'gpt-5.5', { input: 1e6 }), 2);
  assert.equal(cost(catalog, 'gpt-5.5-fast', { input: 1e6 }), 5);
  assert.equal(cost(catalog, 'gpt-5.5-high-fast', { output: 1e6 }), 50);
});

test('leaves a fast variant unpriced when no multiplier is published', () => {
  const catalog = pricing({ models: { 'mystery-9': { input_cost_per_token: 2e-6 } } });
  assert.equal(cost(catalog, 'mystery-9', { input: 1e6 }), 2);
  assert.equal(cost(catalog, 'mystery-9-fast', { input: 1e6 }), null);
});

test('prices a fast variant from its own catalog entry when there is one', () => {
  const catalog = pricing({ models: { 'gpt-6-astra-fast': { input_cost_per_token: 7e-6 } } });
  assert.equal(cost(catalog, 'gpt-6-astra-fast', { input: 1e6 }), 7);
  // Without its own entry the same model falls back to the base rate and its multiplier.
  assert.equal(cost(pricing(), 'gpt-6-astra-fast', { input: 1e6 }), 20);
});

test('ignores a supplement whose pricing is missing or malformed', () => {
  assert.deepEqual(normalizeSupplement({}).models, {});
  assert.deepEqual(normalizeSupplement({ pricing: { broken: { output_per_million: 3 } } }).models, {});
  const rules = normalizeSupplement({ alias_rules: [{ pattern: '(', canonical: 'x' }, { canonical: 'y' }, { pattern: '^z$', canonical: 'z' }] });
  assert.deepEqual(rules.aliases.map(rule => rule.canonical), ['z']);
});

function supplementResponse(raw, { etag, ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: name => (name.toLowerCase() === 'etag' ? etag ?? null : null) },
    json: async () => raw
  };
}

const PUBLISHED = {
  updated_at: '2026-10-12T00:00:00Z',
  pricing: { 'composer-9': { input_per_million: 1, output_per_million: 2 } },
  fast_multipliers: {},
  alias_rules: [{ pattern: '^brand-new$', canonical: 'composer-9' }]
};

test('adopts a newer published supplement and keeps it across a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-supplement-'));
  const pricing = new PricingCatalog({
    cacheDir: dir,
    now: () => NOW,
    fetchFn: async url => (url === SUPPLEMENT_URL ? supplementResponse(PUBLISHED, { etag: '"v1"' }) : supplementResponse({}))
  });
  assert.equal(await pricing.refresh(), true);
  assert.equal(cost(pricing, 'brand-new', { input: 1e6 }), 1);
  assert.equal(pricing.supplementEtag, '"v1"');

  const reloaded = new PricingCatalog({ cacheDir: dir, fetchFn: null });
  assert.equal(cost(reloaded, 'brand-new', { input: 1e6 }), 1);
  assert.ok(reloaded.supplement.updatedAt > Date.parse(bundled.updated_at));
  assert.equal(reloaded.supplementEtag, '"v1"');
});

test('keeps the bundled supplement when the published copy is older or unusable', async () => {
  const older = new PricingCatalog({ fetchFn: async url => (url === SUPPLEMENT_URL ? supplementResponse({ ...PUBLISHED, updated_at: '2020-01-01T00:00:00Z' }) : supplementResponse({})) });
  assert.equal(await older.refresh(), false);
  assert.equal(cost(older, 'auto', { input: 1e6 }), 1.25);
  assert.equal(cost(older, 'brand-new', { input: 1e6 }), null);

  const broken = new PricingCatalog({ fetchFn: async () => supplementResponse({ updated_at: '2026-10-12T00:00:00Z', pricing: {} }) });
  assert.equal(await broken.refresh(), false);
  assert.equal(cost(broken, 'auto', { input: 1e6 }), 1.25);
});

test('revalidates the published supplement with its etag', async () => {
  const seen = [];
  let call = 0;
  const pricing = new PricingCatalog({
    now: () => NOW,
    fetchFn: async (url, options = {}) => {
      if (url !== SUPPLEMENT_URL) return supplementResponse({});
      seen.push(options.headers?.['If-None-Match'] ?? null);
      call += 1;
      return call === 1 ? supplementResponse(PUBLISHED, { etag: '"v2"' }) : supplementResponse(null, { ok: false, status: 304 });
    }
  });
  assert.equal(await pricing.refresh({ force: true }), true);
  assert.equal(await pricing.refresh({ force: true }), false);
  assert.deepEqual(seen, [null, '"v2"']);
  assert.equal(cost(pricing, 'brand-new', { input: 1e6 }), 1);
});

test('caches only what it downloaded, not the bundled snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-pricing-cache-'));
  const pricing = new PricingCatalog({
    cacheDir: dir,
    now: () => NOW,
    fetchFn: async url => (url === LITELLM_URL
      ? supplementResponse({ 'claude-new-9': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } })
      : supplementResponse(PUBLISHED))
  });
  assert.equal(await pricing.refresh(), true);
  const cache = JSON.parse(fs.readFileSync(path.join(dir, 'pricing-cache.json'), 'utf8'));
  assert.deepEqual(Object.keys(cache.models), ['claude-new-9']);
  assert.equal(cache.supplement.raw.updated_at, PUBLISHED.updated_at);

  const reloaded = new PricingCatalog({ cacheDir: dir, fetchFn: null });
  assert.equal(cost(reloaded, 'claude-new-9', { output: 1e6 }), 2);
  assert.equal(cost(reloaded, 'brand-new', { input: 1e6 }), 1);
});

test('does not carry a bundled supplement copy into the cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-pricing-bundled-'));
  const pricing = new PricingCatalog({
    cacheDir: dir,
    now: () => NOW,
    fetchFn: async url => (url === LITELLM_URL
      ? supplementResponse({ 'claude-new-9': { input_cost_per_token: 1e-6 } })
      : supplementResponse({ ...PUBLISHED, updated_at: '2020-01-01T00:00:00Z' }))
  });
  await pricing.refresh();
  const cache = JSON.parse(fs.readFileSync(path.join(dir, 'pricing-cache.json'), 'utf8'));
  assert.equal(cache.supplement.raw, null);
  const reloaded = new PricingCatalog({ cacheDir: dir, fetchFn: null });
  assert.equal(cost(reloaded, 'auto', { input: 1e6 }), 1.25);
});
