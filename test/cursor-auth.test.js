const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { getCursorStateDbPath, scanCursorAuth } = require('../src/cursor-auth');

const ACCESS = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature';
const REFRESH = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyZWZyZXNoIn0.signature';

test('resolves the Cursor state database on Windows, macOS, and Linux', () => {
  assert.equal(
    getCursorStateDbPath({ platform: 'win32', appData: 'C:\\Users\\dev\\AppData\\Roaming' }),
    path.join('C:\\Users\\dev\\AppData\\Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  );
  assert.equal(
    getCursorStateDbPath({ platform: 'darwin', homeDir: '/Users/dev' }),
    path.join('/Users/dev', 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  );
  assert.equal(
    getCursorStateDbPath({ platform: 'linux', homeDir: '/home/dev' }),
    path.join('/home/dev', '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  );
});

test('scans JWT tokens and plan type after their Cursor auth keys', () => {
  const db = Buffer.from(`noise cursorAuth/accessToken${ACCESS} tail`);
  const wal = Buffer.from(`cursorAuth/refreshToken${REFRESH} cursorAuth/stripeMembershipType ultra`);
  const files = {
    [path.join(os.tmpdir(), 'state.vscdb')]: db,
    [path.join(os.tmpdir(), 'state.vscdb-wal')]: wal
  };
  const dbPath = path.join(os.tmpdir(), 'state.vscdb');
  const auth = scanCursorAuth(dbPath, filePath => files[filePath] || null);
  assert.equal(auth.accessToken, ACCESS);
  assert.equal(auth.refreshToken, REFRESH);
  assert.equal(auth.membershipType, 'ultra');
});

test('lets WAL values replace older main-database tokens', () => {
  const older = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvbGQifQ.signature';
  const newer = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuZXcifQ.signature';
  const dbPath = '/tmp/state.vscdb';
  const files = {
    [dbPath]: Buffer.from(`cursorAuth/accessToken${older}`),
    [`${dbPath}-wal`]: Buffer.from(`cursorAuth/accessToken${newer}`)
  };
  const auth = scanCursorAuth(dbPath, filePath => files[filePath] || null);
  assert.equal(auth.accessToken, newer);
});
