const test = require('node:test');
const assert = require('node:assert/strict');
const { ClaudeClient, USER_AGENT } = require('../src/claude-client');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test('loads Claude usage with the OAuth usage endpoint and official user agent', async () => {
  const calls = [];
  const client = new ClaudeClient({
    now: () => 1_000_000,
    readAuth: async () => ({
      accessToken: 'sk-ant-oat01',
      refreshToken: 'sk-ant-ort01',
      expiresAt: 10_000_000,
      rateLimitTier: 'default_claude_max_5x',
      credentialsPath: '/tmp/.credentials.json'
    }),
    fetchFn: async (url, options) => {
      calls.push({ url, headers: options.headers });
      assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
      assert.equal(options.headers.Authorization, 'Bearer sk-ant-oat01');
      assert.equal(options.headers['User-Agent'], USER_AGENT);
      assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
      return jsonResponse(200, {
        five_hour: { utilization: 34, resets_at: '2026-02-06T22:00:00Z' },
        seven_day: { utilization: 12, resets_at: '2026-02-12T20:00:00Z' }
      });
    }
  });
  const data = await client.getUsage();
  assert.equal(data.fiveHour.usedPercent, 34);
  assert.equal(data.weekly.usedPercent, 12);
  assert.equal(data.planType, 'max 5x');
  assert.equal(calls.length, 1);
});

test('refreshes an expired Claude token and writes the rotation back', async () => {
  const writes = [];
  const client = new ClaudeClient({
    now: () => 1_700_000_000_000,
    readAuth: async () => ({
      accessToken: 'expired',
      refreshToken: 'sk-ant-ort01',
      expiresAt: 1_600_000_000_000,
      credentialsPath: '/tmp/.credentials.json'
    }),
    readFile: () => JSON.stringify({
      claudeAiOauth: { accessToken: 'expired', refreshToken: 'sk-ant-ort01', expiresAt: 1 }
    }),
    writeFile: (filePath, text) => writes.push({ filePath, text }),
    fetchFn: async (url, options) => {
      if (url.endsWith('/v1/oauth/token')) {
        assert.equal(JSON.parse(options.body).refresh_token, 'sk-ant-ort01');
        return jsonResponse(200, { access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600 });
      }
      assert.equal(options.headers.Authorization, 'Bearer fresh');
      return jsonResponse(200, { five_hour: { utilization: 8, resets_at: '2026-02-06T22:00:00Z' } });
    }
  });
  const data = await client.getUsage();
  assert.equal(data.fiveHour.usedPercent, 8);
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /"accessToken": "fresh"/);
  assert.match(writes[0].text, /"refreshToken": "rotated"/);
});
