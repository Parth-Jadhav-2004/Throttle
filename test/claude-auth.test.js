const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  getClaudeCredentialsPath,
  parseClaudeCredentials,
  readClaudeAuth,
  mergeRefreshedOAuth
} = require('../src/claude-auth');

test('resolves Claude credentials under CLAUDE_CONFIG_DIR or the home folder', () => {
  assert.equal(
    getClaudeCredentialsPath({ homeDir: '/home/dev' }),
    path.join('/home/dev', '.claude', '.credentials.json')
  );
  assert.equal(
    getClaudeCredentialsPath({ configDir: 'D:\\claude-config' }),
    path.join('D:\\claude-config', '.credentials.json')
  );
});

test('parses claudeAiOauth tokens from the credentials file', () => {
  const auth = parseClaudeCredentials(JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-abc',
      refreshToken: 'sk-ant-ort01-def',
      expiresAt: 1770412938485,
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x'
    }
  }));
  assert.equal(auth.accessToken, 'sk-ant-oat01-abc');
  assert.equal(auth.refreshToken, 'sk-ant-ort01-def');
  assert.equal(auth.rateLimitTier, 'default_claude_max_5x');
});

test('reads the first credentials file that contains a token', () => {
  const primary = path.join(os.tmpdir(), 'claude-credentials.json');
  const legacy = path.join(os.tmpdir(), 'claude.json');
  const files = {
    [legacy]: JSON.stringify({ claudeAiOauth: { accessToken: 'legacy-token', refreshToken: 'legacy-refresh' } })
  };
  const auth = readClaudeAuth({
    credentialsPath: primary,
    legacyPath: legacy,
    readFile: filePath => {
      if (!files[filePath]) throw new Error('missing');
      return files[filePath];
    }
  });
  assert.equal(auth.accessToken, 'legacy-token');
  assert.equal(auth.credentialsPath, legacy);
});

test('merges a rotated token back into the existing credentials object', () => {
  const next = mergeRefreshedOAuth({
    claudeAiOauth: {
      accessToken: 'old',
      refreshToken: 'old-refresh',
      expiresAt: 1,
      subscriptionType: 'pro',
      rateLimitTier: 'default_claude_max_5x'
    },
    extra: true
  }, { accessToken: 'new', refreshToken: 'new-refresh', expiresIn: 3600 }, 1_000_000);
  assert.equal(next.extra, true);
  assert.equal(next.claudeAiOauth.accessToken, 'new');
  assert.equal(next.claudeAiOauth.refreshToken, 'new-refresh');
  assert.equal(next.claudeAiOauth.expiresAt, 4_600_000);
  assert.equal(next.claudeAiOauth.rateLimitTier, 'default_claude_max_5x');
});
