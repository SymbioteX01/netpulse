'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'server.js'));

const FX = path.join(__dirname, '..', 'fixtures', 'commands');
const fx = (name) => fs.readFileSync(path.join(FX, name), 'utf8');

test('parsePing: rttRange and RFC3550-style jitter', () => {
  const p = S.parsePing(fx('ping-success.txt'));
  assert.strictEqual(p.sent, 5);
  assert.strictEqual(p.received, 5);
  assert.strictEqual(p.lossPct, 0);
  assert.strictEqual(p.min, 44);
  assert.strictEqual(p.max, 90);
  assert.strictEqual(p.avg, 54);
  assert.strictEqual(p.rttRange, 46);
  assert.strictEqual(p.jitter, 24); // mean |diff| of 45,48,44,90,47
});

test('parsePing: 100% loss', () => {
  const p = S.parsePing(fx('ping-all-timeout.txt'));
  assert.strictEqual(p.sent, 5);
  assert.strictEqual(p.received, 0);
  assert.strictEqual(p.lossPct, 100);
  assert.strictEqual(p.rttRange, 0);
});

test('parseIpconfig: healthy and APIPA', () => {
  const a = S.parseIpconfig(fx('ipconfig-all.txt'));
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].name, 'Ethernet');
  assert.strictEqual(a[0].ipv4, '192.0.2.50');
  assert.strictEqual(a[0].gateway, '192.0.2.1');
  assert.strictEqual(a[0].mac, '02-00-00-00-00-02');
  assert.strictEqual(a[0].dhcp, true);
  assert.strictEqual(a[0].apipa, false);

  const b = S.parseIpconfig(fx('ipconfig-all-apipa.txt'));
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].ipv4, '169.254.10.20');
  assert.strictEqual(b[0].apipa, true);
  assert.strictEqual(b[0].gateway, null);
});

test('parseWlanInterfaces: connected, blocked, disconnected', () => {
  const conn = S.parseWlanInterfaces(fx('netsh-wlan-interfaces-connected.txt'));
  assert.strictEqual(conn.available, true);
  assert.strictEqual(conn.connected, true);
  assert.strictEqual(conn.data.signalPct, 82);
  assert.strictEqual(conn.data.ssid, 'ExampleNet');
  assert.strictEqual(S.inferBand(conn.data), '2.4 GHz');

  const blocked = S.parseWlanInterfaces(fx('netsh-wlan-interfaces-location-blocked.txt'));
  assert.strictEqual(blocked.available, false);
  assert.strictEqual(blocked.data, null);

  const off = S.parseWlanInterfaces(fx('netsh-wlan-interfaces-disconnected.txt'));
  assert.strictEqual(off.available, false);
  assert.strictEqual(off.connected, false);
});

test('parseNeighbors / parseInterfaces / parseArp / route', () => {
  const n = S.parseNeighbors(fx('netsh-wlan-networks.txt'));
  assert.strictEqual(n.length, 2);
  assert.strictEqual(n[0].ssid, 'ExampleNet');
  assert.strictEqual(n[0].channel, '6');
  assert.strictEqual(n[1].ssid, 'Neighbor-One');

  const ifs = S.parseInterfaces(fx('netsh-interface-show.txt'));
  assert.strictEqual(ifs.length, 2);
  assert.strictEqual(ifs[0].name, 'Ethernet');
  assert.strictEqual(ifs[0].state, 'Connected');

  const arp = S.parseArp(fx('arp-a.txt'));
  assert.strictEqual(arp.length, 2);
  assert.strictEqual(arp[0].ip, '192.0.2.1');
  assert.strictEqual(arp[0].mac, '02-11-22-33-44-55');

  const route = fx('route-print.txt');
  const m = route.split(/\r?\n/).map(l => l.trim()).map(l => l.match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)).find(Boolean);
  assert.ok(m && m[1] === '192.0.2.1');
});

test('parseNslookup: ok and failure', () => {
  const bad = S.parseNslookup(fx('nslookup-fail.txt'));
  assert.strictEqual(bad.status, 'failed');
  const ok = S.parseNslookup(fx('nslookup-ok.txt'));
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.address, '192.0.2.1');
});

