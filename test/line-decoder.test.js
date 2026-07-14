const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonLineDecoder } = require('../src/codex-client');

test('decodes split JSONL chunks and skips blank lines', () => {
  const d = new JsonLineDecoder();
  assert.deepEqual(d.push('{"id":1'), []);
  assert.deepEqual(d.push('}\n\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
});

test('reports malformed JSON without losing later messages', () => {
  const errors = [];
  const d = new JsonLineDecoder(e => errors.push(e));
  assert.deepEqual(d.push('bad\n{"ok":true}\n'), [{ ok: true }]);
  assert.equal(errors.length, 1);
});
