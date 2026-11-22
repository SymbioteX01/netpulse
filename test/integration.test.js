'use strict';
/*
 * Static integration checks between the UI (js/app.js, js/survey.js,
 * index.html) and the frozen contract (docs/API_CONTRACT.md).
 *
 * These do not run a browser; they guarantee that every API path and error
 * code the UI relies on still exists in the contract, and lock the fix for the
 * /api/verify metrics field (the server sends `key`/`label`, never `metric`).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const app = read('js/app.js');
const survey = read('js/survey.js');
const html = read('index.html');
const contract = read('docs/API_CONTRACT.md');
const ui = app + '\n' + survey;

function apiPaths(src) {
  const set = new Set();
  const re = /['"](\/api\/[^'"]*)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    // strip query and a trailing slash (the contract writes /api/surveys[/:id])
    let p = m[1].split('?')[0].replace(/\/+$/, '');
    if (p) set.add(p);
  }
  return set;
}

test('every /api path used by the UI is documented in the contract', () => {
  const paths = apiPaths(ui);
  assert.ok(paths.size >= 8, 'expected several API paths, found ' + paths.size);
  const missing = [...paths].filter(p => !contract.includes(p));
  assert.deepStrictEqual(missing, [], 'undocumented UI paths: ' + missing.join(', '));
});

test('every error code used by the UI is in the contract error index', () => {
  const codes = new Set();
  const re = /code\s*===\s*'([A-Z][A-Z_]+)'/g;
  let m;
  while ((m = re.exec(ui))) codes.add(m[1]);
  assert.ok(codes.size >= 1, 'expected at least one code check in the UI');
  const missing = [...codes].filter(c => !contract.includes('`' + c + '`'));
  assert.deepStrictEqual(missing, [], 'codes not in contract: ' + missing.join(', '));
});

test('verify metrics renderer reads label/key, never a "metric" field', () => {
  assert.match(app, /esc\(m\.label \|\| m\.key \|\| '--'\)/, 'troubleshoot metrics renderer must read label/key');
  assert.ok(!/\bm\.metric\b/.test(app), 'no renderer may read the non-contract "metric" field');
});

test('index.html loads every UI script and contains no inline script', () => {
  for (const f of ['js/analyzer.js', 'js/scenarios.js', 'js/app.js', 'js/survey.js']) {
    assert.ok(html.includes(f), 'index.html must load ' + f);
  }
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.strictEqual(inline, null, 'index.html must not contain inline <script> blocks (CSP has no unsafe-inline for scripts)');
});

test('CSP is served as a response header with no unsafe-eval', () => {
  const server = read('server.js');
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /script-src 'self'/);
  assert.ok(!/unsafe-eval/.test(server), 'CSP must not allow unsafe-eval');
  // The OSM tile host is allowed for images only (map background).
  assert.match(server, /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(server, /Permissions-Policy.*geolocation=\(self\)/);
});

test('UI globals keep their legacy names', () => {
  const analyzer = read('js/analyzer.js');
  const scenarios = read('js/scenarios.js');
  assert.ok(/root\.NetFaultAnalyzer\s*=/.test(analyzer), 'window.NetFaultAnalyzer preserved');
  assert.ok(/root\.NetFaultScenarios\s*=/.test(scenarios), 'window.NetFaultScenarios preserved');
});
