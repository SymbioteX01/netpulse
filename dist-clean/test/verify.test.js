'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'server.js'));

const pairs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scans', 'verify-pairs.json'), 'utf8'));

const EXPECT = { resolved: 'resolved', improved: 'improved', unchanged: 'unchanged', worse: 'worse', inconclusive: 'inconclusive' };

for (const key of Object.keys(EXPECT)) {
  test('verify verdict from fixtures: ' + key, () => {
    const pair = pairs[key];
    const v = S.buildVerification(pair.before, pair.after);
    assert.strictEqual(v.verdict, EXPECT[key]);
    assert.ok(Array.isArray(v.metrics) && v.metrics.length > 0, 'metrics present');
    for (const m of v.metrics) {
      assert.ok(['better', 'worse', 'same'].includes(m.direction), 'direction valid for ' + m.key);
      assert.ok(typeof m.key === 'string' && typeof m.label === 'string' && typeof m.unit === 'string');
    }
  });
}

test('verify: resolved reports the resolved finding id', () => {
  const v = S.buildVerification(pairs.resolved.before, pairs.resolved.after);
  assert.deepStrictEqual(v.resolvedFindingIds, ['gateway-unstable']);
  assert.deepStrictEqual(v.newFindingIds, []);
  const health = v.metrics.find(m => m.key === 'healthScore');
  assert.strictEqual(health.direction, 'better');
});

test('verify: worse reports the new finding id', () => {
  const v = S.buildVerification(pairs.worse.before, pairs.worse.after);
  assert.deepStrictEqual(v.newFindingIds, ['gateway-unstable']);
});

test('verify: inconclusive explains why', () => {
  const v = S.buildVerification(pairs.inconclusive.before, pairs.inconclusive.after);
  assert.strictEqual(v.verdict, 'inconclusive');
  assert.ok(v.reasons.length > 0);
});
