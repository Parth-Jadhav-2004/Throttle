const fs = require('node:fs');
const path = require('node:path');

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
// OpenUsage publishes its pricing supplement to GitHub Pages on every change, so a correction for
// a Cursor-native model reaches installed apps without a release. Point this at your own copy to
// stop depending on theirs.
const SUPPLEMENT_URL = 'https://robinebers.github.io/openusage/pricing_supplement.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const SUPPLEMENT_REFRESH_MS = 60 * 60 * 1000;
const PRICE_FIELD = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost|cache_creation_input_token_cost_above_1hr)(_above_(200|272)k_tokens)?$/;
const MODEL_PREFIX = /^(claude|gpt|o\d|codex|gemini|grok|composer|deepseek|kimi|glm|qwen)/;
const FAST_SUFFIX = /-fast$/;

function reduceCatalog(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (key.includes('/') || !value || typeof value !== 'object' || !value.input_cost_per_token) continue;
    if (!MODEL_PREFIX.test(key)) continue;
    const entry = {};
    for (const [field, number] of Object.entries(value)) {
      if (PRICE_FIELD.test(field) && typeof number === 'number') entry[field] = number;
    }
    out[key] = entry;
  }
  return out;
}

function candidateKeys(model) {
  const base = String(model || '').trim().toLowerCase()
    .replace(/^(anthropic|openai|google|xai|azure|vertex_ai|bedrock)[/.:]/, '')
    .replace(/\[.*\]$/, '');
  const keys = [base];
  const undated = base.replace(/-\d{8}$/, '').replace(/@\d{8}$/, '');
  keys.push(undated);
  for (const key of [base, undated]) {
    keys.push(key.replace(/\./g, '-'), key.replace(/(\d)-(\d)/g, '$1.$2'));
  }
  const withoutEffort = undated.replace(/-(minimal|low|medium|high|xhigh|max|thinking|fast)$/g, '');
  keys.push(withoutEffort, withoutEffort.replace(/-thinking$/, ''));
  return [...new Set(keys.filter(Boolean))];
}

function perToken(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n / 1e6 : null;
}

// The supplement states dollars per million tokens under its own names; translate them to the
// per-token field names the LiteLLM catalog uses so one pricing path covers both layers.
function supplementRates(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const input = perToken(entry.input_per_million);
  if (input == null) return null;
  const rates = { input_cost_per_token: input };
  const output = perToken(entry.output_per_million);
  const write = perToken(entry.cache_write_per_million);
  const read = perToken(entry.cache_read_per_million);
  if (output != null) rates.output_cost_per_token = output;
  if (write != null) rates.cache_creation_input_token_cost = write;
  if (read != null) rates.cache_read_input_token_cost = read;
  return rates;
}

function scaleRates(rates, factor) {
  const scaled = {};
  for (const [field, value] of Object.entries(rates)) {
    if (typeof value === 'number') scaled[field] = value * factor;
  }
  return scaled;
}

// The published rules are PCRE-style, so an inline `(?i)` has to become a JavaScript flag or the
// whole rule fails to compile and every Cursor Router label it covers goes unpriced.
function compileRule(pattern) {
  const source = pattern.replace(/\(\?i\)/g, '');
  try {
    return new RegExp(source, source === pattern ? '' : 'i');
  } catch {
    return null;
  }
}

