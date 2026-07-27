const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 43127;

function createAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function isAuthorized(request, token) {
  const value = String(request.headers.authorization || '');
  const supplied = value.startsWith('Bearer ') ? value.slice(7) : '';
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function createUsageServer({
  token,
  getSnapshot,
  port = DEFAULT_PORT,
  hostname = '127.0.0.1',
  createServer = http.createServer
}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${hostname}:${port}`);
    const apiPath = url.pathname.replace(/^\/throttle(?=\/)/, '');
    if (request.method === 'GET' && apiPath === '/v1/health') {
      writeJson(response, 200, { ok: true, service: 'throttle-mobile', schemaVersion: 1 });
      return;
    }
    if (request.method !== 'GET' || apiPath !== '/v1/usage') {
      writeJson(response, 404, { error: 'not_found' });
      return;
    }
    if (!isAuthorized(request, token)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }
    const snapshot = getSnapshot();
    if (!snapshot) {
      writeJson(response, 503, { error: 'usage_not_ready' });
      return;
    }
    writeJson(response, 200, snapshot);
  });

  return {
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, hostname, () => {
        server.removeListener('error', reject);
        resolve({ hostname, port });
      });
    }),
    stop: () => new Promise(resolve => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    }),
    server
  };
}

function tailscaleCandidates() {
  const values = [];
  if (process.env.ProgramFiles) {
    values.push(path.join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    values.push(path.join(process.env.LOCALAPPDATA, 'Tailscale', 'tailscale.exe'));
  }
  return values;
}

async function findTailscaleExecutable() {
  for (const candidate of tailscaleCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync('where.exe', ['tailscale.exe'], {
      windowsHide: true,
      timeout: 5000
    });
    const candidate = stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean);
    if (candidate) return candidate;
  } catch {}
  throw new Error('Tailscale is not installed on this Windows PC.');
}

function findServeUrl(output) {
  const match = String(output || '').match(/https:\/\/[a-z0-9.-]+\.ts\.net(?::\d+)?/i);
  return match ? match[0].replace(/\/+$/, '') : null;
}

async function enableTailscaleServe(port = DEFAULT_PORT) {
  const executable = await findTailscaleExecutable();
  const target = `http://127.0.0.1:${port}`;
  let stdout = '';
  try {
    const result = await execFileAsync(
      executable,
      ['serve', '--bg', '--yes', '--set-path=/throttle', target],
      { windowsHide: true, timeout: 20000 }
    );
    stdout = `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch (error) {
    const detail = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(detail || 'Tailscale could not expose the Throttle service.');
  }

  let serveUrl = findServeUrl(stdout);
  if (!serveUrl) {
    const status = await execFileAsync(executable, ['serve', 'status'], {
      windowsHide: true,
      timeout: 10000
    });
    serveUrl = findServeUrl(`${status.stdout || ''}\n${status.stderr || ''}`);
  }
  if (!serveUrl) {
    throw new Error('Tailscale Serve started, but its private HTTPS address was not reported.');
  }
  return {
    endpoint: `${serveUrl}/throttle`,
    executable
  };
}

module.exports = {
  DEFAULT_PORT,
  createAccessToken,
  createUsageServer,
  enableTailscaleServe,
  findServeUrl,
  isAuthorized
};
