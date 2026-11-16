'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./helpers/server.js');

const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'scans', 'verify-pairs.json'), 'utf8'));

let srv;
let realDataBefore = null;

function realDataSignature() {
  const dir = path.join(ROOT, 'data');
  const sig = {};
  for (const f of ['history.json', 'surveys.json']) {
    try { const st = fs.statSync(path.join(dir, f)); sig[f] = st.size + ':' + st.mtimeMs; } catch (e) { sig[f] = 'missing'; }
  }
  return sig;
}

function rawGet(hostHeader, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, method: 'GET', headers: { Host: hostHeader } }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  realDataBefore = realDataSignature();
  srv = await startServer();
  assert.ok(srv.ready, 'server failed to start:\n' + srv.getOutput());
});
after(async () => {
  if (srv) await srv.stop();
  if (realDataBefore) assert.deepStrictEqual(realDataSignature(), realDataBefore, 'real data/ folder must not be touched by tests');
});

test('GET /api/health returns NetPulse identity', async () => {
  const j = await (await fetch(srv.base + '/api/health')).json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.name, 'netpulse');
});

test('GET /api/preflight returns the environment probe', async () => {
  const j = await (await fetch(srv.base + '/api/preflight')).json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(typeof j.platform, 'string');
  assert.strictEqual(typeof j.nodeVersion, 'string');
  assert.strictEqual(typeof j.isAdmin, 'boolean');
  assert.ok(['ok', 'blocked', 'unknown'].includes(j.locationPermission));
  assert.strictEqual(typeof j.wlanAvailable, 'boolean');
});

test('forged Host header -> 403 HOST_NOT_ALLOWED', async () => {
  const r = await rawGet('evil.example.com', '/api/health');
  assert.strictEqual(r.status, 403);
  assert.match(r.body, /HOST_NOT_ALLOWED/);
});

test('cross-origin request -> 403 ORIGIN_NOT_ALLOWED', async () => {
  const r1 = await fetch(srv.base + '/api/health', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.strictEqual(r1.status, 403);
  const r2 = await fetch(srv.base + '/api/health', { headers: { Origin: 'http://evil.example.com' } });
  assert.strictEqual(r2.status, 403);
});

test('GET /api/history is allowed (Host guard only blocks bad hosts)', async () => {
  const r = await fetch(srv.base + '/api/history');
  assert.strictEqual(r.status, 200);
});

test('/api/action without confirm:true -> 400 CONFIRM_REQUIRED', async () => {
  const r = await fetch(srv.base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'flush-dns' }) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).code, 'CONFIRM_REQUIRED');
});

test('/api/action unknown action -> 400 UNKNOWN_ACTION', async () => {
  const r = await fetch(srv.base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'nope', confirm: true }) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).code, 'UNKNOWN_ACTION');
});

test('/api/action restore-dns-dhcp with unknown adapter -> 400, no command run', async () => {
  const r = await fetch(srv.base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore-dns-dhcp', adapter: 'Definitely Not An Adapter', confirm: true }) });
  assert.strictEqual(r.status, 400);
  const j = await r.json();
  assert.strictEqual(j.code, 'INVALID_ADAPTER');
  assert.ok(!j.outputs, 'no command output should be returned');
});

test('/api/verify missing ids -> 400', async () => {
  const r = await fetch(srv.base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.strictEqual(r.status, 400);
});

test('/api/verify unknown ids -> 404', async () => {
  const r = await fetch(srv.base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beforeId: 'x', afterId: 'y' }) });
  assert.strictEqual(r.status, 404);
});

test('/api/verify returns each verdict from seeded fixtures', async () => {
  const hist = [];
  for (const key of ['resolved', 'improved', 'unchanged', 'worse', 'inconclusive']) {
    hist.push({ id: pairs[key].before.id, data: pairs[key].before.data });
    hist.push({ id: pairs[key].after.id, data: pairs[key].after.data });
  }
  fs.writeFileSync(path.join(srv.dataDir, 'history.json'), JSON.stringify(hist), 'utf8');
  for (const key of ['resolved', 'improved', 'unchanged', 'worse', 'inconclusive']) {
    const r = await fetch(srv.base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beforeId: pairs[key].before.id, afterId: pairs[key].after.id }) });
    const j = await r.json();
    assert.strictEqual(r.status, 200, key);
    assert.strictEqual(j.verdict, key, 'verdict for ' + key);
  }
});

