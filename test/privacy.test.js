'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { makeSanitizer, isDocumentation, isMaskOrSpecial } = require(path.join(ROOT, 'scripts', 'capture-fixtures.js'));
const { tempDir, startServer } = require('./helpers/server.js');

// ---------------------------------------------------------------------------
// .gitignore must keep private + generated data out of any repository.
// ---------------------------------------------------------------------------
test('privacy: .gitignore excludes private and generated data', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const entry of ['data/*.json', 'data/backup/', 'reports/', 'Surveys/', 'fixtures/private/', 'dist-clean/', 'node_modules/']) {
    assert.ok(gi.includes(entry), '.gitignore must contain ' + entry);
  }
});

// ---------------------------------------------------------------------------
// Hand-written fixtures must not contain real private values.
//   - no RFC1918 private IPv4 (10/8, 172.16/12, 192.168/16)
//   - every MAC is locally administered (02:) or the broadcast address
//   - SSIDs use the invented names only
// ---------------------------------------------------------------------------
const PRIVATE_V4 = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./
];
const MAC_RE = /\b([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/g;
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

function fixtureFiles() {
  const dir = path.join(ROOT, 'fixtures', 'commands');
  return fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => ({ name: f, full: path.join(dir, f), text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

test('privacy: fixtures contain no RFC1918 private IPv4 addresses', () => {
  for (const f of fixtureFiles()) {
    const ips = f.text.match(IPV4_RE) || [];
    for (const ip of ips) {
      assert.ok(!PRIVATE_V4.some(re => re.test(ip)), f.name + ' contains private IPv4 ' + ip);
    }
  }
});

test('privacy: every fixture MAC is locally administered (02:) or broadcast', () => {
  for (const f of fixtureFiles()) {
    const macs = f.text.match(MAC_RE) || [];
    for (const mac of macs) {
      const norm = mac.replace(/-/g, ':').toLowerCase();
      assert.ok(
        norm.startsWith('02:') || norm === 'ff:ff:ff:ff:ff:ff',
        f.name + ' contains a non-invented MAC ' + mac
      );
    }
  }
});

test('privacy: fixtures only use invented SSID names', () => {
  const allowed = /^ExampleNet$|^Neighbor-/;
  for (const f of fixtureFiles()) {
    for (const line of f.text.split(/\r?\n/)) {
      const m = line.match(/^\s*SSID\s*\d*\s*:\s*(.+?)\s*$/i);
      if (m) assert.ok(allowed.test(m[1]), f.name + ' uses a non-invented SSID');
    }
    const p = f.text.match(/^\s*SSID\s*\d+\s*:\s*(.+?)\s*$/gim) || [];
    for (const line of p) {
      const v = line.split(':').slice(1).join(':').trim();
      assert.ok(allowed.test(v), f.name + ' uses a non-invented SSID (neighbor list)');
    }
  }
});

// ---------------------------------------------------------------------------
// The sanitizer itself: real values -> documentation ranges, masks preserved.
// ---------------------------------------------------------------------------
test('privacy: sanitizer maps real values into documentation ranges', () => {
  const s = makeSanitizer();
  const input = [
    'SSID                   : MyRealHomeNetwork',
    'BSSID                  : 3c:84:6a:aa:bb:cc',
    'IPv4 Address. . . . .  : 192.168.1.42',
    'Default Gateway . . .  : 10.0.0.1',
    'Subnet Mask . . . . .  : 255.255.255.0'
  ].join('\r\n');
  const out = s.sanitize(input);
  assert.ok(!out.includes('MyRealHomeNetwork'), 'SSID must be replaced');
  assert.strictEqual(s.assertSanitized(out), true);
  assert.ok(/SSID\s*:\s*ExampleNet/.test(out), 'SSID becomes ExampleNet');
  assert.ok(out.includes('255.255.255.0'), 'masks are preserved');
  assert.ok(!out.includes('192.168.1.42') && !out.includes('10.0.0.1'), 'private IPs are replaced');
  for (const ip of out.match(IPV4_RE) || []) {
    assert.ok(isMaskOrSpecial(ip) || isDocumentation(ip), 'remaining IP is documentation/mask: ' + ip);
  }
  for (const mac of out.match(MAC_RE) || []) {
    assert.ok(/^02:00:00:00:00:/i.test(mac), 'MAC becomes an invented one: ' + mac);
  }
});

test('privacy: sanitizer maps the same original value consistently', () => {
  const s = makeSanitizer();
  const a = s.sanitize('IPv4 Address. . . . .  : 192.168.5.5');
  const b = s.sanitize('Default Gateway . . .  : 192.168.5.5');
  const ipOf = (t) => (t.match(IPV4_RE) || [])[0];
  assert.strictEqual(ipOf(a), ipOf(b), 'same original IP maps to the same invented IP');
});

test('privacy: assertSanitized refuses unmasked private values', () => {
  const s = makeSanitizer();
  assert.throws(() => s.assertSanitized('IP: 192.168.1.1'), /Unmasked IPv4/);
  assert.throws(() => s.assertSanitized('MAC: 3c-84-6a-aa-bb-cc'), /Unmasked MAC/);
  // documentation + special values are accepted as-is
  assert.strictEqual(s.assertSanitized('IP: 198.51.100.7 mask 255.255.255.0 link 169.254.1.2'), true);
});

// ---------------------------------------------------------------------------
// Tests must never spawn the server against the real data/ folders.
// ---------------------------------------------------------------------------
test('privacy: tempDir creates directories under the OS temp directory', () => {
  const d = tempDir('netpulse-privacy-');
  try {
    assert.ok(fs.existsSync(d), 'temp dir exists');
    const rel = path.relative(os.tmpdir(), d);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'temp dir lives under os.tmpdir()');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('privacy: startServer defaults to temp data dirs, not the real data/ folder', async () => {
  const srv = await startServer({ noWait: true });
  try {
    for (const [label, dir] of [['dataDir', srv.dataDir], ['surveysDir', srv.surveysDir], ['reportsDir', srv.reportsDir]]) {
      const real = path.join(ROOT, label === 'dataDir' ? 'data' : label === 'surveysDir' ? 'Surveys' : 'reports');
      assert.notStrictEqual(path.resolve(dir), path.resolve(real), label + ' must not point at the real folder');
      const rel = path.relative(os.tmpdir(), path.resolve(dir));
      assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), label + ' lives under os.tmpdir()');
    }
  } finally {
    await srv.stop();
  }
});
