const { normalizeAntigravityUsage } = require('./antigravity-usage');
const { getAntigravityAccessToken } = require('./antigravity-auth');

const HOSTS = [
  'daily-cloudcode-pa.googleapis.com',
  'cloudcode-pa.googleapis.com'
];
const CACHE_MS = 5 * 60 * 1000;

async function fetchAntigravitySnapshot({
  getAccessToken = getAntigravityAccessToken,
  fetchFn = globalThis.fetch.bind(globalThis),
  hosts = HOSTS
} = {}) {
  const accessToken = await getAccessToken();
  let lastError = null;

  for (const host of hosts) {
    try {
      const response = await fetchFn(
        `https://${host}/v1internal:fetchAvailableModels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity'
          },
          body: '{}'
        }
      );
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      if (!response.ok) {
        const error = new Error(
          payload?.error?.message || `Antigravity quota request failed (${response.status})`
        );
        error.status = response.status;
        throw error;
      }

      const buckets = Object.values(payload?.models || {})
        .filter(model => model && !model.isInternal && model.displayName && model.quotaInfo)
        .map(model => ({
          kind: 'model',
          label: model.displayName,
          remainingFraction: Number(model.quotaInfo.remainingFraction),
          resetAt: model.quotaInfo.resetTime || null,
          available: Number(model.quotaInfo.remainingFraction) === 1
        }))
        .filter(bucket => Number.isFinite(bucket.remainingFraction));
      if (!buckets.length) throw new Error('Antigravity returned no model quota');

      return {
        account: null,
        tier: null,
        fetchedAt: new Date().toISOString(),
        source: 'api',
        host,
        groups: [{ name: 'Antigravity models', models: '', buckets }]
      };
    } catch (error) {
      lastError = error;
      if (error?.status === 401 || error?.status === 403) throw error;
    }
  }
  throw lastError || new Error('Unable to read Antigravity usage');
}

async function loadAntigravitySnapshot() {
  return fetchAntigravitySnapshot();
}

class AntigravityClient {
  constructor({
    loadSnapshot = loadAntigravitySnapshot,
    now = () => Date.now(),
    cacheMs = CACHE_MS
  } = {}) {
    this.loadSnapshot = loadSnapshot;
    this.now = now;
    this.cacheMs = cacheMs;
    this.cached = null;
  }

  async getUsage() {
    if (this.cached && this.now() - this.cached.at < this.cacheMs) {
      return this.cached.data;
    }
    const snapshot = await this.loadSnapshot();
    const data = normalizeAntigravityUsage(snapshot);
    if (data.usedPercent == null) {
      throw new Error('Unable to read Antigravity usage');
    }
    this.cached = { at: this.now(), data };
    return data;
  }
}

module.exports = {
  AntigravityClient,
  fetchAntigravitySnapshot,
  loadAntigravitySnapshot
};
