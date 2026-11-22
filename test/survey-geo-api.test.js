'use strict';
/*
 * Server-side contract tests for the geo/survey work:
 *   - POST/PUT /api/surveys validation (shared geo-core validator)
 *   - legacy survey records round-trip and are never rewritten by a GET
 *   - GET /api/wifi/signal (in-process fixtures via setRunner)
 *   - POST /api/surveys/batch = ONE write / ONE backup, rejected indices
 *   - CSP tile-host rule and vendored static paths
 *   - exports keep the frozen column order with the new fields present
 *
 * HTTP tests run against a child server with a TEMP data dir; the signal tests
 * load server.js in-process and inject fixtures through the existing runner
 * seam, exactly like test/parsers.test.js.
 */
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./helpers/server.js');
const S = require('../server.js');

const FX = path.join(ROOT, 'fixtures', 'commands');
const fx = (name) => fs.readFileSync(path.join(FX, name), 'utf8');

let srv;
before(async () => {
  srv = await startServer();
  assert.ok(srv.ready, 'server failed to start:\n' + srv.getOutput());
});
after(async () => { if (srv) await srv.stop(); });
afterEach(() => S.setRunner());

const SURVEYS_FILE = () => path.join(srv.dataDir, 'surveys.json');
const BACKUP_DIR = () => path.join(srv.dataDir, 'backup');
function writeSurveysRaw(list) { fs.writeFileSync(SURVEYS_FILE(), JSON.stringify(list, null, 2), 'utf8'); }
function readSurveysRaw() { return JSON.parse(fs.readFileSync(SURVEYS_FILE(), 'utf8')); }
function post(p, body) { return fetch(srv.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function put(p, body) { return fetch(srv.base + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

// ---------------------------------------------------------------- validation

test('POST /api/surveys validates coordinates/signal/source/timestamp', async () => {
  writeSurveysRaw([]);
  const bad = [
    { lat: 28.6 },                       // only half a coordinate
    { lng: 77.2 },
    { lat: '28.6', lng: '77.2' },        // numeric strings
    { lat: 91, lng: 77 },                // latitude out of range
    { lat: 28, lng: -181 },              // longitude out of range
    { lat: 0, lng: 0 },                  // null island
    { signalPct: 150 },                  // out of range
    { signalPct: '70' },                 // wrong type
    { gpsAccuracyM: -1 },                // negative accuracy
    { locationSource: 'gps' },           // unknown source
    { timestamp: 'not-a-date' }
  ];
  for (const body of bad) {
    const r = await post('/api/surveys', body);
    assert.strictEqual(r.status, 400, 'expected 400 for ' + JSON.stringify(body));
    const j = await r.json();
    assert.strictEqual(j.ok, false);
    assert.ok(typeof j.error === 'string' && j.error.length > 0, 'error message present');
  }
  assert.deepStrictEqual(readSurveysRaw(), [], 'no invalid point may be persisted');
});

test('POST /api/surveys accepts valid data and keeps unknown legacy fields', async () => {
  writeSurveysRaw([]);
  const r = await post('/api/surveys', {
    locationName: 'Lobby', lat: 28.6, lng: 77.2, signalPct: 70,
    gpsAccuracyM: 12, locationSource: 'browser-geolocation',
    measurementMode: 'live-signal', signalSource: 'netsh-wlan',
    someLegacyField: 'kept'
  });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.survey.locationName, 'Lobby');
  assert.strictEqual(j.survey.lat, 28.6);
  assert.strictEqual(j.survey.someLegacyField, 'kept');
  assert.ok(j.survey.id, 'server assigns an id');
  assert.ok(!isNaN(Date.parse(j.survey.timestamp)), 'server assigns a timestamp');
});

// --------------------------------------------------------------- legacy data

test('legacy records round-trip deep-equal and a GET never rewrites the file', async () => {
  const legacy = [
    { id: 'L1', locationName: 'legacy no coords', ssid: 'Old', signalPct: null, timestamp: '2020-01-02T03:04:05.000Z' },
    { id: 'L2', locationName: 'legacy coords', lat: 28.6, lng: 77.2, signalPct: 40, timestamp: '2020-01-02T04:00:00.000Z' },
    { id: 'L3', locationName: 'legacy no accuracy', lat: 28.7, lng: 77.3, signalPct: 10, timestamp: '2020-01-03T00:00:00.000Z' }
  ];
  writeSurveysRaw(legacy);
  const beforeTxt = fs.readFileSync(SURVEYS_FILE(), 'utf8');
  const beforeMtime = fs.statSync(SURVEYS_FILE()).mtimeMs;

  const j1 = await (await fetch(srv.base + '/api/surveys')).json();
  assert.strictEqual(j1.surveys.length, 3);
  const byId1 = {};
  j1.surveys.forEach(s => { byId1[s.id] = s; });
  for (const l of legacy) assert.deepStrictEqual(byId1[l.id], l, 'legacy record changed on read');

  assert.strictEqual(fs.readFileSync(SURVEYS_FILE(), 'utf8'), beforeTxt, 'GET must not rewrite surveys.json');
  assert.strictEqual(fs.statSync(SURVEYS_FILE()).mtimeMs, beforeMtime, 'GET must not touch surveys.json');

  const r = await post('/api/surveys', { locationName: 'new point', lat: 28.8, lng: 77.4, signalPct: 55 });
  assert.strictEqual(r.status, 200);
  const j2 = await (await fetch(srv.base + '/api/surveys')).json();
  const byId2 = {};
  j2.surveys.forEach(s => { byId2[s.id] = s; });
  for (const l of legacy) assert.deepStrictEqual(byId2[l.id], l, 'adding a point must not alter legacy entries');
});

test('PUT clears coordinates explicitly and accepts partial patches', async () => {
  writeSurveysRaw([{ id: 'P1', locationName: 'x', lat: 28.6, lng: 77.2, signalPct: 50, timestamp: '2020-01-01T00:00:00.000Z' }]);

  let r = await put('/api/surveys/P1', { locationName: 'renamed' });
  assert.strictEqual(r.status, 200);
  let j = await r.json();
  assert.strictEqual(j.survey.locationName, 'renamed');
  assert.strictEqual(j.survey.lat, 28.6, 'a partial patch leaves coordinates alone');

  r = await put('/api/surveys/P1', { lat: null, lng: null });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.survey.lat, null);
  assert.strictEqual(j.survey.lng, null);

  r = await put('/api/surveys/P1', { signalPct: 300 });
  assert.strictEqual(r.status, 400);
  r = await put('/api/surveys/P1', { lat: 5 });
  assert.strictEqual(r.status, 400, 'a half coordinate patch is rejected');
});

// ------------------------------------------------------------------- batch

test('POST /api/surveys/batch persists many points with exactly ONE backup', async () => {
  // Start from an empty backup dir so the count is unambiguous.
  try { fs.rmSync(BACKUP_DIR(), { recursive: true, force: true }); } catch (e) { /* fine */ }
  writeSurveysRaw([{ id: 'seed', timestamp: '2020-01-01T00:00:00.000Z' }]);

  const points = [];
  for (let i = 0; i < 25; i++) {
    points.push({
      lat: 28.6 + i * 0.0001, lng: 77.2, signalPct: 70, gpsAccuracyM: 10,
      locationSource: 'browser-geolocation',
      timestamp: new Date(Date.now() + i * 1000).toISOString()
    });
  }
  const r = await post('/api/surveys/batch', { sessionId: 'SES1', sessionName: 'Run 1', points });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.saved, 25);
  assert.deepStrictEqual(j.rejected, []);

  // Exactly ONE backup file, and it captured the PRE-batch state. A second
  // writeSurveys() call would have overwritten it with the post-write state.
  const backups = fs.readdirSync(BACKUP_DIR());
  assert.strictEqual(backups.length, 1, '25 points must cost exactly one backup');
  const backupContent = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR(), backups[0]), 'utf8'));
  assert.strictEqual(backupContent.length, 1, 'the backup must be the pre-batch state (=> exactly one write)');
  assert.strictEqual(backupContent[0].id, 'seed');

  const stored = readSurveysRaw();
  assert.strictEqual(stored.length, 26);
  assert.strictEqual(stored.filter(s => s.sessionId === 'SES1').length, 25);
  assert.strictEqual(stored[0].sessionId, 'SES1', 'batch metadata is applied to points');
  assert.strictEqual(stored[0].sessionName, 'Run 1');
});

