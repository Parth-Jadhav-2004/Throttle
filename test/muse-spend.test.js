const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const spend = require('../src/spend');
const { MuseScanner, createMuseParser, museSessionsRoots, museEvent, museEventsFromLines } = require('../src/muse-spend');

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;

function record({ id = 'session-1', ms = NOW - MINUTE, model = 'muse-spark-1.3-contributor', kind = 'model_completed', payloadType = 'runtime.session', usage } = {}) {
  return {
    schema_version: 1,
    id: 'a2350769-4fbc-4cfc-9105-f43b8d12b784',
    stream: { kind: 'session', id },
    sequence: 105,
    recorded_at: ms * 1000,
    record_type: 'event',
    durability: 'durable',
    causation_id: null,
    payload_type: payloadType,
    payload_schema_version: 1,
    payload: {
      kind: 'run',
      run_id: '01a149d4-a91e-7000-b4cd-bcc89ebb8d6f',
      event: {
        kind,
        usage: usage || {
          input_tokens: 54945,
          output_tokens: 207,
          cached_tokens: 53745,
          cache_write_tokens: 0,
          cache_read_tokens: 53745,
          reasoning_tokens: 49
        },
        duration_ms: 8851,
        finish_reason: 'tool_calls',
        model
      }
    }
  };
}

test('maps a model_completed record into a spend event with microseconds timestamps', () => {
  const event = museEvent(record());
  assert.equal(event.ts, NOW - MINUTE);
  assert.equal(event.model, 'muse-spark-1.3-contributor');
  assert.equal(event.cost, null);
  // Input is reported including the cached part, so the fresh input is the remainder.
  assert.deepEqual(event.tokens, { input: 1200, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 53745, output: 207 });
});

test('falls back to cached_tokens when cache_read_tokens is absent', () => {
  const event = museEvent(record({ usage: { input_tokens: 100, output_tokens: 10, cached_tokens: 60 } }));
  assert.deepEqual(event.tokens, { input: 40, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 60, output: 10 });
});

test('never lets the cache split exceed the reported input', () => {
  const event = museEvent(record({ usage: { input_tokens: 50, output_tokens: 10, cache_read_tokens: 80 } }));
  assert.deepEqual(event.tokens, { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 50, output: 10 });
});

test('ignores attribution records so the same step is not counted twice', () => {
  const attribution = record({ kind: 'goal_usage_attribution' });
  attribution.payload.event.record = { usage_family: 'provider', quantity: { reported: 54945 } };
  assert.equal(museEvent(attribution), null);
  assert.equal(museEvent(record({ payloadType: 'runtime.other' })), null);
  assert.equal(museEvent(record({ usage: { input_tokens: 0, output_tokens: 0 } })), null);
  assert.equal(museEvent({ payload_type: 'runtime.session', payload: { kind: 'run' }, recorded_at: 'nope' }), null);
});

test('parses the lines of a session stream and skips malformed ones', () => {
  const lines = ['not json', JSON.stringify({ type: 'other' }), JSON.stringify(record()), ''];
  const events = museEventsFromLines(lines);
  assert.equal(events.length, 1);
  const parser = createMuseParser();
  assert.deepEqual(parser.state(), null);
});

test('scans the Muse session store through the shared log scanner', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-sessions-'));
  const day = path.join(home, '2026', '10', '17', '01a149d2');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify(record({ id: '01a149d2' })) + '\n');
  const scanner = new MuseScanner({ roots: () => [home] });
  assert.ok(scanner.available());
  const first = await scanner.scan(NOW);
  assert.equal(first.length, 1);

  // New steps arrive as appended lines; the resumed read must not double-count the prefix.
  fs.appendFileSync(file, JSON.stringify(record({ id: '01a149d2', ms: NOW, sequence: 106, usage: { input_tokens: 300, output_tokens: 50 } })) + '\n'
    + JSON.stringify(record({ id: '01a149d2', ms: NOW, kind: 'goal_usage_attribution' })) + '\n');
  const second = await scanner.scan(NOW);
  assert.equal(second.length, 2);
  const total = second.reduce((sum, event) => sum + spend.totalTokens(event.tokens), 0);
  assert.equal(total, (1200 + 53745 + 207) + (300 + 50));
});

test('stays unavailable when Muse has never run', async () => {
  const scanner = new MuseScanner({ roots: () => [] });
  assert.equal(scanner.available(), false);
  assert.deepEqual(await scanner.scan(NOW), []);
});

test('resolves the session store from the environment overrides', () => {
  const previous = process.env.MUSE_DATA_DIR;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-data-'));
  fs.mkdirSync(path.join(temp, 'sessions'));
  try {
    process.env.MUSE_DATA_DIR = temp;
    assert.deepEqual(museSessionsRoots(), [path.join(temp, 'sessions')]);
  } finally {
    if (previous === undefined) delete process.env.MUSE_DATA_DIR;
    else process.env.MUSE_DATA_DIR = previous;
  }
});

test('prices contributor-tier models from the published base model rate', () => {
  const { PricingCatalog } = require('../src/pricing');
  const pricing = new PricingCatalog({
    fetchFn: null,
    supplement: {
      updated_at: '2026-01-01T00:00:00Z',
      pricing: { 'muse-spark-1.3': { input_per_million: 5, output_per_million: 20, cache_read_per_million: 0.5 } },
      fast_multipliers: {},
      alias_rules: []
    }
  });
  pricing.models = {};
  pricing.resolved.clear();
  const events = [{ ts: NOW, model: 'muse-spark-1.3-contributor', tokens: { input: 1000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 10000, output: 1000 }, cost: null }];
  const days = spend.aggregate(events, pricing, NOW).days;
  const cost = 5e-6 * 1000 + 5e-7 * 10000 + 2e-5 * 1000;
  assert.ok(Math.abs(days[spend.dayKey(NOW)].cost - cost) < 1e-9);
});
