#!/usr/bin/env node
'use strict';
/*
 * Controlled-fault evaluation harness (SCAFFOLD).
 *
 * This script never fabricates a result. It only:
 *   - prints the blank results table (`template`),
 *   - prints the fault -> expected-finding-id mapping (`expected`), and
 *   - evaluates a REAL scan file that YOU provide (`analyze`).
 *
 * Record the actual runs by hand in docs/EVALUATION.md. Nothing here fills in
 * an observed value, a match or a note.
 *
 * Usage:
 *   node scripts/eval-faults.js template
 *   node scripts/eval-faults.js expected
 *   node scripts/eval-faults.js analyze --scan <file.json> [--expect <id>] [--mode wifi|lan|mobile]
 *
 * `--scan` accepts either a stored history entry ({ id, data }) or a raw scan
 * object. `--expect` prints an observed match (Y/N) for that single file only.
 */
const fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, '..', 'js', 'analyzer.js'));

// Fault -> the stable finding id the engine is expected to surface. This is an
// a-priori mapping taken from docs/API_CONTRACT.md section 3.4, NOT an observed
// result. It is safe to ship because it predicts rather than reports.
const FAULTS = [
  { fault: 'Unplug the LAN cable', expected: 'gateway-link-down' },
  { fault: 'Damaged / duplex-mismatched cable', expected: 'gateway-unstable' },
  { fault: 'DHCP server off (APIPA 169.254.x.x)', expected: 'dhcp-unreachable' },
  { fault: 'Disable the WiFi adapter', expected: 'no-interface' },
  { fault: 'Wrong WiFi password / not associating', expected: 'wifi-connection-failed' },
  { fault: 'Move far from the AP (<25%)', expected: 'critical-weak-signal' },
  { fault: 'Move to mid range (25-50%)', expected: 'weak-signal' },
  { fault: 'Co-channel interference', expected: 'wifi-interference' },
  { fault: 'Crowded channel (2+ strong neighbours)', expected: 'channel-overlap' },
  { fault: 'Saturate the uplink (loss + latency)', expected: 'network-congestion' },
  { fault: 'Severe loss on the WAN path', expected: 'severe-degradation' },
  { fault: 'High-latency path (both pings >=200 ms)', expected: 'high-latency' },
  { fault: 'Unplug the WAN / ISP down', expected: 'internet-unreachable' },
  { fault: 'Point DNS at an unreachable server (192.0.2.1)', expected: 'dns-default-failing' },
  { fault: 'Block UDP/TCP port 53', expected: 'dns-all-failing' },
  { fault: 'Break name resolution (no per-server data)', expected: 'dns-resolution-failure' },
  { fault: 'Slow resolver (>500 ms)', expected: 'slow-dns' },
  { fault: 'Drop a router hop (no later hop answers)', expected: 'router-link-down' },
  { fault: 'Filter ICMP on a middle hop (later hops answer)', expected: 'icmp-filtered' },
  { fault: 'Reduce the path MTU below 1400', expected: 'mtu-reduced' },
  { fault: 'No cellular service (airplane mode)', expected: 'cellular-outage' },
  { fault: 'Disconnect the wired NIC while on WiFi', expected: 'lan-cable-not-connected' },
  { fault: 'Turn off the Location permission', expected: 'location-permission-blocked' },
  { fault: 'Healthy baseline (control)', expected: 'no-fault' }
];

function blankTable() {
  const lines = [];
  lines.push('| Fault injected | Run # | Top finding id | Expected id | Match (Y/N) | Notes |');
  lines.push('|---|---|---|---|---|---|');
  for (const f of FAULTS) {
    // Only the prediction column is filled. Every result cell is left empty.
    lines.push('| ' + f.fault + ' |  |  | ' + f.expected + ' |  |  |');
  }
  return lines.join('\n');
}

function analyzeScan(file, mode) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = raw && raw.data ? raw.data : raw;
  if (mode) data.mode = mode;
  return A.analyze(data);
}

function arg(rest, name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'template') { console.log(blankTable()); return 0; }
  if (cmd === 'expected') {
    for (const f of FAULTS) console.log(f.expected + '\t' + f.fault);
    return 0;
  }
  if (cmd === 'analyze') {
    const scan = arg(rest, '--scan');
    if (!scan) { console.error('analyze requires --scan <file.json>'); return 2; }
    const a = analyzeScan(scan, arg(rest, '--mode'));
    console.log('topFindingId    : ' + a.topFindingId);
    console.log('status          : ' + a.status);
    console.log('headline        : ' + a.headline);
    console.log('insufficientData: ' + a.insufficientData);
    const expect = arg(rest, '--expect');
    if (expect) {
      console.log('expected        : ' + expect);
      console.log('match           : ' + (a.topFindingId === expect ? 'Y' : 'N'));
    }
    return 0;
  }
  console.log('Usage:\n' +
    '  node scripts/eval-faults.js template\n' +
    '  node scripts/eval-faults.js expected\n' +
    '  node scripts/eval-faults.js analyze --scan <file.json> [--expect <id>] [--mode wifi|lan|mobile]');
  return 1;
}

process.exit(main());