test('batch reports rejected indices and still saves the rest', async () => {
  writeSurveysRaw([]);
  const points = [
    { lat: 28.6, lng: 77.2, signalPct: 70 },
    { lat: 0, lng: 0, signalPct: 10 },     // index 1: null island
    { signalPct: 500 },                    // index 2: bad signal
    { lat: 28.7, lng: 77.3, signalPct: 40 } // index 3: ok
  ];
  const r = await post('/api/surveys/batch', { sessionId: 'S2', points });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.saved, 2);
  assert.deepStrictEqual(j.rejected.map(x => x.index).sort((a, b) => a - b), [1, 2]);
  assert.ok(j.rejected[0].errors.length > 0, 'rejection carries reasons');
  assert.strictEqual(readSurveysRaw().filter(s => s.sessionId === 'S2').length, 2);
});

test('batch rejects a non-array points field and an oversized batch', async () => {
  let r = await post('/api/surveys/batch', { sessionId: 'x', points: 'nope' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).ok, false);

  const many = new Array(2001).fill({ lat: 28.6, lng: 77.2, signalPct: 70 });
  r = await post('/api/surveys/batch', { points: many });
  assert.strictEqual(r.status, 400);
});

// ------------------------------------------------------- /api/wifi/signal

function runnerFor(map) {
  return (cmd, args) => {
    const key = [cmd].concat(args).join(' ');
    for (const k of Object.keys(map)) {
      if (key === k || key.startsWith(k)) {
        const v = map[k];
        if (typeof v === 'string') return Promise.resolve({ ok: true, out: v, code: 0 });
        return Promise.resolve({ ok: !!v.ok, out: v.out || '', code: v.ok ? 0 : 1 });
      }
    }
    return Promise.resolve({ ok: false, out: cmd + ' unavailable', code: 1 });
  };
}

