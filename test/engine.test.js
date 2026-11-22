'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'js', 'analyzer.js'));
const S = require(path.join(ROOT, 'js', 'scenarios.js'));

// Explicit expected top finding id + status for all 15 scenarios.
const EXPECT = {
  'lan/lan-healthy': { id: 'no-fault', status: 'Healthy', headline: 'No fault detected' },
  'lan/lan-cable': { id: 'gateway-link-down', status: 'Critical' },
  'lan/lan-congestion': { id: 'network-congestion', status: 'Medium' },
  'lan/lan-duplex': { id: 'gateway-unstable', status: 'High' },
  'lan/lan-dhcp': { id: 'dhcp-unreachable', status: 'Critical' },
  'wifi/wifi-healthy': { id: 'no-fault', status: 'Healthy', headline: 'No fault detected' },
  'wifi/wifi-interference': { id: 'wifi-interference', status: 'High' },
  'wifi/wifi-weak': { id: 'weak-signal', status: 'Medium' },
  'wifi/wifi-auth': { id: 'wifi-connection-failed', status: 'High' },
  'wifi/wifi-users': { id: 'network-congestion', status: 'Medium' },
  'mobile/mob-healthy': { id: 'no-fault', status: 'Healthy', headline: 'No fault detected' },
  'mobile/mob-coverage': { id: 'critical-weak-signal', status: 'Critical' },
  'mobile/mob-apn': { id: 'internet-unreachable', status: 'Critical' },
  'mobile/mob-congestion': { id: 'network-congestion', status: 'Medium' },
  'mobile/mob-tower': { id: 'cellular-outage', status: 'Critical' }
};

test('every scenario has an explicit expected top finding and status', () => {
  const seen = new Set();
  for (const mode of ['lan', 'wifi', 'mobile']) {
    for (const s of S.getScenarios(mode)) {
      seen.add(mode + '/' + s.id);
    }
  }
  assert.deepStrictEqual([...seen].sort(), Object.keys(EXPECT).sort(), 'scenario list and EXPECT table must match');
});

for (const key of Object.keys(EXPECT)) {
  test('scenario ' + key, () => {
    const [mode, id] = key.split('/');
    const data = S.getScenario(mode, id).generate();
    const a = A.analyze(data);
    assert.strictEqual(a.topFindingId, EXPECT[key].id, 'top finding id');
    assert.strictEqual(a.status, EXPECT[key].status, 'status');
    if (EXPECT[key].headline) assert.strictEqual(a.headline, EXPECT[key].headline);
    assert.ok(a.healthScore >= 0 && a.healthScore <= 100, 'health score in range');
  });
}

test('every finding has id, evidenceRefs and disproveIf', () => {
  for (const mode of ['lan', 'wifi', 'mobile']) {
    for (const s of S.getScenarios(mode)) {
      const a = A.analyze(S.getScenario(mode, s.id).generate());
      for (const f of a.findings) {
        assert.ok(typeof f.id === 'string' && f.id.length > 0, 'finding id present');
        assert.ok(Array.isArray(f.evidenceRefs), 'evidenceRefs is an array');
        assert.ok(typeof f.disproveIf === 'string' && f.disproveIf.length > 0, 'disproveIf present');
      }
    }
  }
});

test('insufficient data: no ping data and no gateway -> zero faults', () => {
  const a = A.analyze({ mode: 'lan', connectivity: {} });
  assert.strictEqual(a.insufficientData, true);
  assert.strictEqual(a.findings.length, 0);
  assert.strictEqual(a.headline, 'Insufficient data to diagnose');
});

test('insufficient data: failed core command -> zero faults', () => {
  const a = A.analyze({
    mode: 'lan',
    connectivity: { hasGateway: true, gateway: '192.0.2.1', pings: { gateway: { sent: 5, received: 5, lossPct: 0, received_: 5 } } },
    dataQuality: { platform: 'win32', commands: [{ name: 'ipconfig /all', ok: false, emptyParse: true }], warnings: [], locationPermissionBlocked: false, coreCommandsFailed: ['ipconfig /all'] }
  });
  assert.strictEqual(a.insufficientData, true);
  assert.strictEqual(a.findings.length, 0);
});

test('location permission blocked -> no WiFi connection failed finding', () => {
  const a = A.analyze({
    mode: 'wifi',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: true, internetReachable: true,
      pings: { internet: { sent: 5, received: 5, lossPct: 0, avg: 40 }, alt: { sent: 5, received: 5, lossPct: 0, avg: 38 } }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'ok', lookupMs: 20 },
    trace: { hops: [] },
    interfaces: [],
    dataQuality: { platform: 'win32', commands: [], warnings: ['netsh wlan needs Location permission'], locationPermissionBlocked: true, coreCommandsFailed: [] }
  });
  assert.ok(!a.findings.some(f => f.id === 'wifi-connection-failed'), 'must not report WiFi connection failed');
  assert.ok(a.findings.some(f => f.id === 'location-permission-blocked'), 'should surface the permission problem');
});