test('non-Windows host returns 501 UNSUPPORTED_PLATFORM', async () => {
  const s2 = await startServer({ env: { NETPULSE_FORCE_PLATFORM: 'linux' } });
  try {
    assert.ok(s2.ready, 'forced-platform server failed to start:\n' + s2.getOutput());
    for (const method of ['GET', 'POST']) {
      const r = await fetch(s2.base + '/api/scan', { method });
      assert.strictEqual(r.status, 501, method);
      assert.strictEqual((await r.json()).code, 'UNSUPPORTED_PLATFORM');
    }
  } finally {
    await s2.stop();
  }
});

test('non-loopback bind without authToken refuses to start', async () => {
  const child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { NETPULSE_BIND: '192.0.2.1', NETPULSE_PORT: String(srv.port + 1), NETPULSE_NO_OPEN: '1', NETPULSE_AUTH_TOKEN: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', c => out += c);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.strictEqual(code, 1, 'process must exit non-zero; output: ' + out);
  assert.match(out, /authToken/);
});

test('non-loopback bind with authToken: missing token -> 401, valid token -> 200', async () => {
  const s3 = await startServer({ env: { NETPULSE_BIND: '0.0.0.0', NETPULSE_AUTH_TOKEN: 'test-token-123' } });
  try {
    assert.ok(s3.ready, 'auth server failed to start:\n' + s3.getOutput());
    const noTok = await fetch(s3.base + '/api/health');
    assert.strictEqual(noTok.status, 401);
    assert.strictEqual((await noTok.json()).code, 'AUTH_REQUIRED');
    const badTok = await fetch(s3.base + '/api/health', { headers: { 'X-NetPulse-Token': 'wrong' } });
    assert.strictEqual(badTok.status, 401);
    const ok = await fetch(s3.base + '/api/health', { headers: { 'X-NetPulse-Token': 'test-token-123' } });
    assert.strictEqual(ok.status, 200);
  } finally {
    await s3.stop();
  }
});

test('POST /api/scan on Windows (live)', { skip: process.platform !== 'win32' ? 'requires win32' : (process.env.NETPULSE_LIVE_SCAN !== '1' ? 'set NETPULSE_LIVE_SCAN=1 to run the real scan' : false) }, async () => {
  const r = await fetch(srv.base + '/api/scan', { method: 'POST' });
  const j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.data.dataQuality.platform, 'win32');
  assert.ok(j.data.analysis, 'analysis stored with the scan');
});

test('/api/report oversized body -> 413 (no connection reset)', async () => {
  const big = 'x'.repeat(3 * 1024 * 1024);
  const r = await fetch(srv.base + '/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'html', html: big })
  });
  // Regression: the server used to req.destroy() mid-body, so the client saw
  // ECONNRESET instead of a clean 413.
  assert.strictEqual(r.status, 413);
  const j = await r.json();
  assert.strictEqual(j.ok, false);
});

test('history 404 responses carry code NOT_FOUND', async () => {
  const g = await fetch(srv.base + '/api/history/does-not-exist');
  assert.strictEqual(g.status, 404);
  assert.strictEqual((await g.json()).code, 'NOT_FOUND');
  const d = await fetch(srv.base + '/api/history/does-not-exist', { method: 'DELETE' });
  assert.strictEqual(d.status, 404);
  assert.strictEqual((await d.json()).code, 'NOT_FOUND');
});

test('/api/verify metrics expose key, label, unit and direction (contract 3.5)', async () => {
  const hist = [
    { id: pairs.resolved.before.id, data: pairs.resolved.before.data },
    { id: pairs.resolved.after.id, data: pairs.resolved.after.data }
  ];
  fs.writeFileSync(path.join(srv.dataDir, 'history.json'), JSON.stringify(hist), 'utf8');
  const r = await fetch(srv.base + '/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beforeId: pairs.resolved.before.id, afterId: pairs.resolved.after.id })
  });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.metrics) && j.metrics.length > 0, 'metrics present');
  for (const m of j.metrics) {
    assert.ok(typeof m.key === 'string' && m.key.length > 0, 'metric.key');
    assert.ok(typeof m.label === 'string' && m.label.length > 0, 'metric.label');
    assert.ok(typeof m.unit === 'string', 'metric.unit');
    assert.ok(['better', 'worse', 'same'].includes(m.direction), 'metric.direction');
    assert.ok(!('metric' in m), 'contract uses key+label, never a "metric" field');
  }
});

test('static responses carry the strict security headers', async () => {
  const r = await fetch(srv.base + '/');
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/unsafe-eval/.test(csp), 'CSP must not allow unsafe-eval');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
});
