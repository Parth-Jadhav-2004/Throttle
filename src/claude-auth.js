const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function getClaudeConfigDir({ homeDir, configDir } = {}) {
  return configDir || process.env.CLAUDE_CONFIG_DIR || path.join(homeDir || os.homedir(), '.claude');
}

function getClaudeCredentialsPath(options = {}) {
  return path.join(getClaudeConfigDir(options), '.credentials.json');
}

function getLegacyClaudeCredentialsPath({ homeDir } = {}) {
  return path.join(homeDir || os.homedir(), '.claude.json');
}

function oauthFromPayload(payload) {
  const block = payload?.claudeAiOauth || payload;
  const accessToken = typeof block?.accessToken === 'string' ? block.accessToken : null;
  const refreshToken = typeof block?.refreshToken === 'string' ? block.refreshToken : null;
  if (!accessToken && !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(Number(block.expiresAt)) ? Number(block.expiresAt) : null,
    subscriptionType: block.subscriptionType || null,
    rateLimitTier: block.rateLimitTier || null
  };
}

function parseClaudeCredentials(text) {
  try {
    return oauthFromPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

function readClaudeAuth({
  credentialsPath = getClaudeCredentialsPath(),
  legacyPath = getLegacyClaudeCredentialsPath(),
  readFile = pathToRead => fs.readFileSync(pathToRead, 'utf8')
} = {}) {
  for (const filePath of [credentialsPath, legacyPath]) {
    try {
      const auth = parseClaudeCredentials(readFile(filePath));
      if (auth) return { ...auth, credentialsPath: filePath };
    } catch {
      // Missing or unreadable files fall through to the next candidate.
    }
  }
  throw new Error('Claude login required');
}

function mergeRefreshedOAuth(existingPayload, tokens, now = Date.now()) {
  const next = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || existingPayload?.claudeAiOauth?.refreshToken || existingPayload?.refreshToken,
    expiresAt: Number.isFinite(Number(tokens.expiresAt))
      ? Number(tokens.expiresAt)
      : now + Number(tokens.expiresIn || 3600) * 1000,
    subscriptionType: existingPayload?.claudeAiOauth?.subscriptionType || existingPayload?.subscriptionType || null,
    rateLimitTier: existingPayload?.claudeAiOauth?.rateLimitTier || existingPayload?.rateLimitTier || null
  };
  if (existingPayload && typeof existingPayload === 'object' && existingPayload.claudeAiOauth) {
    return {
      ...existingPayload,
      claudeAiOauth: { ...existingPayload.claudeAiOauth, ...next }
    };
  }
  return { claudeAiOauth: next };
}

module.exports = {
  getClaudeConfigDir,
  getClaudeCredentialsPath,
  getLegacyClaudeCredentialsPath,
  parseClaudeCredentials,
  readClaudeAuth,
  mergeRefreshedOAuth
};
