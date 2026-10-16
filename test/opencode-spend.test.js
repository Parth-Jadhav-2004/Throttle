const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const spend = require('../src/spend');
const { OpenCodeScanner, openCodeEvent, openCodeEvents, opencodeDbPath } = require('../src/opencode-spend');

const sqlite = (() => {
  try {
    return require('node:sqlite');
  } catch {
    return null;
  }
})();

const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime();

function row(overrides = {}, message = {}) {
  const data = {
    time: { created: NOW - 60 * 1000 },
    model: { id: 'kimi-k3', providerID: 'opencode-go' },
    cost: 1.25,
    tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 4000, write: 100 } },
    ...message
  };
  return { time_created: NOW - 60 * 1000, data: JSON.stringify(data), ...overrides };
}

test('maps an OpenCode assistant message into a spend event', () => {
  const event = openCodeEvent(row());
  assert.equal(event.ts, NOW - 60 * 1000);
  assert.equal(event.model, 'opencode-go/kimi-k3');
  assert.equal(event.cost, 1.25);
  assert.deepEqual(event.tokens, { input: 1000, cacheWrite5m: 100, cacheWrite1h: 0, cacheRead: 4000, output: 250 });
});

test('keeps a zero cost and falls back to the message timestamp', () => {
  const free = openCodeEvent(row({ time_created: undefined }, { cost: 0, model: { id: 'deepseek-v4.1-flash-free' } }));
  assert.equal(free.cost, 0);
  assert.equal(free.ts, NOW - 60 * 1000);
  assert.equal(free.model, 'deepseek-v4.1-flash-free');
});

test('drops messages with no usage, no timestamp or unreadable data', () => {
  assert.equal(openCodeEvent({ time_created: NOW, data: 'not json' }), null);
  assert.equal(openCodeEvent({ time_created: NOW, data: JSON.stringify({ model: { id: 'x' } }) }), null);
  assert.equal(openCodeEvent({ data: JSON.stringify({ tokens: { input: 1 } }) }), null);
  assert.deepEqual(openCodeEvents([row({}, { tokens: { input: 0, output: 0 } })]), []);
  assert.equal(openCodeEvents([row()]).length, 1);
});

test('resolves the database path from the environment overrides', () => {
  const previous = { db: process.env.OPENCODE_DB, dir: process.env.OPENCODE_DATA_DIR };
  try {
    process.env.OPENCODE_DB = 'D:\\custom\\opencode.db';
    assert.equal(opencodeDbPath(), 'D:\\custom\\opencode.db');
    delete process.env.OPENCODE_DB;
    process.env.OPENCODE_DATA_DIR = 'D:\\oc-data';
    assert.equal(opencodeDbPath(), path.join('D:\\oc-data', 'opencode.db'));
  } finally {
    if (previous.db === undefined) delete process.env.OPENCODE_DB;
    else process.env.OPENCODE_DB = previous.db;
    if (previous.dir === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = previous.dir;
  }
});

test('reads only assistant messages inside the spend window', async () => {
  const rows = [
    { type: 'assistant', ...row() },
    { type: 'user', ...row() },
    { type: 'assistant', ...row({ time_created: NOW - 40 * 86400000 }) }
  ];
  const scanner = new OpenCodeScanner({
    // Any real file will do; the fake database ignores the path but `available()` stats it.
    dbPath: () => __filename,
    loadDatabase: () => function DatabaseSync() {
      return {
        prepare: () => ({ all: (type, since) => rows.filter(r => r.type === type && r.time_created >= since) }),
        close() {}
      };
    }
  });
  const events = await scanner.scan(NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].model, 'opencode-go/kimi-k3');
});

test('dates usage by the message write time', async () => {
  const scanner = new OpenCodeScanner({
    dbPath: () => __filename,
    loadDatabase: () => function DatabaseSync() {
      return {
        prepare: () => ({
          all: () => [
            // Written long after it started, but still inside the window.
            { time_created: NOW - 40 * 86400000, time_updated: NOW - 1000, data: row().data },
            // Started inside the window, but written well before it.
            { time_created: NOW - 1000, time_updated: NOW - 40 * 86400000, data: row().data }
          ]
        }),
        close() {}
      };
    }
  });
  const events = await scanner.scan(NOW);
  assert.deepEqual(events.map(event => event.ts), [NOW - 1000]);
});

test('stays quiet when the database is missing or unreadable', async () => {  const missing = new OpenCodeScanner({ dbPath: () => path.join(os.tmpdir(), 'throttle-no-such-opencode.db') });
  assert.equal(missing.available(), false);
  assert.deepEqual(await missing.scan(NOW), []);

  const broken = new OpenCodeScanner({
    dbPath: () => __filename,
    loadDatabase: () => function DatabaseSync() {
      throw new Error('file is not a database');
    }
  });
  assert.deepEqual(await broken.scan(NOW), []);
});

test('reads a real OpenCode database', { skip: sqlite ? false : 'node:sqlite is unavailable' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-opencode-'));
  const file = path.join(dir, 'opencode.db');
  const db = new sqlite.DatabaseSync(file);
  db.exec('create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)');
  const insert = db.prepare('insert into session_message values (?, ?, ?, ?, ?, ?, ?)');
  insert.run('m1', 's1', 'assistant', 1, NOW - 1000, NOW - 1000, row().data);
  insert.run('m2', 's1', 'user', 2, NOW - 900, NOW - 900, '{"text":"hi"}');
  insert.run('m3', 's1', 'assistant', 3, NOW - 800, NOW - 800, row({}, { model: { id: 'glm-5.3', providerID: 'opencode' }, cost: 0.5 }).data);
  db.close();

  const scanner = new OpenCodeScanner({ dbPath: () => file });
  assert.equal(scanner.available(), true);
  const events = await scanner.scan(NOW);
  assert.deepEqual(events.map(event => event.model), ['opencode-go/kimi-k3', 'opencode/glm-5.3']);
  const summary = spend.summarize(spend.aggregate(events, { cost: () => null }, NOW), NOW);
  assert.equal(summary.today.cost.toFixed(2), '1.75');
  assert.equal(summary.today.tokens, 1000 + 100 + 4000 + 250 + 1000 + 100 + 4000 + 250);
  fs.rmSync(dir, { recursive: true, force: true });
});
