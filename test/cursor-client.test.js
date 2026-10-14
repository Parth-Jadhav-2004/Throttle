const test = require('node:test');
const assert = require('node:assert/strict');
const { CursorClient } = require('../src/cursor-client');

function jwtForExp(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test('loads included Cursor usage from the dashboard endpoints', async () => {
  const calls = [];
  const client = new CursorClient({
    now: () => 1_000_000,
    readAuth: async () => ({
      accessToken: jwtForExp(2_000),
      refreshToken: 'refresh-token',
      membershipType: 'pro'
    }),
    fetchFn: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      if (url.endsWith('/GetCurrentPeriodUsage')) {
        return jsonResponse(200, {
          billingCycleStart: '1768399334000',
          billingCycleEnd: '1771077734000',
          planUsage: {
            includedSpend: 5000,
            remaining: 15000,
            limit: 20000,
            autoPercentUsed: 13,
            apiPercentUsed: 10,
            totalPercentUsed: 25
          }
        });
      }
      if (url.endsWith('/GetPlanInfo')) {
        return jsonResponse(200, { planInfo: { planName: 'Pro' } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  const data = await client.getUsage();
  assert.equal(data.planType, 'Pro');
  assert.equal(data.included.usedPercent, 13);
  assert.equal(data.api.usedPercent, 10);
  assert.equal(data.remainingLabel, '$150 left');
  assert.equal(calls.length, 2);
});

test('refreshes an expired access token before calling Cursor', async () => {
  const calls = [];
  const client = new CursorClient({
    now: () => 1_700_000_000_000,
    readAuth: async () => ({
      accessToken: jwtForExp(1_600_000_000),
      refreshToken: 'refresh-token',
      membershipType: 'ultra'
    }),
    fetchFn: async (url, options) => {
      calls.push({ url, body: options.body, auth: options.headers?.Authorization });
      if (url.endsWith('/oauth/token')) {
        assert.equal(JSON.parse(options.body).refresh_token, 'refresh-token');
        return jsonResponse(200, { access_token: jwtForExp(1_800_000_000), shouldLogout: false });
      }
      if (url.endsWith('/GetCurrentPeriodUsage')) {
        assert.match(options.headers.Authorization, /^Bearer eyJ/);
        return jsonResponse(200, {
          billingCycleEnd: '1771077734000',
          planUsage: { includedSpend: 0, remaining: 40000, limit: 40000, totalPercentUsed: 0 }
        });
      }
      if (url.endsWith('/GetPlanInfo')) return jsonResponse(200, { planInfo: { planName: 'Ultra' } });
      throw new Error(`unexpected ${url}`);
    }
  });
  const data = await client.getUsage();
  assert.equal(data.planType, 'Ultra');
  assert.equal(data.layout, 'included');
  assert.equal(calls[0].url.endsWith('/oauth/token'), true);
});

test('retries once after a 401 and falls back to request usage', async () => {
  let usageCalls = 0;
  const client = new CursorClient({
    now: () => 1_000,
    readAuth: async () => ({
      accessToken: jwtForExp(2_000_000),
      refreshToken: 'refresh-token',
      membershipType: 'enterprise'
    }),
    fetchFn: async (url, options) => {
      if (url.endsWith('/GetCurrentPeriodUsage')) {
        usageCalls += 1;
        if (usageCalls === 1) return jsonResponse(401, { message: 'unauthenticated' });
        return jsonResponse(200, {});
      }
      if (url.endsWith('/oauth/token')) {
        return jsonResponse(200, { access_token: jwtForExp(3_000_000) });
      }
      if (url.endsWith('/GetPlanInfo')) return jsonResponse(200, { planInfo: { planName: 'Enterprise' } });
      if (url.endsWith('/auth/usage')) {
        assert.equal(options.headers.Authorization.startsWith('Bearer '), true);
        return jsonResponse(200, {
          'gpt-4': { numRequests: 20, maxRequestUsage: 100 },
          startOfMonth: '2026-08-01T00:00:00.000Z'
        });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  const data = await client.getUsage();
  assert.equal(data.layout, 'requests');
  assert.equal(data.remainingLabel, '80 left');
  assert.equal(data.included.usedPercent, 20);
});
