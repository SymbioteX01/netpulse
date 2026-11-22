'use strict';
/*
 * Rule coverage for js/analyzer.js.
 *
 * For every stable finding id in docs/API_CONTRACT.md (section 3.4) there is at
 * least one case where the rule FIRES and one NEAR-MISS where it must NOT fire.
 * The near-miss is built from an otherwise-healthy baseline so a match can only
 * come from the mutation under test.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'js', 'analyzer.js'));

function ping(lossPct, avg, range) {
  const sent = 5;
  const lost = Math.round(sent * lossPct / 100);
  const received = sent - lost;
  const times = [];
  for (let i = 0; i < received; i++) times.push(avg);
  return {
    sent, received, lost, lossPct,
    unreachable: 0, timeouts: lost,
    min: received ? Math.max(0, avg - 1) : null,
    max: received ? avg + 1 : null,
    avg: received ? avg : null,
    jitter: range, rttRange: range, times
  };
}

// Healthy baseline: no rule fires (see the 'no-fault' row below).
function base() {
  return {
    mode: 'wifi',
    wifi: { available: true, connected: true, data: { ssid: 'TestNet', signalPct: 80, channel: '6', band: '2.4 GHz' } },
    neighbors: [],
    interfaces: [],
    ipconfig: [],
    arp: [],
    dns: { server: 'dns.google', address: '8.8.8.8', status: 'ok', lookupMs: 20, tests: [{ server: '8.8.8.8', ok: true }] },
    mtu: { payload: 1472, mtu: 1500, note: null },
    ipv6: { enabled: true, loopbackOk: true, internetOk: true },
    trace: { hops: [] },
    connectivity: {
      gateway: '192.168.1.1', hasGateway: true, gatewayReachable: true, internetReachable: true,
      pings: { gateway: ping(0, 2, 1), internet: ping(0, 20, 2), alt: ping(0, 25, 3) },
      activeIface: { name: 'Wi-Fi', ipv4: '192.168.1.5', mac: '00:11:22:33:44:55', apipa: false }
    },
    scanDurationMs: 1000,
    dataQuality: {},
    meta: {}
  };
}

function run(mutate) {
  const d = base();
  if (mutate) mutate(d);
  return A.analyze(d);
}
function has(a, id) { return a.findings.some(f => f.id === id); }

// --- Mutations shared by more than one rule -------------------------------
const noLink = (d) => {
  d.wifi.available = false; d.wifi.connected = false; d.wifi.data = null;
  d.connectivity.hasGateway = false; d.connectivity.gateway = null;
  d.connectivity.gatewayReachable = false; d.connectivity.internetReachable = false;
  d.connectivity.pings.gateway = null;
  d.connectivity.pings.internet = ping(100, 0, 0);
  d.connectivity.pings.alt = ping(100, 0, 0);
};
const dnsDefaultFails = (d) => {
  d.dns = { server: '192.168.1.1', address: '', status: 'failed', lookupMs: 4000, tests: [{ server: '192.168.1.1', ok: false }, { server: '8.8.8.8', ok: true }] };
};
const dnsAllFail = (d) => {
  d.dns = { server: '192.168.1.1', address: '', status: 'failed', lookupMs: 4000, tests: [{ server: '192.168.1.1', ok: false }, { server: '8.8.8.8', ok: false }, { server: '1.1.1.1', ok: false }] };
};
const linkDownHops = (d) => {
  d.trace.hops = [
    { hop: 1, ip: '192.168.1.1', lossPct: 0 },
    { hop: 2, ip: '10.0.0.1', lossPct: 100 },
    { hop: 3, ip: 'Request timed out', lossPct: 100 }
  ];
};
const laterHopAlive = (d) => {
  d.trace.hops = [
    { hop: 1, ip: '10.0.0.1', lossPct: 100 },
    { hop: 2, ip: '8.8.8.8', lossPct: 0 }
  ];
};

// rule id -> { fire, nearMiss }
const TABLE = {
  'no-fault': { fire: null, nearMiss: (d) => { d.wifi.data.signalPct = 40; } },
  'location-permission-blocked': {
    fire: (d) => { d.dataQuality.locationPermissionBlocked = true; },
    nearMiss: (d) => { d.dataQuality.locationPermissionBlocked = false; }
  },
  'collector-warning': {
    fire: (d) => { d.dataQuality.warnings = ['netsh wlan failed']; },
    nearMiss: (d) => { d.dataQuality.warnings = 'not-an-array'; } // type-guarded
  },
  'cellular-outage': {
    fire: (d) => { d.mode = 'mobile'; noLink(d); d.connectivity.activeIface = { name: 'Cellular', ipv4: null, apipa: false }; d.dns = { status: 'failed' }; },
    nearMiss: (d) => { d.mode = 'mobile'; noLink(d); d.connectivity.activeIface = { name: 'Cellular', ipv4: '10.20.30.40', apipa: false }; d.dns = { status: 'failed' }; }
  },
  'no-interface': {
    fire: (d) => { d.mode = 'lan'; noLink(d); d.connectivity.activeIface = { name: 'Ethernet', ipv4: null, apipa: false }; d.dns = { status: 'failed' }; },
    nearMiss: (d) => { d.mode = 'lan'; noLink(d); d.connectivity.hasGateway = true; d.connectivity.gateway = '192.168.1.1'; d.connectivity.activeIface = { name: 'Ethernet', ipv4: null, apipa: false }; d.dns = { status: 'failed' }; }
  },
  'dhcp-unreachable': {
    fire: (d) => { d.connectivity.activeIface = { name: 'Ethernet', ipv4: '169.254.10.20', apipa: true }; },
    nearMiss: (d) => { d.connectivity.activeIface = { name: 'Ethernet', ipv4: '169.254.10.20', apipa: false }; } // keys on the flag, not the string
  },
  'wifi-connection-failed': {
    fire: (d) => { d.wifi.connected = false; d.wifi.data = null; d.connectivity.activeIface = { name: 'Wi-Fi', ipv4: null, apipa: false }; },
    nearMiss: (d) => { d.wifi.available = false; d.wifi.connected = false; d.wifi.data = null; d.connectivity.activeIface = { name: 'Wi-Fi', ipv4: null, apipa: false }; }
  },
  'critical-weak-signal': {
    fire: (d) => { d.wifi.data.signalPct = 20; },
    nearMiss: (d) => { d.wifi.data.signalPct = 25; } // boundary -> weak-signal, not critical
  },
  'weak-signal': {
    fire: (d) => { d.wifi.data.signalPct = 40; },
    nearMiss: (d) => { d.wifi.data.signalPct = 50; } // boundary -> healthy
  },
  'wifi-interference': {
    fire: (d) => { d.connectivity.pings.internet.rttRange = 200; },
    nearMiss: (d) => { d.connectivity.pings.internet.rttRange = 60; } // boundary: needs > 60
  },
  'gateway-link-down': {
    fire: (d) => { d.connectivity.pings.gateway = ping(100, 0, 0); },
    nearMiss: (d) => { d.connectivity.pings.gateway = ping(89, 0, 0); } // boundary: < 90
  },
  'gateway-unstable': {
    fire: (d) => { d.connectivity.pings.gateway = ping(50, 5, 3); },
    nearMiss: (d) => { d.connectivity.pings.gateway = ping(39, 5, 3); } // boundary: < 40
  },
  'internet-unreachable': {
    fire: (d) => { d.connectivity.internetReachable = false; d.connectivity.pings.internet = ping(100, 0, 0); d.connectivity.pings.alt = ping(100, 0, 0); },
    nearMiss: (d) => { d.connectivity.internetReachable = true; }
  },
  'network-congestion': {
    fire: (d) => { d.connectivity.pings.internet = ping(20, 200, 5); },
    nearMiss: (d) => { d.connectivity.pings.internet = ping(20, 150, 5); } // boundary: avg not > 150
  },
  'severe-degradation': {
    fire: (d) => { d.connectivity.pings.internet = ping(60, 50, 5); },
    nearMiss: (d) => { d.connectivity.pings.internet = ping(40, 50, 5); } // boundary: not > 40
  },
  'high-latency': {
    fire: (d) => { d.connectivity.pings.internet = ping(0, 250, 5); d.connectivity.pings.alt = ping(0, 260, 5); },
    nearMiss: (d) => { d.connectivity.pings.internet = ping(0, 250, 5); d.connectivity.pings.alt = ping(0, 150, 5); } // both must be > 200
  },
  'dns-default-failing': {
    fire: dnsDefaultFails,
    nearMiss: dnsAllFail // no healthy resolver -> all-failing, not default-failing
  },
  'dns-all-failing': {
    fire: dnsAllFail,
    nearMiss: dnsDefaultFails // a public resolver works -> default-failing, not all-failing
  },
  'dns-resolution-failure': {
    fire: (d) => { d.dns = { server: '192.168.1.1', address: '', status: 'failed', lookupMs: 4000 }; },
    nearMiss: dnsDefaultFails // per-server tests present -> not the legacy rule
  },
  'slow-dns': {
    fire: (d) => { d.dns.lookupMs = 600; },
    nearMiss: (d) => { d.dns.lookupMs = 500; } // boundary: needs > 500
  },
  'router-link-down': {
    fire: linkDownHops,
    nearMiss: laterHopAlive // a later hop answers -> icmp-filtered
  },
  'icmp-filtered': {
    fire: laterHopAlive,
    nearMiss: linkDownHops // no later hop answers -> link-down
  },
  'mtu-reduced': {
    fire: (d) => { d.mtu = { payload: 1252, mtu: 1280, note: null }; },
    nearMiss: (d) => { d.mtu = { payload: 1372, mtu: 1400, note: null }; } // boundary: not < 1400
  },
  'lan-cable-not-connected': {
    fire: (d) => { d.interfaces = [{ name: 'Ethernet', state: 'Disconnected' }]; },
    nearMiss: (d) => { d.interfaces = [{ name: 'Ethernet', state: 'Connected' }]; }
  },
  'channel-overlap': {
    fire: (d) => { d.wifi.data.channel = '6'; d.neighbors = [{ ssid: 'A', channel: '6', signalPct: 60 }, { ssid: 'B', channel: '6', signalPct: 50 }]; },
    nearMiss: (d) => { d.wifi.data.channel = '6'; d.neighbors = [{ ssid: 'A', channel: '6', signalPct: 60 }]; } // only one strong neighbour
  }
};

const CONTRACT_IDS = ['no-fault', 'gateway-link-down', 'gateway-unstable', 'dhcp-unreachable', 'no-interface',
  'wifi-connection-failed', 'critical-weak-signal', 'weak-signal', 'wifi-interference', 'channel-overlap',
  'network-congestion', 'severe-degradation', 'high-latency', 'internet-unreachable', 'dns-resolution-failure',
  'dns-default-failing', 'dns-all-failing', 'slow-dns', 'router-link-down', 'icmp-filtered', 'mtu-reduced',
  'cellular-outage', 'lan-cable-not-connected', 'location-permission-blocked', 'collector-warning'];

test('rule table covers every stable finding id in the contract', () => {
  assert.deepStrictEqual(Object.keys(TABLE).sort(), CONTRACT_IDS.slice().sort());
});

for (const id of Object.keys(TABLE)) {
  const c = TABLE[id];

  test('rule fires: ' + id, () => {
    const a = run(c.fire);
    assert.ok(has(a, id), id + ' should fire (findings: ' + a.findings.map(f => f.id).join(', ') + ')');
  });

  test('rule must not fire: ' + id, () => {
    const a = run(c.nearMiss);
    assert.ok(!has(a, id), id + ' must not fire (findings: ' + a.findings.map(f => f.id).join(', ') + ')');
  });
}

// --- Extra boundary / contract-rule assertions -----------------------------

test('healthy baseline -> Healthy, topFindingId no-fault, headline', () => {
  const a = run(null);
  assert.strictEqual(a.topFindingId, 'no-fault');
  assert.strictEqual(a.status, 'Healthy');
  assert.strictEqual(a.headline, 'No fault detected');
  assert.strictEqual(a.insufficientData, false);
  assert.ok(a.healthScore >= 0 && a.healthScore <= 100);
});

test('informational Low finding does not change Healthy status', () => {
  const a = run((d) => { d.interfaces = [{ name: 'Ethernet', state: 'Disconnected' }]; });
  assert.ok(has(a, 'lan-cable-not-connected'));
  assert.strictEqual(a.status, 'Healthy');
  assert.strictEqual(a.topFindingId, 'no-fault');
});

test('network-congestion must not fire with zero loss, however high the RTT', () => {
  const a = run((d) => { d.connectivity.pings.internet = ping(0, 400, 5); });
  assert.ok(!has(a, 'network-congestion'));
});

test('wifi-interference must not fire on a weak signal even with high RTT spread', () => {
  const a = run((d) => { d.wifi.data.signalPct = 40; d.connectivity.pings.internet.rttRange = 200; });
  assert.ok(!has(a, 'wifi-interference'));
  assert.ok(has(a, 'weak-signal'));
});

test('insufficient data never yields a fault', () => {
  const a = A.analyze({ mode: 'lan', connectivity: {} });
  assert.strictEqual(a.insufficientData, true);
  assert.strictEqual(a.findings.length, 0);
  assert.strictEqual(a.healthScore, null);
  assert.strictEqual(a.status, 'Insufficient Data');
});

test('every finding exposes evidenceRefs (array) and a non-empty disproveIf', () => {
  for (const id of Object.keys(TABLE)) {
    const a = run(TABLE[id].fire);
    for (const f of a.findings) {
      assert.ok(Array.isArray(f.evidenceRefs), id + ': evidenceRefs array');
      assert.ok(typeof f.disproveIf === 'string' && f.disproveIf.length > 0, id + ': disproveIf');
    }
  }
});
