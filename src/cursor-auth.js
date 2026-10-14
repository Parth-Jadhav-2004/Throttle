const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTH_KEYS = {
  accessToken: 'cursorAuth/accessToken',
  refreshToken: 'cursorAuth/refreshToken',
  membershipType: 'cursorAuth/stripeMembershipType'
};
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const MEMBERSHIP_RE = /\b(free|hobby|pro|plus|ultra|team|business|enterprise|pro_plus)\b/i;

function getCursorStateDbPath({ appData, homeDir, platform } = {}) {
  const plat = platform || process.platform;
  if (plat === 'win32') {
    const roaming = appData || process.env.APPDATA || path.join(homeDir || os.homedir(), 'AppData', 'Roaming');
    return path.join(roaming, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (plat === 'darwin') {
    return path.join(homeDir || os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(homeDir || os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function extractAfterKey(buffer, key, parse) {
  const keyBuf = Buffer.from(key);
  let found = null;
  let index = 0;
  while ((index = buffer.indexOf(keyBuf, index)) !== -1) {
    const slice = buffer.subarray(index + keyBuf.length, index + keyBuf.length + 8192);
    const value = parse(slice);
    if (value) found = value;
    index += keyBuf.length;
  }
  return found;
}

function parseJwt(slice) {
  const match = slice.toString('latin1').match(JWT_RE);
  return match ? match[0] : null;
}

function parseMembership(slice) {
  const match = slice.subarray(0, 96).toString('utf8').match(MEMBERSHIP_RE);
  return match ? match[1].toLowerCase() : null;
}

function authFromBuffer(buffer) {
  return {
    accessToken: extractAfterKey(buffer, AUTH_KEYS.accessToken, parseJwt),
    refreshToken: extractAfterKey(buffer, AUTH_KEYS.refreshToken, parseJwt),
    membershipType: extractAfterKey(buffer, AUTH_KEYS.membershipType, parseMembership)
  };
}

function mergeAuth(base, next) {
  return {
    accessToken: next.accessToken || base.accessToken || null,
    refreshToken: next.refreshToken || base.refreshToken || null,
    membershipType: next.membershipType || base.membershipType || null
  };
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function scanCursorAuth(dbPath, readFile = readFileIfPresent) {
  const files = [dbPath, `${dbPath}-wal`];
  let auth = { accessToken: null, refreshToken: null, membershipType: null };
  for (const filePath of files) {
    const buffer = readFile(filePath);
    if (buffer?.length) auth = mergeAuth(auth, authFromBuffer(buffer));
  }
  return auth;
}

function textValue(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();
    return text || null;
  }
  const text = String(value).trim();
  return text || null;
}

function tryNodeSqlite() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch {
    return null;
  }
}

function copySidecar(src, dest) {
  fs.writeFileSync(dest, fs.readFileSync(src));
}

function queryCursorAuth(dbPath, DatabaseSync) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-cursor-'));
  const tmpDb = path.join(tmpDir, 'state.vscdb');
  try {
    copySidecar(dbPath, tmpDb);
    for (const suffix of ['-wal', '-shm']) {
      const extra = `${dbPath}${suffix}`;
      if (fs.existsSync(extra)) {
        try { copySidecar(extra, `${tmpDb}${suffix}`); } catch { /* ignore locked sidecars */ }
      }
    }
    const db = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1');
      const read = key => textValue(stmt.get(key)?.value);
      return {
        accessToken: read(AUTH_KEYS.accessToken),
        refreshToken: read(AUTH_KEYS.refreshToken),
        membershipType: read(AUTH_KEYS.membershipType)
      };
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readCursorAuth({ dbPath = getCursorStateDbPath(), DatabaseSync = tryNodeSqlite() } = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error('Cursor is not installed or has not been signed in on this computer.');
  }
  let auth = { accessToken: null, refreshToken: null, membershipType: null };
  if (DatabaseSync) {
    try {
      auth = mergeAuth(auth, queryCursorAuth(dbPath, DatabaseSync));
    } catch {
      // Locked or experimental sqlite builds fall through to a read-only scan.
    }
  }
  auth = mergeAuth(auth, scanCursorAuth(dbPath));
  if (!auth.accessToken && !auth.refreshToken) {
    throw new Error('Cursor login required');
  }
  return auth;
}

module.exports = {
  AUTH_KEYS,
  getCursorStateDbPath,
  scanCursorAuth,
  readCursorAuth
};
