const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createAccessToken,
  createUsageServer,
  findServeUrl,
  isAuthorized
} = require('../src/mobile-access');

test('creates a high-entropy URL-safe pairing token', () => {
  const token = createAccessToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, createAccessToken());
});

test('accepts only an exact bearer token', () => {
  const token = createAccessToken();
  assert.equal(isAuthorized({ headers: { authorization: `Bearer ${token}` } }, token), true);
  assert.equal(isAuthorized({ headers: { authorization: `Bearer ${token}x` } }, token), false);
  assert.equal(isAuthorized({ headers: {} }, token), false);
});

test('extracts a private HTTPS Serve URL', () => {
  const output = 'Available within your tailnet:\nhttps://laptop.example-tailnet.ts.net\n';
  assert.equal(findServeUrl(output), 'https://laptop.example-tailnet.ts.net');
  assert.equal(findServeUrl('http://100.64.0.1'), null);
});

function requestJson(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({
          statusCode: response.statusCode,
          body: JSON.parse(body)
        }));
      }
    );
    request.on('error', reject);
    request.end();
  });
}

test('serves usage only with the pairing token through root or mounted paths', async () => {
  const token = createAccessToken();
  const snapshot = { schemaVersion: 1, capturedAt: new Date().toISOString() };
  const access = createUsageServer({ token, getSnapshot: () => snapshot, port: 0 });
  await access.start();
  const address = access.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    assert.equal((await requestJson(port, '/v1/usage')).statusCode, 401);
    assert.deepEqual((await requestJson(port, '/v1/usage', token)).body, snapshot);
    assert.deepEqual((await requestJson(port, '/throttle/v1/usage', token)).body, snapshot);
  } finally {
    await access.stop();
  }
});