test('contradiction: gateway 100% loss but internet reachable', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: false, internetReachable: true,
      pings: {
        gateway: { sent: 5, received: 0, lossPct: 100, avg: null },
        internet: { sent: 5, received: 5, lossPct: 0, avg: 40 },
        alt: { sent: 5, received: 5, lossPct: 0, avg: 38 }
      },
      activeIface: { name: 'Ethernet', ipv4: '192.0.2.50', apipa: false }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'ok', lookupMs: 20 },
    trace: { hops: [] }, interfaces: []
  });
  assert.ok(a.contradictions.length > 0, 'contradiction should be flagged');
  assert.ok(a.findings.some(f => f.id === 'gateway-link-down'));
});

test('ICMP-filtered hop with later hops alive -> icmp-filtered, not link down', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: true, internetReachable: true,
      pings: { gateway: { sent: 5, received: 5, lossPct: 0, avg: 2 }, internet: { sent: 5, received: 5, lossPct: 0, avg: 40 }, alt: { sent: 5, received: 5, lossPct: 0, avg: 38 } },
      activeIface: { name: 'Ethernet', ipv4: '192.0.2.50', apipa: false }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'ok', lookupMs: 20 },
    trace: { hops: [{ hop: 1, lossPct: 0, ip: '192.0.2.1', times: [1, 1, 1] }, { hop: 2, lossPct: 100, ip: 'Request timed out', times: [null, null, null] }, { hop: 3, lossPct: 0, ip: '198.51.100.1', times: [10, 11, 12] }] },
    interfaces: []
  });
  assert.ok(a.findings.some(f => f.id === 'icmp-filtered'), 'icmp-filtered');
  assert.ok(!a.findings.some(f => f.id === 'router-link-down'), 'not a link-down fault');
});

test('APIPA -> DHCP unreachable', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: false, gatewayReachable: false, internetReachable: false,
      pings: { internet: { sent: 5, received: 0, lossPct: 100 }, alt: { sent: 5, received: 0, lossPct: 100 } },
      activeIface: { name: 'Ethernet', ipv4: '169.254.10.20', apipa: true }
    },
    dns: { status: 'failed' }, trace: { hops: [] }, interfaces: []
  });
  assert.strictEqual(a.topFindingId, 'dhcp-unreachable');
});

test('DNS: default fails but public resolves -> dns-default-failing', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: true, internetReachable: true,
      pings: { gateway: { sent: 5, received: 5, lossPct: 0, avg: 2 }, internet: { sent: 5, received: 5, lossPct: 0, avg: 40 }, alt: { sent: 5, received: 5, lossPct: 0, avg: 38 } },
      activeIface: { name: 'Ethernet', ipv4: '192.0.2.50', apipa: false }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'failed', lookupMs: 4000, tests: [{ server: '192.0.2.1', ok: false }, { server: '8.8.8.8', ok: true }] },
    trace: { hops: [] }, interfaces: []
  });
  assert.ok(a.findings.some(f => f.id === 'dns-default-failing'));
  assert.ok(!a.findings.some(f => f.id === 'dns-all-failing'));
});

test('DNS: all servers fail -> dns-all-failing', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: true, internetReachable: true,
      pings: { gateway: { sent: 5, received: 5, lossPct: 0, avg: 2 }, internet: { sent: 5, received: 5, lossPct: 0, avg: 40 }, alt: { sent: 5, received: 5, lossPct: 0, avg: 38 } },
      activeIface: { name: 'Ethernet', ipv4: '192.0.2.50', apipa: false }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'failed', lookupMs: 4000, tests: [{ server: '192.0.2.1', ok: false }, { server: '8.8.8.8', ok: false }, { server: '1.1.1.1', ok: false }] },
    trace: { hops: [] }, interfaces: []
  });
  assert.ok(a.findings.some(f => f.id === 'dns-all-failing'));
});

test('DNS: no tests -> legacy dns-resolution-failure', () => {
  const a = A.analyze({
    mode: 'lan',
    wifi: { available: false, connected: false, data: null },
    connectivity: {
      hasGateway: true, gateway: '192.0.2.1', gatewayReachable: true, internetReachable: true,
      pings: { gateway: { sent: 5, received: 5, lossPct: 0, avg: 2 }, internet: { sent: 5, received: 5, lossPct: 0, avg: 40 }, alt: { sent: 5, received: 5, lossPct: 0, avg: 38 } },
      activeIface: { name: 'Ethernet', ipv4: '192.0.2.50', apipa: false }
    },
    dns: { server: '192.0.2.1', address: '192.0.2.1', status: 'failed', lookupMs: 4000 },
    trace: { hops: [] }, interfaces: []
  });
  assert.ok(a.findings.some(f => f.id === 'dns-resolution-failure'));
});

test('pctToDbmNumber is numeric and labelled an estimate', () => {
  assert.strictEqual(typeof A.pctToDbmNumber(100), 'number');
  assert.strictEqual(A.pctToDbmNumber(100), -50);
  assert.strictEqual(A.pctToDbmNumber(50), -70);
  assert.match(A.pctToDbm(50), /approx/);
});

test('analyzer is UMD: browser global and CommonJS both work', () => {
  assert.strictEqual(typeof A.analyze, 'function');
  const code = fs.readFileSync(path.join(ROOT, 'js', 'analyzer.js'), 'utf8');
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  assert.strictEqual(typeof ctx.self.NetFaultAnalyzer.analyze, 'function');
  assert.strictEqual(ctx.self.NetFaultAnalyzer.pctToDbmNumber(100), -50);
});