// A malformed or empty supplement is ignored rather than partially applied, so a bad download can
// never make previously priced models cost nothing.
function normalizeSupplement(raw) {
  const supplement = { updatedAt: null, models: {}, fast: {}, aliases: [], raw: raw || null };
  const updatedAt = Date.parse(raw?.updated_at || '');
  if (Number.isFinite(updatedAt)) supplement.updatedAt = updatedAt;
  for (const [key, entry] of Object.entries(raw?.pricing || {})) {
    const rates = supplementRates(entry);
    if (rates) supplement.models[String(key).toLowerCase()] = rates;
  }
  for (const [key, value] of Object.entries(raw?.fast_multipliers || {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 1) supplement.fast[String(key).toLowerCase()] = n;
  }
  for (const rule of Array.isArray(raw?.alias_rules) ? raw.alias_rules : []) {
    if (typeof rule?.pattern !== 'string' || typeof rule?.canonical !== 'string') continue;
    const pattern = compileRule(rule.pattern);
    if (pattern) supplement.aliases.push({ pattern, canonical: rule.canonical.toLowerCase() });
  }
  return supplement;
}

class PricingCatalog {
  constructor({ cacheDir = null, fetchFn = globalThis.fetch?.bind(globalThis), now = () => Date.now(), supplement = null } = {}) {
    this.cacheDir = cacheDir;
    this.fetchFn = fetchFn;
    this.now = now;
    this.snapshot = require('./pricing-snapshot.json');
    this.models = this.snapshot;
    this.fetchedModels = {};
    this.supplement = normalizeSupplement(supplement || require('./pricing-supplement.json'));
    this.fetchedAt = 0;
    this.supplementFetchedAt = 0;
    this.supplementEtag = null;
    // Whether the supplement on hand was downloaded, so a cache only carries a copy when it holds
    // something the bundled file does not.
    this.supplementFetched = false;
    this.resolved = new Map();
    this.loadCache();
  }

  cachePath() {
    return this.cacheDir ? path.join(this.cacheDir, 'pricing-cache.json') : null;
  }

  loadCache() {
    const file = this.cachePath();
    if (!file) return;
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached?.models && Object.keys(cached.models).length) {
        this.fetchedModels = cached.models;
        this.models = { ...this.snapshot, ...this.fetchedModels };
        this.fetchedAt = Number(cached.fetchedAt) || 0;
      }
      const supplement = cached?.supplement;
      if (supplement) {
        this.supplementFetchedAt = Number(supplement.fetchedAt) || 0;
        this.supplementEtag = typeof supplement.etag === 'string' ? supplement.etag : null;
        if (supplement.raw) {
          const restored = normalizeSupplement(supplement.raw);
          // Strictly newer only: a tie means the bundled copy is at least as fresh, and it ships with
          // the app version rather than an older download.
          if (restored.updatedAt && restored.updatedAt > this.supplement.updatedAt) {
            this.supplement = restored;
            this.supplementFetched = true;
          }
        }
      }
    } catch {}
  }

  saveCache() {
    const file = this.cachePath();
    if (!file) return;
    try {
      fs.writeFileSync(file, JSON.stringify({
        fetchedAt: this.fetchedAt,
        models: this.fetchedModels,
        supplement: {
          fetchedAt: this.supplementFetchedAt,
          etag: this.supplementEtag,
          raw: this.supplementFetched ? this.supplement.raw : null
        }
      }));
    } catch (error) {
      console.warn('Throttle could not write the pricing cache:', error.message);
    }
  }

  async refresh({ force = false } = {}) {
    const catalog = await this.refreshCatalog(force);
    const supplement = await this.refreshSupplement(force);
    return catalog || supplement;
  }

  async refreshCatalog(force = false) {
    if (!this.fetchFn || (!force && this.now() - this.fetchedAt < REFRESH_MS)) return false;
    this.fetchedAt = this.now();
    try {
      const response = await this.fetchFn(LITELLM_URL);
      if (!response.ok) return false;
      const models = reduceCatalog(await response.json());
      if (!Object.keys(models).length) return false;
      this.fetchedModels = models;
      this.models = { ...this.snapshot, ...models };
      this.resolved.clear();
      this.saveCache();
      return true;
    } catch {
      return false;
    }
  }

  async refreshSupplement(force = false) {
    if (!this.fetchFn || (!force && this.now() - this.supplementFetchedAt < SUPPLEMENT_REFRESH_MS)) return false;
    this.supplementFetchedAt = this.now();
    try {
      const response = await this.fetchFn(SUPPLEMENT_URL, this.supplementEtag ? { headers: { 'If-None-Match': this.supplementEtag } } : {});
      // A 304 is a successful check with nothing to change.
      if (!response.ok) return false;
      const etag = response.headers?.get?.('etag');
      if (etag) this.supplementEtag = etag;
      const next = normalizeSupplement(await response.json());
      if (!next.updatedAt || !Object.keys(next.models).length) return false;
      // Additive only: rates already on hand are kept when they are at least as new.
      if (next.updatedAt < this.supplement.updatedAt) return false;
      const changed = next.updatedAt !== this.supplement.updatedAt ||
        JSON.stringify(next.models) !== JSON.stringify(this.supplement.models);
      this.supplement = next;
      this.supplementFetched = true;
      this.resolved.clear();
      this.saveCache();
      return changed;
    } catch {
      return false;
    }
  }

  rates(model) {
    const key = String(model || '').trim().toLowerCase();
    if (this.resolved.has(key)) return this.resolved.get(key);
    const found = this.resolve(key);
    this.resolved.set(key, found);
    return found;
  }

  // The order follows the supplement's contract: alias rules redirect the name first, then an exact
  // key is taken from the supplement (which outranks LiteLLM) or the catalog, then a fast variant is
  // priced from its base rate, and only then does the fuzzy pass try to recognize the name.
  resolve(name) {
    const target = this.aliasFor(name) ?? name;
    const direct = this.supplement.models[target] || this.models[target];
    if (direct) return direct;
    if (FAST_SUFFIX.test(target)) return this.fastRates(target);
    return this.fuzzy(target);
  }

  aliasFor(name) {
    for (const rule of this.supplement.aliases) {
      if (rule.pattern.test(name)) return rule.canonical;
    }
    return null;
  }

  // A fast variant is priced only when the catalog carries it outright or the supplement publishes
  // its multiplier; otherwise it stays unpriced instead of quietly billing at the standard rate.
  fastRates(name) {
    const base = name.replace(FAST_SUFFIX, '');
    const multiplier = this.supplement.fast[base] ?? this.supplement.fast[name];
    if (!multiplier) return null;
    const rates = this.supplement.models[base] || this.models[base] || this.fuzzy(base);
    return rates ? scaleRates(rates, multiplier) : null;
  }

  fuzzy(name) {
    const keys = candidateKeys(name);
    // The supplement's models participate in the same prefix matching, so variants published
    // by an API (contributor, preview, internal builds) price from their base model's rate.
    const pool = { ...this.models, ...this.supplement.models };
    for (const key of keys) {
      if (pool[key]) return pool[key];
    }
    // Separator style differs between catalogs, so compare with dots and dashes normalized.
    const canonical = key => key.replace(/\./g, '-');
    const base = canonical(keys[1] ?? keys[0]);
    const prefixed = Object.keys(pool)
      .filter(key => {
        const candidate = canonical(key);
        return candidate.startsWith(`${base}-`) || base.startsWith(`${candidate}-`);
      })
      .sort((a, b) => b.length - a.length)[0];
    return prefixed ? pool[prefixed] : null;
  }

  // Tokens: { input, cacheWrite5m, cacheWrite1h, cacheRead, output }; input excludes cached tokens.
  cost(model, tokens) {
    const rates = this.rates(model);
    if (!rates) return null;
    const prompt = (tokens.input || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite5m || 0) + (tokens.cacheWrite1h || 0);
    const tier = prompt > 272000 && rates.input_cost_per_token_above_272k_tokens
      ? '_above_272k_tokens'
      : prompt > 200000 && rates.input_cost_per_token_above_200k_tokens
        ? '_above_200k_tokens'
        : '';
    const rate = field => rates[`${field}${tier}`] ?? rates[field] ?? 0;
    const input = rate('input_cost_per_token');
    const write5m = rates[`cache_creation_input_token_cost${tier}`] ?? rates.cache_creation_input_token_cost ?? input;
    const write1h = rates.cache_creation_input_token_cost_above_1hr ?? write5m;
    const read = rates[`cache_read_input_token_cost${tier}`] ?? rates.cache_read_input_token_cost ?? input;
    return (tokens.input || 0) * input +
      (tokens.cacheWrite5m || 0) * write5m +
      (tokens.cacheWrite1h || 0) * write1h +
      (tokens.cacheRead || 0) * read +
      (tokens.output || 0) * rate('output_cost_per_token');
  }
}

module.exports = {
  PricingCatalog,
  reduceCatalog,
  candidateKeys,
  normalizeSupplement,
  supplementRates,
  LITELLM_URL,
  SUPPLEMENT_URL
};
