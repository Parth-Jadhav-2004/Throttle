const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { route, startLocalApi } = require('../src/local-api');

const providers = {
  claude: { data: { planType: 'Max 5x', fiveHour: { usedPercent: 42, resetsAt: 1_800_000_000, windowDurationMins: 300 } }, updatedAt: Date.now() },
  codex: { status: 'disconnected', error: 'Codex login required' }
};
const spend = {
  claude: { summary: { today: { cost: 5.17, tokens: 9.2e6, models: [] }, yesterday: null, last30: { cost: 40, tokens: 50e6, models: [] }, trend: [{ date: '2026-10-14', tokens: 9.2e6, cost: 5.17 }] } }
};
const context = { visibleIds: ['claude', 'codex'], allIds: ['claude', 'codex', 'cursor', 'antigravity'], providers, spend };

test('serves a limits envelope with raw values and refresh errors', () => {
  const { status, body } = route('GET', '/v1/limits', context);
  assert.equal(status, 200);
  assert.equal(body.schema, 'throttle.limits.v1');
  assert.deepEqual(Object.keys(body.providers), ['claude']);
  const session = body.providers.claude.resources.session;
  assert.equal(session.used, 42);
  assert.equal(session.remaining, 58);
  assert.equal(session.utilization, 0.42);
  assert.equal(session.windowSeconds, 18000);
  assert.equal(body.providers.claude.plan, 'Max 5x');
  assert.deepEqual(body.errors, [{ providerId: 'codex', message: 'Codex login required' }]);
});

test('serves legacy usage lines including spend rows and the trend chart', () => {
  const { body } = route('GET', '/v1/usage/claude', context);
  assert.equal(body.length, 1);
  const lines = body[0].lines;
  assert.deepEqual(lines.map(line => line.type), ['progress', 'text', 'text', 'text', 'barChart']);
  assert.equal(lines[1].value, '$5.17 · 9.2M tokens');
  assert.equal(lines[2].value, 'No usage');
});

test('rejects unknown providers, routes and methods', () => {
  assert.equal(route('GET', '/v1/limits/nope', context).status, 404);
  assert.equal(route('GET', '/v2/limits', context).body.error, 'not_found');
  assert.equal(route('POST', '/v1/limits', context).status, 405);
  assert.equal(route('OPTIONS', '/v1/limits', context).status, 204);
});

test('refuses requests whose Host header is not loopback', async () => {
  const server = startLocalApi(() => context, { port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const get = host => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: '/v1/limits', headers: { Host: host } }, res => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  try {
    assert.equal(await get('evil.example'), 403);
    assert.equal(await get(`127.0.0.1:${port}`), 200);
  } finally {
    server.close();
  }
});
