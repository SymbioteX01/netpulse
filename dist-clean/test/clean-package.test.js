'use strict';
/*
 * make-clean-package must never copy private data or private fixtures.
 * Builds a fake project in a temp dir; the real repo is not touched.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCleanPackage } = require(path.join(__dirname, '..', 'scripts', 'make-clean-package.js'));

function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('clean package excludes data, reports, Surveys, backups and fixtures/private', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'netpulse-clean-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'netpulse-clean-out-'));
  fs.rmdirSync(out); // buildCleanPackage creates it
  try {
    write(src, 'server.js', '// safe');
    write(src, 'fixtures/commands/ok.txt', 'safe fixture');
    write(src, 'fixtures/scans/verify-pairs.json', '{"resolved":{"ok":true}}');
    write(src, 'docs/API_CONTRACT.md', 'contract');
    // Private things that must NOT appear:
    write(src, 'fixtures/private/raw.txt', 'SECRET-SSID-AND-MAC');
    write(src, 'data/history.json', '[{"ssid":"SECRET-SSID-AND-MAC"}]');
    write(src, 'data/backup/history.json', '[{"ssid":"SECRET-SSID-AND-MAC"}]');
    write(src, 'reports/report_1.html', 'SECRET-SSID-AND-MAC');
    write(src, 'Surveys/proj/points.csv', 'SECRET-SSID-AND-MAC');
    write(src, 'node_modules/pkg/index.js', 'x');
    write(src, '.git/config', 'x');

    buildCleanPackage(src, out);

    // Kept:
    assert.ok(fs.existsSync(path.join(out, 'server.js')), 'server.js copied');
    assert.ok(fs.existsSync(path.join(out, 'fixtures', 'commands', 'ok.txt')), 'safe fixture copied');
    assert.ok(fs.existsSync(path.join(out, 'fixtures', 'scans', 'verify-pairs.json')), 'scan fixture copied');
    // Excluded:
    assert.ok(!fs.existsSync(path.join(out, 'fixtures', 'private')), 'fixtures/private excluded');
    assert.ok(!fs.existsSync(path.join(out, 'reports')), 'reports/ excluded');
    assert.ok(!fs.existsSync(path.join(out, 'Surveys')), 'Surveys/ excluded');
    assert.ok(!fs.existsSync(path.join(out, 'node_modules')), 'node_modules/ excluded');
    assert.ok(!fs.existsSync(path.join(out, '.git')), '.git/ excluded');
    assert.ok(!fs.existsSync(path.join(out, 'data', 'backup')), 'data/backup/ excluded');
    // Fresh empty data files:
    assert.strictEqual(fs.readFileSync(path.join(out, 'data', 'history.json'), 'utf8'), '[]\n');
    assert.strictEqual(fs.readFileSync(path.join(out, 'data', 'surveys.json'), 'utf8'), '[]\n');
    // No surviving file may contain the private marker:
    const leaks = walk(out).filter(p => fs.readFileSync(p, 'utf8').includes('SECRET-SSID-AND-MAC'));
    assert.deepStrictEqual(leaks, [], 'private value leaked into: ' + leaks.join(', '));
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('buildCleanPackage refuses to overwrite without force', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'netpulse-clean-src2-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'netpulse-clean-out2-'));
  try {
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    assert.throws(() => buildCleanPackage(src, out), /already exists/);
    assert.ok(fs.existsSync(out), 'refusal must not delete the existing dir');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
