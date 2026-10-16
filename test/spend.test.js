const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PricingCatalog, reduceCatalog, candidateKeys } = require('../src/pricing');
const spend = require('../src/spend');

const SONNET = {
  input_cost_per_token: 3e-6,
  output_cost_per_token: 15e-6,
  cache_read_input_token_cost: 3e-7,
  cache_creation_input_token_cost: 3.75e-6,
  cache_creation_input_token_cost_above_1hr: 6e-6,
  input_cost_per_token_above_200k_tokens: 6e-6,
  output_cost_per_token_above_200k_tokens: 22.5e-6
};

function catalog(models = { 'claude-sonnet-4-5': SONNET, 'gpt-5': { input_cost_per_token: 1.25e-6, output_cost_per_token: 10e-6, cache_read_input_token_cost: 1.25e-7 } }) {
  const pricing = new PricingCatalog({ fetchFn: null });
  pricing.models = models;
  pricing.resolved.clear();
  return pricing;
}

const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime();
const HOUR = 3600 * 1000;

test('keeps only priced first-party models from the LiteLLM catalog', () => {
  const reduced = reduceCatalog({
    'claude-sonnet-4-5': { ...SONNET, max_tokens: 64000, litellm_provider: 'anthropic' },
    'bedrock/claude-sonnet-4-5': SONNET,
    'mistral-large': { input_cost_per_token: 1e-6 },
    'gpt-image-1': { mode: 'image' }
  });
  assert.deepEqual(Object.keys(reduced), ['claude-sonnet-4-5']);
  assert.equal('max_tokens' in reduced['claude-sonnet-4-5'], false);
});

test('normalizes provider prefixes, dates and version separators', () => {
  const keys = candidateKeys('anthropic/claude-sonnet-4.5-20250929');
  assert.ok(keys.includes('claude-sonnet-4.5'));
  assert.ok(keys.includes('claude-sonnet-4-5'));
  assert.ok(candidateKeys('gpt-5-high').includes('gpt-5'));
});

test('prices input, cache and output tokens at their own rates', () => {
  const cost = catalog().cost('claude-sonnet-4-5-20250929', { input: 1000, cacheWrite5m: 1000, cacheWrite1h: 1000, cacheRead: 10000, output: 1000 });
  assert.equal(Math.round(cost * 1e6), 3000 + 3750 + 6000 + 3000 + 15000);
});

test('switches to the long-context tier above 200k prompt tokens', () => {
  const cost = catalog().cost('claude-sonnet-4-5', { input: 250000, output: 1000 });
  assert.equal(Math.round(cost * 1e6), 250000 * 6 + 1000 * 22.5);
});

test('returns null for models with no known price', () => {
  assert.equal(catalog().cost('mystery-model', { input: 10 }), null);
});

test('refresh merges the fetched catalog and writes a cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-pricing-'));
  const pricing = new PricingCatalog({
    cacheDir: dir,
    now: () => NOW,
    fetchFn: async () => ({ ok: true, json: async () => ({ 'claude-new-9': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } }) })
  });
  assert.equal(await pricing.refresh(), true);
  assert.ok(pricing.rates('claude-new-9'));
  assert.equal(await pricing.refresh(), false);
  const reloaded = new PricingCatalog({ cacheDir: dir, fetchFn: null });
  assert.ok(reloaded.rates('claude-new-9'));
});

test('parses Claude usage lines, skipping synthetic models and empty usage', () => {
  const line = JSON.stringify({
    timestamp: new Date(NOW).toISOString(),
    requestId: 'req_1',
    costUSD: 0.5,
    message: { id: 'msg_1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 5 } } }
  });
  const event = spend.parseClaudeLine(line);
  assert.deepEqual(event.tokens, { input: 10, cacheWrite5m: 4, cacheWrite1h: 5, cacheRead: 30, output: 20 });
  assert.equal(event.cost, 0.5);
  assert.equal(event.dedupe, 'msg_1:req_1');
  const synthetic = JSON.parse(line);
  synthetic.message.model = '<synthetic>';
  assert.equal(spend.parseClaudeLine(JSON.stringify(synthetic)).model, null);
  assert.equal(spend.parseClaudeLine('{"message":{"usage":{"input_tokens":0,"output_tokens":0}},"timestamp":"2026-01-01T00:00:00Z"}'), null);
  assert.equal(spend.parseClaudeLine('not json'), null);
});

test('parses Codex token_count events, splitting cached input and skipping repeats', () => {
  const ts = new Date(NOW).toISOString();
  const count = (input, cached, output, total) => JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output }, total_token_usage: total } }
  });
  const text = [
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }),
    count(100, 40, 10, { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 }),
    count(100, 40, 10, { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 }),
    count(50, 0, 5, { input_tokens: 150, cached_input_tokens: 40, output_tokens: 15 })
  ].join('\n');
  const events = spend.parseCodexFile(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].model, 'gpt-5');
  assert.deepEqual(events[0].tokens, { input: 60, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 40, output: 10 });
});

test('maps Cursor usage events to their reported cost', () => {
  const [event] = spend.cursorEvents([{ timestamp: String(NOW), model: 'claude-4.5-sonnet-thinking', tokenUsage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8, totalCents: 123.4 } }]);
  assert.equal(event.cost, 1.234);
  assert.deepEqual(event.tokens, { input: 5, cacheWrite5m: 8, cacheWrite1h: 0, cacheRead: 7, output: 6 });
});

test('dedupes Claude events that appear in more than one log', () => {
  const events = spend.dedupeEvents([{ dedupe: 'a' }, { dedupe: 'a' }, { dedupe: null }, { dedupe: null }]);
  assert.equal(events.length, 3);
});

