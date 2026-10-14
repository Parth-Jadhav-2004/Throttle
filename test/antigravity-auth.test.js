const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeCredential,
  readWindowsCredential,
  getAntigravityAccessToken
} = require('../src/antigravity-auth');

function encodedCredential(token) {
  return `go-keyring-base64:${Buffer.from(JSON.stringify({ token })).toString('base64')}`;
}

test('decodes the credential format written by Antigravity CLI', () => {
  const result = decodeCredential(encodedCredential({
    access_token: 'google-access',
    refresh_token: 'google-refresh',
    expiry: '2026-09-01T00:00:00Z'
  }));
  assert.equal(result.accessToken, 'google-access');
  assert.equal(result.refreshToken, 'google-refresh');
  assert.equal(result.expiresAt, Date.parse('2026-09-01T00:00:00Z'));
});

test('reads the Antigravity credential bytes from Windows Credential Manager', () => {
  const raw = encodedCredential({ access_token: 'windows-token' });
  const result = readWindowsCredential({
    platform: 'win32',
    execFile: (_command, _args, options) => {
      assert.equal(options.windowsHide, true);
      return Buffer.from(raw).toString('base64');
    }
  });
  assert.equal(result, raw);
});

test('refreshes an expiring Antigravity access token in memory', async () => {
  const accessToken = await getAntigravityAccessToken({
    now: () => Date.parse('2026-08-31T23:59:30Z'),
    readWindows: () => encodedCredential({
      access_token: 'old-access',
      refresh_token: 'google-refresh',
      expiry: '2026-09-01T00:00:00Z'
    }),
    readFile: () => null,
    fetchFn: async (_url, options) => {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('refresh_token'), 'google-refresh');
      return {
        ok: true,
        text: async () => JSON.stringify({ access_token: 'fresh-access' })
      };
    }
  });
  assert.equal(accessToken, 'fresh-access');
});

test('reports login required when no Antigravity credential exists', async () => {
  await assert.rejects(() => getAntigravityAccessToken({
    readWindows: () => null,
    readFile: () => null
  }), /Antigravity login required/);
});
