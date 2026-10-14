const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AntigravityClient,
  fetchAntigravitySnapshot
} = require('../src/antigravity-client');

test('loads and caches normalized Antigravity quota', async () => {
  let calls = 0;
  const client = new AntigravityClient({
    now: () => 1_000,
    loadSnapshot: async () => {
      calls += 1;
      return {
        source: 'api',
        groups: [{
          name: 'Gemini models',
          buckets: [{ kind: 'weekly', remainingFraction: 0.75 }]
        }]
      };
    }
  });

  const data = await client.getUsage();
  const cached = await client.getUsage();
  assert.equal(data.usedPercent, 25);
  assert.equal(cached.usedPercent, 25);
  assert.equal(calls, 1);
});

test('rejects an Antigravity snapshot with no quota data', async () => {
  const client = new AntigravityClient({
    loadSnapshot: async () => ({ source: 'api', groups: [] })
  });
  await assert.rejects(() => client.getUsage(), /Unable to read Antigravity usage/);
});

test('reads model quota without requiring a Cloud Code project id', async () => {
  const requests = [];
  const snapshot = await fetchAntigravitySnapshot({
    getAccessToken: async () => 'google-token',
    hosts: ['daily-cloudcode-pa.googleapis.com'],
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          models: {
            'gemini-pro': {
              displayName: 'Gemini Pro',
              quotaInfo: {
                remainingFraction: 0.65,
                resetTime: '2026-09-01T00:00:00Z'
              }
            },
            internal: {
              displayName: '',
              isInternal: true,
              quotaInfo: { remainingFraction: 0 }
            }
          }
        })
      };
    }
  });

  assert.equal(requests[0].options.body, '{}');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer google-token');
  assert.equal(snapshot.groups[0].buckets.length, 1);
  assert.equal(snapshot.groups[0].buckets[0].remainingFraction, 0.65);
});