test('getWifiSignal maps the connected / disconnected / blocked / missing fixtures', async () => {
  S.setRunner(runnerFor({ 'netsh wlan show interfaces': fx('netsh-wlan-interfaces-connected.txt') }));
  const conn = await S.getWifiSignal();
  assert.strictEqual(conn.ok, true);
  assert.strictEqual(conn.available, true);
  assert.strictEqual(conn.connected, true);
  assert.strictEqual(conn.ssid, 'ExampleNet');
  assert.strictEqual(conn.bssid, '02:11:22:33:44:55');
  assert.strictEqual(conn.channel, '6');
  assert.strictEqual(conn.band, '2.4 GHz');
  assert.strictEqual(conn.signalPct, 82);
  assert.strictEqual(conn.source, 'netsh');
  assert.strictEqual(conn.reason, null);
  assert.ok(!isNaN(Date.parse(conn.measuredAt)));

  S.setRunner(runnerFor({ 'netsh wlan show interfaces': fx('netsh-wlan-interfaces-disconnected.txt') }));
  const off = await S.getWifiSignal();
  assert.strictEqual(off.available, true);
  assert.strictEqual(off.connected, false);
  assert.strictEqual(off.signalPct, null);
  assert.strictEqual(off.reason, 'not-connected');

  S.setRunner(runnerFor({ 'netsh wlan show interfaces': fx('netsh-wlan-interfaces-location-blocked.txt') }));
  const blocked = await S.getWifiSignal();
  assert.strictEqual(blocked.available, false);
  assert.strictEqual(blocked.connected, false);
  assert.strictEqual(blocked.signalPct, null);
  assert.strictEqual(blocked.reason, 'location-blocked');

  S.setRunner(runnerFor({ 'netsh wlan show interfaces': { ok: false, out: 'netsh is not recognized as an internal command' } }));
  const none = await S.getWifiSignal();
  assert.strictEqual(none.available, false);
  assert.strictEqual(none.reason, 'wlan-unavailable');
});