test('summarizes today, yesterday, 30 days and a daily trend', () => {
  const tokens = { input: 1e5, output: 0 };
  const events = [
    { ts: NOW - HOUR, model: 'claude-sonnet-4-5', tokens, cost: null },
    { ts: NOW - 2 * HOUR, model: 'claude-sonnet-4-5-high', tokens: { input: 0, output: 1e6 }, cost: null },
    { ts: NOW - 24 * HOUR, model: 'gpt-5', tokens, cost: null },
    { ts: NOW - 10 * 24 * HOUR, model: 'gpt-5', tokens, cost: 2 },
    { ts: NOW - 40 * 24 * HOUR, model: 'gpt-5', tokens, cost: 100 },
    { ts: NOW, model: 'mystery', tokens, cost: null }
  ];
  const summary = spend.summarize(spend.aggregate(events, catalog(), NOW), NOW);
  assert.equal(summary.today.cost.toFixed(2), '15.30');
  assert.equal(summary.today.tokens, 1.1e6);
  assert.deepEqual(summary.today.models.map(m => m.name), ['claude-sonnet-4-5']);
  assert.equal(summary.yesterday.cost.toFixed(3), '0.125');
  assert.equal(summary.last30.cost.toFixed(3), '17.425');
  assert.equal(summary.trend.length, 30);
  assert.equal(summary.trend[29].date, spend.dayKey(NOW));
  assert.equal(summary.trend[29].tokens, 1.1e6);
  assert.deepEqual(summary.unpriced, ['mystery']);
});

test('reports no period when nothing happened', () => {
  const summary = spend.summarize(spend.aggregate([], catalog(), NOW), NOW);
  assert.equal(summary.today, null);
  assert.equal(summary.last30, null);
});

test('scans log folders and re-reads only files that changed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'throttle-logs-'));
  const file = path.join(root, 'project', 'session.jsonl');
  fs.mkdirSync(path.dirname(file));
  const line = id => JSON.stringify({ timestamp: new Date().toISOString(), requestId: id, message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } } });
  fs.writeFileSync(file, `${line('a')}\n`);
  const scanner = spend.createClaudeScanner(() => [root]);
  assert.equal((await scanner.scan()).length, 1);
  fs.appendFileSync(file, `${line('b')}\n`);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  assert.equal((await scanner.scan()).length, 2);
});

const claudeLine = id => JSON.stringify({ timestamp: new Date().toISOString(), requestId: id, message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } } });

function logRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `throttle-${prefix}-`));
}

test('resumes an appended log from where it stopped instead of reading it whole', async () => {
  const root = logRoot('append');
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, `${claudeLine('a')}\n${claudeLine('b')}\n`);
  const scanner = spend.createClaudeScanner(() => [root]);
  assert.equal((await scanner.scan()).length, 2);

  const wholeReads = [];
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async (...args) => {
    wholeReads.push(args[0]);
    return readFile(...args);
  };
  try {
    fs.appendFileSync(file, `${claudeLine('c')}\n`);
    assert.equal((await scanner.scan()).length, 3);
  } finally {
    fs.promises.readFile = readFile;
  }
  assert.deepEqual(wholeReads, []);
  assert.equal(scanner.files.get(file).offset, fs.statSync(file).size);
});

test('waits for a whole line before parsing an appended log', async () => {
  const root = logRoot('partial');
  const file = path.join(root, 'session.jsonl');
  const line = claudeLine('a');
  fs.writeFileSync(file, line.slice(0, 20));
  const scanner = spend.createClaudeScanner(() => [root]);
  assert.deepEqual(await scanner.scan(), []);
  fs.appendFileSync(file, `${line.slice(20)}\n`);
  assert.equal((await scanner.scan()).length, 1);
});

test('reads a rewritten or truncated log in full rather than appending to it', async () => {
  const root = logRoot('rewrite');
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, `${claudeLine('a')}\n`);
  const scanner = spend.createClaudeScanner(() => [root]);
  assert.equal((await scanner.scan()).length, 1);

  // Same length, different content: the append path must not swallow it.
  fs.writeFileSync(file, `${claudeLine('z')}\n`);
  const rewritten = await scanner.scan();
  assert.equal(rewritten.length, 1);
  assert.equal(rewritten[0].dedupe, 'z:z');

  // Shorter file: nothing left to resume from.
  fs.writeFileSync(file, `${claudeLine('y')}\n`);
  fs.writeFileSync(file, claudeLine('y').slice(0, 30));
  assert.deepEqual(await scanner.scan(), []);
});

test('carries the Codex repeat-skipping state across appended batches', async () => {
  const root = logRoot('codex-append');
  const file = path.join(root, 'rollout.jsonl');
  const ts = new Date().toISOString();
  const totals = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 };
  const count = (total, input = 100, output = 10) => JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, cached_input_tokens: 40, output_tokens: output }, total_token_usage: total } }
  });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } })}\n${count(totals)}\n`);
  const scanner = spend.createCodexScanner(() => [root]);
  assert.equal((await scanner.scan()).length, 1);

  // The same totals repeated is a no-op, even though it lands in a later batch.
  fs.appendFileSync(file, `${count(totals)}\n`);
  assert.equal((await scanner.scan()).length, 1);

  // No new turn_context in this batch, so the model comes from the carried state.
  fs.appendFileSync(file, `${count({ input_tokens: 150, cached_input_tokens: 40, output_tokens: 15 }, 50, 5)}\n`);
  const events = await scanner.scan();
  assert.equal(events.length, 2);
  assert.equal(events[1].model, 'gpt-5');
  assert.deepEqual(events[1].tokens, { input: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 40, output: 5 });
});
