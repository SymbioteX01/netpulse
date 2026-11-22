'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./helpers/server.js');

const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'scans', 'verify-pairs.json'), 'utf8'));

let srv;
before(async () => {
  srv = await startServer();
  assert.ok(srv.ready, 'server failed to start:\n' + srv.getOutput());
});
after(async () => { if (srv) await srv.stop(); });

test('history: list, item, 404, delete', async () => {
  const entry = { id: 'HIST-1', data: pairs.resolved.after.data };
  entry.data.analysis = { status: 'Healthy', healthScore: 100, headline: 'No fault detected', findings: [] };
  fs.writeFileSync(path.join(srv.dataDir, 'history.json'), JSON.stringify([entry]), 'utf8');

  const list = await (await fetch(srv.base + '/api/history')).json();
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.list.length, 1);
  assert.strictEqual(list.list[0].id, 'HIST-1');
  assert.strictEqual(list.list[0].status, 'Healthy');
  assert.strictEqual(list.list[0].headline, 'No fault detected');

  const item = await (await fetch(srv.base + '/api/history/HIST-1')).json();
  assert.strictEqual(item.ok, true);
  assert.ok(item.data.connectivity);

  const miss = await fetch(srv.base + '/api/history/__missing__');
  assert.strictEqual(miss.status, 404);

  const del = await (await fetch(srv.base + '/api/history/HIST-1', { method: 'DELETE' })).json();
  assert.strictEqual(del.ok, true);
  const final = await (await fetch(srv.base + '/api/history')).json();
  assert.strictEqual(final.list.length, 0);
});

test('report: html and pdf are written to the temp reports dir', async () => {
  const html = await (await fetch(srv.base + '/api/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'html', html: '<h1>Test Report</h1>' })
  })).json();
  assert.strictEqual(html.ok, true);
  assert.ok(html.path.startsWith(srv.reportsDir), 'html written inside temp reports dir');
  assert.ok(fs.existsSync(html.path));

  const pdf = await (await fetch(srv.base + '/api/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'pdf', json: { data: pairs.resolved.after.data, analysis: { status: 'Healthy', healthScore: 100, osiLayer: null, findings: [] } } })
  })).json();
  assert.strictEqual(pdf.ok, true);
  assert.ok(pdf.path.startsWith(srv.reportsDir));
  assert.strictEqual(fs.readFileSync(pdf.path).slice(0, 4).toString('ascii'), '%PDF');
});

test('action flush-dns with confirm returns outputs', async () => {
  const act = await (await fetch(srv.base + '/api/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'flush-dns', confirm: true })
  })).json();
  assert.strictEqual(act.ok, true);
  assert.ok(Array.isArray(act.outputs));
  assert.strictEqual(act.outputs[0].cmd, 'ipconfig /flushdns');
});
