'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/server.js');

let srv;
before(async () => {
  srv = await startServer();
  assert.ok(srv.ready, 'server failed to start:\n' + srv.getOutput());
});
after(async () => { if (srv) await srv.stop(); });

test('survey CRUD + exports round-trip', async () => {
  const survey = {
    locationName: 'Test - Lobby', ssid: 'ExampleNet', bssid: '02:00:00:00:00:01', band: '2.4 GHz', channel: '6',
    rssiDbm: -55, signalPct: 70, quality: 'Good', linkTx: 130, linkRx: 65, standard: '802.11n',
    security: 'WPA2-Personal', download: 120.5, upload: 40.2, ping: 12, jitter: 3.5, packetLoss: 0,
    lat: 28.6139, lng: 77.209, networkType: 'WiFi', lanStatus: 'Disconnected', distanceM: 4.0,
    notes: 'unit test', timestamp: new Date().toISOString()
  };
  const created = await (await fetch(srv.base + '/api/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(survey) })).json();
  assert.strictEqual(created.ok, true);
  const id = created.survey.id;
  assert.ok(id);

  const list = await (await fetch(srv.base + '/api/surveys')).json();
  assert.ok(list.surveys.some(s => s.id === id));

  const upd = await (await fetch(srv.base + '/api/surveys/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationName: 'Test - Lobby (renamed)' }) })).json();
  assert.strictEqual(upd.ok, true);
  assert.strictEqual(upd.survey.locationName, 'Test - Lobby (renamed)');

  const exported = {};
  for (const fmt of ['csv', 'xlsx', 'json', 'pdf', 'kml']) {
    const ex = await (await fetch(srv.base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: fmt, folder: 'UnitTest', ids: [id] }) })).json();
    assert.strictEqual(ex.ok, true, fmt);
    assert.strictEqual(ex.files.length, 1, fmt);
    assert.ok(ex.files[0].startsWith(srv.surveysDir), fmt + ' written inside temp surveys dir');
    exported[fmt] = ex.files[0];
  }

  const csv = fs.readFileSync(exported.csv, 'utf8');
  assert.ok(csv.includes('Test - Lobby (renamed)'));
  assert.match(exported.csv, /Survey_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/);

  const xlsx = fs.readFileSync(exported.xlsx);
  assert.deepStrictEqual([...xlsx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const json = JSON.parse(fs.readFileSync(exported.json, 'utf8'));
  assert.strictEqual(json.count, 1);

  const pdf = fs.readFileSync(exported.pdf);
  assert.strictEqual(pdf.slice(0, 5).toString('latin1'), '%PDF-');

  const kml = fs.readFileSync(exported.kml, 'utf8');
  assert.ok(kml.includes('<kml'));
  assert.ok(kml.includes('NetPulse Wi-Fi Survey'), 'KML document name uses the new product name');

  const del = await (await fetch(srv.base + '/api/surveys/' + id, { method: 'DELETE' })).json();
  assert.strictEqual(del.ok, true);
});

test('speedtest data and upload', async () => {
  const dl = await fetch(srv.base + '/api/speedtest/data?bytes=1048576');
  const buf = Buffer.from(await dl.arrayBuffer());
  assert.strictEqual(buf.length, 1048576);

  const payload = Buffer.alloc(1048576, 7);
  const up = await (await fetch(srv.base + '/api/speedtest/upload', { method: 'POST', body: payload })).json();
  assert.strictEqual(up.ok, true);
  assert.strictEqual(up.bytes, 1048576);
});

test('export with unknown id is refused', async () => {
  const ex = await (await fetch(srv.base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'csv', ids: ['no-such-id'] }) })).json();
  assert.strictEqual(ex.ok, false);
});