test('parseTracert: filtered vs down', () => {
  const filtered = S.parseTracert(fx('tracert-filtered.txt'));
  assert.strictEqual(filtered.hops.length, 4);
  assert.strictEqual(filtered.hops[1].lossPct, 100);
  assert.strictEqual(filtered.hops[2].lossPct, 0);

  const down = S.parseTracert(fx('tracert-down.txt'));
  assert.strictEqual(down.hops[1].lossPct, 100);
  assert.strictEqual(down.hops[2].lossPct, 100);
});

test('locale-garbled input -> empty parses, not faults', () => {
  const g = fx('locale-garbled.txt');
  assert.deepStrictEqual(S.parseIpconfig(g), []);
  assert.strictEqual(S.parseWlanInterfaces(g).data, null);
  assert.deepStrictEqual(S.parseInterfaces(g), []);
  assert.deepStrictEqual(S.parseTracert(g).hops, []);
  assert.deepStrictEqual(S.parseNeighbors(g), []);
});

// ---- Collector tests with an injected fixture runner (no real commands) ----
function makeRunner(overrides) {
  return (cmd, args) => {
    const key = [cmd].concat(args).join(' ');
    for (const k of Object.keys(overrides)) {
      if (key === k || key.startsWith(k)) {
        const v = overrides[k];
        if (typeof v === 'string') return Promise.resolve({ ok: true, out: v, code: 0 });
        return Promise.resolve({ ok: !!v.ok, out: v.out || '', code: v.ok ? 0 : 1 });
      }
    }
    return Promise.resolve({ ok: false, out: cmd + ' unavailable', code: 1 });
  };
}

const BASE = {
  'netsh wlan show interfaces': fx('netsh-wlan-interfaces-disconnected.txt'),
  'netsh wlan show networks': fx('netsh-wlan-networks.txt'),
  'netsh interface show interface': fx('netsh-interface-show.txt'),
  'ipconfig /all': fx('ipconfig-all.txt'),
  'arp -a': fx('arp-a.txt'),
  'route print': fx('route-print.txt'),
  'ping -n 5 -w 2000 192.0.2.1': fx('ping-success.txt'),
  'ping -n 5 -w 2000 8.8.8.8': fx('ping-success.txt'),
  'ping -n 5 -w 2000 1.1.1.1': fx('ping-success.txt'),
  'nslookup google.com': fx('nslookup-ok.txt'),
  'tracert': fx('tracert-filtered.txt')
};

test.afterEach(() => S.setRunner());

test('collector: healthy fixture scan produces dataQuality and Healthy analysis', async () => {
  S.setRunner(makeRunner(BASE));
  const data = await S.runFullScan();
  assert.strictEqual(data.mode, 'lan');
  assert.ok(Array.isArray(data.dataQuality.commands));
  assert.strictEqual(data.dataQuality.locationPermissionBlocked, false);
  assert.deepStrictEqual(data.dataQuality.coreCommandsFailed, []);
  assert.strictEqual(data.dataQuality.commands.every(c => c.ok), true);
  assert.ok(data.analysis);
  assert.strictEqual(data.analysis.status, 'Healthy');
});

test('collector: location-permission message sets flag and no WiFi fault', async () => {
  S.setRunner(makeRunner(Object.assign({}, BASE, {
    'netsh wlan show interfaces': fx('netsh-wlan-interfaces-location-blocked.txt'),
    'netsh wlan show networks': fx('netsh-wlan-interfaces-location-blocked.txt')
  })));
  const data = await S.runFullScan();
  assert.strictEqual(data.dataQuality.locationPermissionBlocked, true);
  assert.ok(data.dataQuality.warnings.length > 0);
  assert.ok(!data.analysis.findings.some(f => f.id === 'wifi-connection-failed'));
});

test('collector: failed core command -> insufficient data, no faults', async () => {
  S.setRunner(makeRunner(Object.assign({}, BASE, {
    'ipconfig /all': { ok: false, out: 'ipconfig is not recognized' }
  })));
  const data = await S.runFullScan();
  assert.deepStrictEqual(data.dataQuality.coreCommandsFailed, ['ipconfig /all']);
  assert.strictEqual(data.analysis.insufficientData, true);
  assert.strictEqual(data.analysis.findings.length, 0);
});
