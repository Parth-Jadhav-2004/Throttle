const fs = require('node:fs');
const path = require('node:path');

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const PRICE_FIELD = /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost|cache_creation_input_token_cost_above_1hr)(_above_(200|272)k_tokens)?$/;
const MODEL_PREFIX = /^(claude|gpt|o\d|codex|gemini|grok|composer|deepseek|kimi|glm|qwen)/;

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

class PricingCatalog {
  constructor({ cacheDir = null, fetchFn = globalThis.fetch?.bind(globalThis), now = () => Date.now() } = {}) {
    this.cacheDir = cacheDir;
    this.fetchFn = fetchFn;
    this.now = now;
    this.models = require('./pricing-snapshot.json');
    this.fetchedAt = 0;
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
        this.models = { ...this.models, ...cached.models };
        this.fetchedAt = Number(cached.fetchedAt) || 0;
      }
    } catch {}
  }

  async refresh({ force = false } = {}) {
    if (!this.fetchFn || (!force && this.now() - this.fetchedAt < REFRESH_MS)) return false;
    this.fetchedAt = this.now();
    try {
      const response = await this.fetchFn(LITELLM_URL);
      if (!response.ok) return false;
      const models = reduceCatalog(await response.json());
      if (!Object.keys(models).length) return false;
      this.models = { ...this.models, ...models };
      this.resolved.clear();
      const file = this.cachePath();
      if (file) fs.writeFileSync(file, JSON.stringify({ fetchedAt: this.fetchedAt, models }));
      return true;
    } catch {
      return false;
    }
  }

  rates(model) {
    if (this.resolved.has(model)) return this.resolved.get(model);
    let found = null;
    for (const key of candidateKeys(model)) {
      if (this.models[key]) {
        found = this.models[key];
        break;
      }
    }
    if (!found) {
      const keys = candidateKeys(model);
      const base = keys[1] ?? keys[0];
      const prefixed = Object.keys(this.models)
        .filter(key => key.startsWith(`${base}-`) || base.startsWith(`${key}-`))
        .sort((a, b) => b.length - a.length)[0];
      found = prefixed ? this.models[prefixed] : null;
    }
    this.resolved.set(model, found);
    return found;
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

module.exports = { PricingCatalog, reduceCatalog, candidateKeys };
