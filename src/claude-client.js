const fs = require('node:fs');
const { readClaudeAuth, mergeRefreshedOAuth } = require('./claude-auth');
const { normalizeClaudeUsage } = require('./claude-usage');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URLS = [
  'https://platform.claude.com/v1/oauth/token',
  'https://console.anthropic.com/v1/oauth/token'
];
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const USER_AGENT = 'claude-code/2.1.201';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function isAuthError(error) {
  return error?.status === 401 || error?.status === 403 || /unauthorized|unauthenticated|login/i.test(String(error?.message || ''));
}

class ClaudeClient {
  constructor({
    fetchFn = globalThis.fetch.bind(globalThis),
    readAuth = readClaudeAuth,
    writeFile = (filePath, text) => fs.writeFileSync(filePath, text),
    readFile = filePath => fs.readFileSync(filePath, 'utf8'),
    timeoutMs = 15000,
    now = () => Date.now(),
    usageUrl = USAGE_URL,
    tokenUrls = TOKEN_URLS
  } = {}) {
    this.fetchFn = fetchFn;
    this.readAuth = readAuth;
    this.writeFile = writeFile;
    this.readFile = readFile;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.usageUrl = usageUrl;
    this.tokenUrls = tokenUrls;
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      if (!response.ok) {
        const error = new Error(payload?.error?.message || payload?.message || `Claude request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Claude request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  usageHeaders(token) {
    return {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': USER_AGENT,
      'anthropic-version': '2023-06-01'
    };
  }

  isExpiring(auth) {
    return auth.expiresAt != null && auth.expiresAt - this.now() <= REFRESH_SKEW_MS;
  }

  async refreshAccessToken(refreshToken) {
    let lastError = null;
    for (const url of this.tokenUrls) {
      try {
        const payload = await this.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT
          },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: CLIENT_ID
          })
        });
        if (!payload?.access_token) {
          const error = new Error('Claude login required');
          error.status = 401;
          throw error;
        }
        return {
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token || refreshToken,
          expiresIn: payload.expires_in
        };
      } catch (error) {
        lastError = error;
        if (error.status && error.status !== 404 && error.status !== 405) throw error;
      }
    }
    throw lastError || new Error('Claude login required');
  }

  persistTokens(auth, tokens) {
    if (!auth.credentialsPath) return;
    let existing = {};
    try { existing = JSON.parse(this.readFile(auth.credentialsPath)); } catch { existing = { claudeAiOauth: {} }; }
    const next = mergeRefreshedOAuth(existing, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn
    }, this.now());
    this.writeFile(auth.credentialsPath, `${JSON.stringify(next, null, 2)}\n`);
  }

  async resolveToken(auth) {
    if (auth.accessToken && !this.isExpiring(auth)) return { token: auth.accessToken, auth };
    if (!auth.refreshToken) {
      const error = new Error('Claude login required');
      error.status = 401;
      throw error;
    }
    const tokens = await this.refreshAccessToken(auth.refreshToken);
    this.persistTokens(auth, tokens);
    return {
      token: tokens.accessToken,
      auth: {
        ...auth,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: this.now() + Number(tokens.expiresIn || 3600) * 1000
      }
    };
  }

  async loadUsage(token, auth) {
    const payload = await this.request(this.usageUrl, { headers: this.usageHeaders(token) });
    const data = normalizeClaudeUsage(payload, auth);
    if (!data.fiveHour && !data.weekly) throw new Error('Unable to read Claude usage');
    return data;
  }

  async getUsage() {
    const auth = await this.readAuth();
    let resolved = await this.resolveToken(auth);
    try {
      return await this.loadUsage(resolved.token, resolved.auth);
    } catch (error) {
      if (!isAuthError(error) || !resolved.auth.refreshToken) throw error;
      const tokens = await this.refreshAccessToken(resolved.auth.refreshToken);
      this.persistTokens(resolved.auth, tokens);
      return this.loadUsage(tokens.accessToken, { ...resolved.auth, ...tokens });
    }
  }
}

module.exports = { ClaudeClient, USER_AGENT };