test('getWifiSignal never fabricates a signal on a non-Windows platform', async () => {
  const prev = process.env.NETPULSE_FORCE_PLATFORM;
  process.env.NETPULSE_FORCE_PLATFORM = 'linux';
  try {
    S.setRunner(runnerFor({ 'netsh wlan show interfaces': fx('netsh-wlan-interfaces-connected.txt') }));
    const res = await S.getWifiSignal();
    assert.strictEqual(res.reason, 'unsupported-platform');
    assert.strictEqual(res.available, false);
    assert.strictEqual(res.connected, false);
    assert.strictEqual(res.signalPct, null);
    assert.strictEqual(res.ssid, null);
  } finally {
    if (prev === undefined) delete process.env.NETPULSE_FORCE_PLATFORM; else process.env.NETPULSE_FORCE_PLATFORM = prev;
    S.setRunner();
  }
});

test('GET /api/wifi/signal responds with the documented shape', async () => {
  const r = await fetch(srv.base + '/api/wifi/signal');
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, true);
  for (const k of ['available', 'connected', 'ssid', 'bssid', 'band', 'channel', 'signalPct', 'source', 'measuredAt', 'reason']) {
    assert.ok(k in j, 'missing key ' + k);
  }
  assert.strictEqual(j.source, 'netsh');
  assert.ok([null, 'unsupported-platform', 'wlan-unavailable', 'location-blocked', 'not-connected'].includes(j.reason), 'reason=' + j.reason);
  assert.ok(!isNaN(Date.parse(j.measuredAt)));
});

// --------------------------------------------------------------- CSP / statics

test('CSP allows OSM tiles for images only and keeps script-src self', async () => {
  const r = await fetch(srv.base + '/');
  const csp = r.headers.get('content-security-policy') || '';
  const imgSrc = (csp.match(/img-src ([^;]+)/) || [])[1] || '';
  const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert.match(imgSrc, /https:\/\/tile\.openstreetmap\.org/, 'OSM tile host allowed for images');
  assert.ok(!/tile\.openstreetmap\.org/.test(scriptSrc), 'tile host must NOT be a script source');
  assert.match(scriptSrc, /'self'/);
  assert.ok(!/unsafe-eval/.test(csp), 'no unsafe-eval');
  assert.strictEqual(r.headers.get('permissions-policy'), 'geolocation=(self)');
});

function walkFiles(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, base + '/' + name, out);
    else out.push(base + '/' + name);
  }
  return out;
}

test('/js and /css subtrees are served (vendored assets included when present)', async (t) => {
  const r = await fetch(srv.base + '/js/geo-core.js');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);

  const vendor = [];
  for (const dir of ['js/vendor', 'css/vendor']) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walkFiles(abs, '/' + dir, vendor);
  }
  if (!vendor.length) { t.skip('no vendored assets present'); return; }
  for (const rel of vendor) {
    const res = await fetch(srv.base + rel);
    assert.strictEqual(res.status, 200, rel + ' must be served by the static handler');
  }
});

// ------------------------------------------------------------------ exports

test('CSV export keeps the frozen column order with the new fields present', async () => {
  writeSurveysRaw([]);
  const created = (await (await post('/api/surveys', {
    locationName: 'export test', ssid: 'ExampleNet', signalPct: 70,
    lat: 28.6, lng: 77.2, gpsAccuracyM: 9.5, locationSource: 'browser-geolocation',
    measurementMode: 'live-signal', signalSource: 'netsh-wlan',
    sessionId: 'SES-X', sessionName: 'Run X'
  })).json()).survey;

  const ex = await post('/api/export', { format: 'csv', ids: [created.id] });
  assert.strictEqual(ex.status, 200);
  const ej = await ex.json();
  assert.strictEqual(ej.ok, true, JSON.stringify(ej));
  assert.ok(Array.isArray(ej.files) && ej.files.length === 1);

  const csv = fs.readFileSync(ej.files[0], 'utf8').replace(/^\ufeff/, '');
  const lines = csv.split(/\r?\n/);
  const expected = 'ID,Location,SSID,BSSID,Band,Channel,RSSI (dBm),Signal (%),Quality,TX (Mbps),RX (Mbps),Standard,Security,Download (Mbps),Upload (Mbps),Ping (ms),Jitter (ms),Packet Loss (%),Latitude,Longitude,Network Type,LAN Link Speed,Distance (m),Timestamp,Notes';
  assert.strictEqual(lines[0], expected, 'export column order is frozen');
  assert.strictEqual((lines[1].match(/,/g) || []).length, 24, 'new fields must not add CSV columns');
});
