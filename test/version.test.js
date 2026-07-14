const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewerVersion } = require('../src/version');

test('recognizes newer semantic versions and optional v prefixes', () => {
  assert.equal(isNewerVersion('v0.1.3', '0.1.2'), true);
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true);
});

test('rejects equal, older, and malformed versions', () => {
  assert.equal(isNewerVersion('0.1.2', '0.1.2'), false);
  assert.equal(isNewerVersion('0.1.1', '0.1.2'), false);
  assert.equal(isNewerVersion('latest', '0.1.2'), false);
});
