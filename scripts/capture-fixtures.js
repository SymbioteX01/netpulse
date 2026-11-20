#!/usr/bin/env node
/*
 * capture-fixtures.js - run the real diagnostics collectors and store SANITIZED
 * outputs under fixtures/scans/. Windows only.
 *
 * Sanitizing: SSID, BSSID, MAC and every IPv4 address are replaced with invented
 * values (documentation ranges 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 and
 * link-local 169.254.0.0/16; MACs become 02:00:00:00:00:NN). The same original
 * value always maps to the same invented value so correlations survive.
 *
 * The script REFUSES to write a file if a MAC or a non-documentation IPv4 is
 * still present after sanitizing.
 *
 * Usage: node scripts/capture-fixtures.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'scans');

const MAC_RE = /\b([0-9a-fA-F]{2}[-:]){5}[0-9a-fA-F]{2}\b/g;
const IPV4_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

function isMaskOrSpecial(ip) {
  if (/^255\./.test(ip)) return true;
  if (ip === '0.0.0.0') return true;
  if (/^127\./.test(ip)) return true;
  return false;
}
function isDocumentation(ip) {
  return /^192\.0\.2\./.test(ip) || /^198\.51\.100\./.test(ip) || /^203\.0\.113\./.test(ip) || /^169\.254\./.test(ip);
}

function makeSanitizer() {
  const ipMap = new Map();
  const macMap = new Map();
  const ssidMap = new Map();
  let ipCounter = 10;
  let macCounter = 1;

  function inventedIp(orig) {
    if (ipMap.has(orig)) return ipMap.get(orig);
    const v = ipCounter < 245 ? ipCounter++ : 10;
    const ip = (ipMap.size % 2 === 0) ? '198.51.100.' + v : '203.0.113.' + v;
    ipMap.set(orig, ip);
    return ip;
  }
  function inventedMac() {
    const n = String(macCounter++).padStart(2, '0');
    return '02:00:00:00:00:' + n;
  }
  function inventedSsid(orig) {
    if (!ssidMap.has(orig)) {
      ssidMap.set(orig, ssidMap.size === 0 ? 'ExampleNet' : 'Neighbor-' + ssidMap.size);
    }
    return ssidMap.get(orig);
  }

  function sanitize(text) {
    let out = String(text == null ? '' : text);
    // SSID / Profile values
    out = out.replace(/^(\s*SSID\s*\d*\s*:\s*)(.+)$/gmi, (m, a, b) => a + inventedSsid(b.trim()));
    out = out.replace(/^(\s*Profile\s*:\s*)(.+)$/gmi, (m, a, b) => a + inventedSsid(b.trim()));
    // MAC / BSSID
    out = out.replace(MAC_RE, (mac) => {
      const key = mac.toUpperCase();
      if (!macMap.has(key)) macMap.set(key, inventedMac());
      return macMap.get(key);
    });
    // IPv4
    out = out.replace(IPV4_RE, (ip) => (isMaskOrSpecial(ip) ? ip : inventedIp(ip)));
    return out;
  }

  function assertSanitized(text) {
    let m;
    MAC_RE.lastIndex = 0;
    while ((m = MAC_RE.exec(text)) !== null) {
      if (!/^02:00:00:00:00:/i.test(m[0])) throw new Error('Unmasked MAC still present: ' + m[0]);
    }
    IPV4_RE.lastIndex = 0;
    while ((m = IPV4_RE.exec(text)) !== null) {
      if (!isMaskOrSpecial(m[0]) && !isDocumentation(m[0])) throw new Error('Unmasked IPv4 still present: ' + m[0]);
    }
    return true;
  }

  return { sanitize, assertSanitized };
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: timeoutMs || 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '') + (stderr || '') });
    });
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('capture-fixtures.js is Windows only (process.platform = ' + process.platform + ').');
    process.exit(1);
  }
  const jobs = [
    ['netsh-wlan-interfaces', 'netsh', ['wlan', 'show', 'interfaces'], 8000],
    ['netsh-wlan-networks', 'netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 8000],
    ['netsh-interface-show', 'netsh', ['interface', 'show', 'interface'], 8000],
    ['ipconfig-all', 'ipconfig', ['/all'], 8000],
    ['arp-a', 'arp', ['-a'], 8000],
    ['route-print', 'route', ['print', '0.0.0.0'], 8000],
    ['ping-8888', 'ping', ['-n', '3', '-w', '2000', '8.8.8.8'], 20000],
    ['nslookup-google', 'nslookup', ['google.com'], 8000],
    ['tracert-8888', 'tracert', ['-d', '-h', '5', '-w', '1000', '8.8.8.8'], 30000]
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const s = makeSanitizer();
  for (const [name, cmd, args, timeout] of jobs) {
    const r = await run(cmd, args, timeout);
    const masked = s.sanitize(r.out);
    s.assertSanitized(masked);
    const file = path.join(OUT_DIR, name + '.txt');
    fs.writeFileSync(file, masked, 'utf8');
    console.log('wrote ' + path.basename(file) + ' (ok=' + r.ok + ')');
  }
  console.log('Done. Review fixtures/scans/ before sharing.');
}

if (require.main === module) {
  main().catch((e) => { console.error('capture-fixtures failed: ' + e.message); process.exit(1); });
}

module.exports = { makeSanitizer, isDocumentation, isMaskOrSpecial };
