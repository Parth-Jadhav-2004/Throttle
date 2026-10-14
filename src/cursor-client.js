const { readCursorAuth } = require('./cursor-auth');
const { normalizeCursorUsage } = require('./cursor-usage');

const DEFAULT_BASE_URL = 'https://api2.cursor.sh';
const OAUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const USAGE_EVENTS_URL = 'https://cursor.com/api/dashboard/get-filtered-usage-events';

function jwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function jwtExpiryMs(token) {
  const payload = jwtPayload(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

function jwtSubject(token) {
  const subject = jwtPayload(token)?.sub;
  return typeof subject === 'string' && subject ? subject : null;
}

function isExpiring(token, now, skewMs = REFRESH_SKEW_MS) {
  const expiry = jwtExpiryMs(token);
  return expiry != null && expiry - now <= skewMs;
}

function isAuthError(error) {
  return error?.status === 401 || error?.status === 403 || /unauthorized|unauthenticated|login/i.test(String(error?.message || ''));
}

class CursorClient {
  constructor({
    fetchFn = globalThis.fetch.bind(globalThis),
    readAuth = readCursorAuth,
    timeoutMs = 15000,
    now = () => Date.now(),
    baseUrl = DEFAULT_BASE_URL
  } = {}) {
    this.fetchFn = fetchFn;
    this.readAuth = readAuth;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
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
        const error = new Error(payload?.message || payload?.error?.message || `Cursor request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      if (payload?.error) {
        const error = new Error(payload.error.message || payload.error.code || 'Cursor request failed');
        error.status = /unauth/i.test(String(payload.error.code || '')) ? 401 : 400;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Cursor request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async dashboard(method, token) {
    return this.request(`${this.baseUrl}/aiserver.v1.DashboardService/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1'
      },
      body: '{}'
    });
  }

  async requestUsage(token) {
    return this.request(`${this.baseUrl}/auth/usage`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  async refreshAccessToken(refreshToken) {
    const payload = await this.request(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
        refresh_token: refreshToken
      })
    });
    if (payload?.shouldLogout || !payload?.access_token) {
      const error = new Error('Cursor login required');
      error.status = 401;
      throw error;
    }
    return payload.access_token;
  }

  async resolveToken(auth) {
    let token = auth.accessToken || null;
    if (!token || isExpiring(token, this.now())) {
      if (!auth.refreshToken) {
        const error = new Error('Cursor login required');
        error.status = 401;
        throw error;
      }
      token = await this.refreshAccessToken(auth.refreshToken);
    }
    return token;
  }

  async loadUsage(token, membershipType) {
    let usage = null;
    let planInfo = null;
    let requestUsage = null;
    try {
      usage = await this.dashboard('GetCurrentPeriodUsage', token);
    } catch (error) {
      if (isAuthError(error)) throw error;
    }
    try {
      planInfo = await this.dashboard('GetPlanInfo', token);
    } catch (error) {
      if (isAuthError(error)) throw error;
    }
    if (!usage?.planUsage) {
      try {
        requestUsage = await this.requestUsage(token);
      } catch (error) {
        if (isAuthError(error)) throw error;
        if (!usage) throw error;
      }
    }
    const data = normalizeCursorUsage({ usage, planInfo, membershipType, requestUsage });
    if (!data.included && !data.api) throw new Error('Unable to read Cursor usage');
    return data;
  }

  async getUsageEvents({ startMs, pageSize = 1000, maxPages = 20 } = {}) {
    const auth = await this.readAuth();
    const token = await this.resolveToken(auth);
    const subject = jwtSubject(token);
    if (!subject) throw new Error('Cursor login required');
    const parts = subject.split('|');
    const userId = parts.length > 1 ? parts[1] : parts[0];
    const end = this.now();
    const start = Number.isFinite(startMs) ? startMs : end - 30 * 86400000;
    const events = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.request(USAGE_EVENTS_URL, {
        method: 'POST',
        headers: {
          Cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}`,
          'Content-Type': 'application/json',
          Origin: 'https://cursor.com'
        },
        body: JSON.stringify({ startDate: String(start), endDate: String(end), page, pageSize })
      });
      const batch = Array.isArray(payload?.usageEventsDisplay) ? payload.usageEventsDisplay : [];
      events.push(...batch);
      if (!batch.length || events.length >= Number(payload?.totalUsageEventsCount || 0)) break;
    }
    return events;
  }

  async getUsage() {
    const auth = await this.readAuth();
    let token = await this.resolveToken(auth);
    try {
      return await this.loadUsage(token, auth.membershipType);
    } catch (error) {
      if (!isAuthError(error) || !auth.refreshToken) throw error;
      token = await this.refreshAccessToken(auth.refreshToken);
      return this.loadUsage(token, auth.membershipType);
    }
  }
}

module.exports = { CursorClient, jwtExpiryMs, isExpiring };
