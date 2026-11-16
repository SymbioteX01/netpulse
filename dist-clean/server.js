const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, exec } = require('child_process');
const { performance } = require('perf_hooks');

const ROOT = __dirname;
const SURVEYS_DIR = process.env.NETPULSE_SURVEYS_DIR ? path.resolve(process.env.NETPULSE_SURVEYS_DIR) : path.join(ROOT, 'Surveys');
const REPORTS_DIR = process.env.NETPULSE_REPORTS_DIR ? path.resolve(process.env.NETPULSE_REPORTS_DIR) : path.join(ROOT, 'reports');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const CONFIG_DEFAULTS = { port: 3000, bindHost: '127.0.0.1', authToken: null, pingCount: 5, pingTimeoutMs: 2000, traceMaxHops: 15, historyLimit: 25, dnsServers: ['8.8.8.8', '1.1.1.1'] };
function loadConfig() {
  try { return Object.assign({}, CONFIG_DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch (e) { return Object.assign({}, CONFIG_DEFAULTS); }
}
const CFG = loadConfig();
const ENV_PORT = parseInt(process.env.NETPULSE_PORT, 10);
const PORT = Number.isFinite(ENV_PORT) ? ENV_PORT : CFG.port;
const BIND = process.env.NETPULSE_BIND || CFG.bindHost;
if (process.env.NETPULSE_AUTH_TOKEN) CFG.authToken = process.env.NETPULSE_AUTH_TOKEN;

// Data directory / files. NETPULSE_DATA_DIR lets tests use a temp dir.
const DATA_DIR = process.env.NETPULSE_DATA_DIR ? path.resolve(process.env.NETPULSE_DATA_DIR) : path.join(ROOT, 'data');
const SURVEYS_FILE = path.join(DATA_DIR, 'surveys.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_LIMIT = Math.max(1, CFG.historyLimit || 9999);

// Root-cause engine is now UMD so the backend can use the same code as the browser.
let Analyzer = null;
try { Analyzer = require('./js/analyzer.js'); } catch (e) { Analyzer = null; }
function analyzeData(data) {
  if (!Analyzer || typeof Analyzer.analyze !== 'function') return null;
  try { return Analyzer.analyze(data); } catch (e) { return null; }
}

// Command runner: injectable for tests (fixtures) without a Windows host.
function defaultRunner(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: timeoutMs || 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || '') + '\n' + (stderr || '');
      resolve({ ok: !err, out, code: err ? err.code : 0 });
    });
  });
}
let RUNNER = defaultRunner;
function runCmd(cmd, args, timeoutMs) { return RUNNER(cmd, args, timeoutMs); }
function setRunner(fn) { RUNNER = typeof fn === 'function' ? fn : defaultRunner; }
// Test-only seam: pretend we are on another platform (exercises the 501 guard).
function getPlatform() { return process.env.NETPULSE_FORCE_PLATFORM || process.platform; }
const LOCATION_PERMISSION_RE = /location permission/i;

function isLoopbackHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}
function bindIsLoopback() {
  const h = String(BIND || '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function parseWlanInterfaces(out) {
  const result = { available: false, connected: false, data: null };
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().replace(/\s+/g, ' ').toLowerCase().replace(/\s/g, '_');
    const val = line.slice(idx + 1).trim();
    if (!current) {
      current = {};
    }
    current[key] = val;
  }
  if (current && current.ssid) {
    result.available = true;
    result.data = current;
    result.connected = /connected/i.test(current.state || '');
    const sigM = current.signal ? current.signal.match(/(\d+)/) : null;
    const sigVal = sigM ? parseInt(sigM[1], 10) : NaN;
    current.signalPct = isFinite(sigVal) ? sigVal : null;
    Object.keys(current).forEach(k => {
      if (/receive_rate/.test(k)) { const m = String(current[k]).match(/(\d+)/); if (m) result.data.rxRate = m[1]; }
      if (/transmit_rate/.test(k)) { const m = String(current[k]).match(/(\d+)/); if (m) result.data.txRate = m[1]; }
    });
    current.radioType = current.radio_type || null;
    current.auth = current.authentication || null;
  }
  return result;
}

function parseNeighbors(out) {
  const neighbors = [];
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    const ssidMatch = line.match(/^SSID\s*\d+\s*:\s*(.*)$/);
    if (ssidMatch) {
      current = { ssid: ssidMatch[1].trim(), bssid: '', signalPct: 0, channel: '', radioType: '', auth: '' };
      neighbors.push(current);
      continue;
    }
    if (!current) continue;
    const bssid = line.match(/^BSSID\s*\d*\s*:\s*(.*)$/);
    if (bssid) { current.bssid = bssid[1].trim(); continue; }
    const sig = line.match(/^Signal\s*:\s*(\d+)%/);
    if (sig) { current.signalPct = parseInt(sig[1], 10); continue; }
    const ch = line.match(/^Channel\s*:\s*(\d+)/);
    if (ch) { current.channel = ch[1]; continue; }
    const rt = line.match(/^Radio type\s*:\s*(.*)$/);
    if (rt) { current.radioType = rt[1].trim(); continue; }
    const at = line.match(/^Authentication\s*:\s*(.*)$/);
    if (at) { current.auth = at[1].trim(); }
  }
  return neighbors;
}

function parseInterfaces(out) {
  const interfaces = [];
  const lines = out.split(/\r?\n/);
  for (const raw of lines) {
    if (/Admin State/i.test(raw)) continue;
    const m = raw.trim().match(/^(\S+)\s{2,}(\S+)\s{2,}(\S+)\s{2,}(.+)$/);
    if (m) interfaces.push({ name: m[4].trim(), adminState: m[1], state: m[2], type: m[3] });
  }
  return interfaces;
}

function parseIpconfig(out) {
  const adapters = [];
  const lines = out.split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const section = line.match(/^(.+?) adapter (.+?):$/);
    if (section) {
      current = { adapterType: section[1].trim(), name: section[2].trim(), mediaState: null, description: '', mac: '', dhcp: null, ipv4: null, subnet: null, gateway: null, dhcpServer: null, apipa: false };
      adapters.push(current);
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([^:]+?)\s*\.\s*:\s*(.*)$/) || line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim();
    if (/media state/i.test(key)) current.mediaState = val;
    else if (/description/i.test(key)) current.description = val;
    else if (/physical address/i.test(key)) current.mac = val;
    else if (/dhcp enabled/i.test(key)) current.dhcp = /yes/i.test(val);
    else if (/ipv4/i.test(key)) { current.ipv4 = val.replace(/\(Preferred\)/i, '').trim(); current.apipa = /^169\.254\./.test(current.ipv4); }
    else if (/subnet mask/i.test(key)) current.subnet = val;
    else if (/default gateway/i.test(key)) { if (val && !/^\s*$/.test(val)) current.gateway = val.split(/\s+/)[0]; }
    else if (/dhcp server/i.test(key)) current.dhcpServer = val;
  }
  return adapters;
}

function parsePing(out) {
  const times = [];
  const tm = out.matchAll(/time[=<](\d+)ms/gi);
  for (const m of tm) times.push(parseInt(m[1], 10));
  const unreachable = (out.match(/Destination host unreachable/gi) || []).length;
  const timeouts = (out.match(/Request timed out/gi) || []).length;
  const sentM = out.match(/Sent = (\d+)/i);
  const recvM = out.match(/Received = (\d+)/i);
  const lostM = out.match(/Lost = (\d+)/i);
  const minM = out.match(/Minimum = (\d+)ms/i);
  const maxM = out.match(/Maximum = (\d+)ms/i);
  const avgM = out.match(/Average = (\d+)ms/i);
  const sent = sentM ? parseInt(sentM[1], 10) : times.length + timeouts + unreachable;
  const received = recvM ? parseInt(recvM[1], 10) : times.length;
  const lost = lostM ? parseInt(lostM[1], 10) : (sent - received);
  // rttRange keeps the OLD jitter meaning (max - min).
  const rttRange = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0;
  // jitter is now the RFC 3550-style mean absolute difference of consecutive RTTs.
  let jitter = 0;
  if (times.length >= 2) {
    let sum = 0;
    for (let i = 1; i < times.length; i++) sum += Math.abs(times[i] - times[i - 1]);
    jitter = sum / (times.length - 1);
  }
  return {
    sent, received, lost,
    lossPct: sent > 0 ? Math.round((lost / sent) * 100) : 100,
    unreachable, timeouts,
    min: minM ? parseInt(minM[1], 10) : (times.length ? Math.min(...times) : null),
    max: maxM ? parseInt(maxM[1], 10) : (times.length ? Math.max(...times) : null),
    avg: avgM ? parseInt(avgM[1], 10) : (times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null),
    jitter: Math.round(jitter * 10) / 10,
    rttRange,
    times
  };
}

function parseNslookup(out) {
  let server = null, address = null;
  for (const raw of out.split(/\r?\n/)) {
    const s = raw.match(/^\s*Server:\s*(.+)$/);
    if (s) { server = s[1].trim(); continue; }
    const a = raw.match(/^\s*Address:\s*([0-9a-fA-F.:]+)/);
    if (a && server && !address) address = a[1].trim();
  }
  const failedRegex = /(^\s*\*\*\*|timed out|no response from server|non.?existent domain|can't find|server failure|query refused|refused)/im;
  const status = failedRegex.test(out) ? 'failed' : 'ok';
  return { server, address, status };
}

function parseTracert(out) {
  const hops = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const hop = parseInt(m[1], 10);
    const rest = m[2];
    const times = [];
    const tm = rest.matchAll(/(\d+)\s*ms|\*/g);
    for (const t of tm) times.push(t[0] === '*' ? null : parseInt(t[0], 10));
    const ipM = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const samples = times.filter(t => t !== null).length;
    hops.push({
      hop,
      times,
      lossPct: times.length > 0 ? Math.round(((times.length - samples) / times.length) * 100) : 100,
      ip: ipM ? ipM[1] : 'Request timed out'
    });
  }
  return { hops };
}

function parseArp(out) {
  const entries = [];
  for (const raw of out.split(/\r?\n/)) {
    const m = raw.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F\-]{17})\s+(\w+)$/);
    if (m) entries.push({ ip: m[1], mac: m[2], type: m[3] });
  }
  return entries;
}

function inferBand(iface) {
  if (iface.band) return String(iface.band).trim();
  const ch = parseInt(iface.channel, 10);
  if (!ch) return null;
  if (ch >= 1 && ch <= 14) return '2.4 GHz';
  if (ch >= 32 && ch <= 177) return '5 GHz';
  return '6 GHz';
}

function getLanSpeed() {
  return runCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object Name,InterfaceDescription,LinkSpeed,MacAddress | ConvertTo-Json -Compress'], 12000)
    .then(r => {
      try {
        const parsed = JSON.parse(r.out);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list.map(x => ({ name: x.Name, description: x.InterfaceDescription || '', linkSpeed: x.LinkSpeed || null, mac: x.MacAddress || null }));
      } catch (e) { return []; }
    });
}

const OUI_VENDORS = {
  '00:1A:2B': 'TP-Link', 'D8:07:B6': 'TP-Link', '50:C7:BF': 'TP-Link', '14:CC:20': 'TP-Link', 'BC:76:5E': 'TP-Link', 'F8:1A:67': 'TP-Link', '68:7F:74': 'TP-Link', 'CC:32:E5': 'TP-Link', 'A0:F3:C1': 'TP-Link', 'C8:3A:35': 'TP-Link', 'F0:9F:C2': 'TP-Link', 'C0:06:C3': 'TP-Link', 'B0:95:75': 'TP-Link', 'A8:2B:B5': 'TP-Link', '9C:D2:1E': 'TP-Link',
  '50:64:2B': 'D-Link', '00:24:01': 'D-Link', '00:1B:11': 'D-Link', '58:6A:B1': 'D-Link', '28:10:7B': 'D-Link', 'F0:7D:68': 'D-Link', '1C:5A:6B': 'D-Link', 'C8:BE:19': 'D-Link', '28:12:2B': 'D-Link', 'B0:C5:54': 'D-Link', '98:FE:94': 'D-Link',
  '00:1B:63': 'Cisco', '00:1A:A1': 'Cisco', 'F8:5E:3C': 'Cisco', '00:0C:41': 'Cisco', 'A4:4C:11': 'Cisco', '3C:CE:73': 'Cisco', '44:D3:CA': 'Cisco', '00:1F:CA': 'Cisco', '58:38:79': 'Cisco',
  '00:13:02': 'Intel', '3C:97:0E': 'Intel', 'A4:1F:72': 'Intel', 'F4:8E:38': 'Intel', '54:B2:03': 'Intel', '68:05:CA': 'Intel', '00:1F:29': 'Intel', '8C:16:45': 'Intel', 'B4:8B:19': 'Intel', '48:2C:A0': 'Intel', 'A8:66:7F': 'Intel',
  'EC:8E:B5': 'Asus', '10:BF:48': 'Asus', '78:02:F8': 'Asus', '04:D9:F5': 'Asus', '58:11:22': 'Asus', '2C:56:DC': 'Asus', '60:45:CB': 'Asus', 'C8:7B:23': 'Asus', '44:6D:57': 'Asus',
  'D8:32:E3': 'Netgear', '20:4E:7F': 'Netgear', '84:1B:5E': 'Netgear', 'A0:63:91': 'Netgear', 'C0:3F:0E': 'Netgear', '74:C2:46': 'Netgear', '98:DA:C4': 'Netgear', 'F4:F2:6D': 'Netgear', 'B4:39:09': 'Netgear', '54:F4:55': 'Netgear',
  'F4:5C:89': 'Realtek', '52:54:00': 'VirtualBox', '00:50:56': 'VMware', '00:0C:29': 'VMware', '3C:A6:F6': 'Xiaomi', 'F8:A5:2D': 'Xiaomi', '54:9F:13': 'Xiaomi', '64:4B:F0': 'Xiaomi', '08:11:96': 'Huawei', 'C4:0B:CB': 'Huawei', 'F4:96:34': 'Huawei', 'E0:2E:0A': 'Samsung', 'A0:CE:C8': 'Samsung', '44:8A:5B': 'Samsung', 'C0:EE:FB': 'Samsung', 'B0:5A:DA': 'Samsung', '00:0E:8F': 'Motorola', '5C:49:79': 'Jio', 'A0:40:A0': 'Apple', 'A8:5C:2C': 'Apple', '7C:C3:A1': 'Apple', '3C:22:FB': 'Apple', 'F8:FF:C2': 'Apple', 'AC:BC:32': 'Apple', 'BC:92:6B': 'Apple', '00:26:BB': 'Apple', 'C4:2C:03': 'Apple'
};
function vendorFor(mac) {
  if (!mac) return null;
  const clean = String(mac).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (clean.length < 6) return 'Unknown';
  for (const prefix of Object.keys(OUI_VENDORS)) {
    if (clean.startsWith(prefix.replace(/[^0-9A-F]/g, ''))) return OUI_VENDORS[prefix];
  }
  return 'Unknown';
}

async function detectMtu(gateway) {
  if (!gateway) return { payload: null, mtu: null, note: 'no gateway' };
  const probes = [1472, 1400, 1300, 1200, 1000, 800, 500];
  let payload = null;
  for (const size of probes) {
    const r = await runCmd('ping', ['-f', '-l', String(size), '-n', '1', '-w', '1500', gateway], 8000);
    const out = r.out || '';
    if (/Reply from/i.test(out) && !/fragment/i.test(out)) { payload = size; break; }
  }
  return { payload, mtu: payload !== null ? payload + 28 : null, note: payload === null ? 'packets fragmented - MTU lower than 500 (or gateway unreachable)' : null };
}

async function ipv6Test() {
  const loop = await runCmd('ping', ['-n', '2', '-w', '1500', '::1'], 6000);
  const loopOk = /Reply from ::1/i.test(loop.out || '');
  const inet = await runCmd('ping', ['-n', '3', '-w', '2000', '2606:4700:4700::1111'], 12000);
  const inetOk = /Reply from/i.test(inet.out || '') && /2606:4700/i.test(inet.out || '');
  return { enabled: loopOk, loopbackOk: loopOk, internetOk: inetOk };
}

async function dnsLatencyTests(servers) {
  const unique = [...new Set((servers || []).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const s of unique) {
    const t0 = performance.now();
    const r = await runCmd('nslookup', ['google.com', s], 6000);
    const out = r.out || '';
    results.push({
      server: s,
      ms: Math.round(performance.now() - t0),
      ok: !/timed out|Non-existent|can't find|no response/i.test(out) && /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(out)
    });
  }
  return results;
}

function isIpv4(ip) {
  return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

function pickActiveIface(ipconfig, routeGateway) {
  const VIRTUAL = /virtual|vmware|virtualbox|hyper-v|vethernet|isatap|loopback|bluetooth|tap-|tunnel|6to4|teredo|ppp/i;
  const candidates = ipconfig.filter(a => a.ipv4 && !a.apipa && !VIRTUAL.test(a.name));
  const active = candidates.find(a => a.gateway) || candidates[0] || ipconfig.find(a => a.ipv4 && !a.apipa) || ipconfig.find(a => a.ipv4);
  const gateway = (active && active.gateway && isIpv4(active.gateway)) ? active.gateway : (isIpv4(routeGateway) ? routeGateway : null);
  return { active, gateway };
}

// NOTE: the legacy `runNetworkScan` (/api/network) duplicated `runFullScan`
// (/api/scan) with slightly different data. It has been removed; every scan
// endpoint now uses the single collector `runFullScan`.

function readSurveys() {
  try {
    const arr = JSON.parse(fs.readFileSync(SURVEYS_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function backupFile(file) {
  try {
    const base = path.basename(file).replace(/\.json$/, '');
    const dir = path.join(path.dirname(file), 'backup');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    fs.copyFileSync(file, path.join(dir, base + '_' + stamp + '.json'));
    const keep = fs.readdirSync(dir).filter(f => f.startsWith(base + '_')).sort();
    while (keep.length > 10) fs.unlinkSync(path.join(dir, keep.shift()));
  } catch (e) { /* backup is best-effort */ }
}

function writeSurveys(list) {
  backupFile(SURVEYS_FILE);
  const dir = path.dirname(SURVEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SURVEYS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function readHistory() {
  try { const arr = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
}
function writeHistory(list) {
  backupFile(HISTORY_FILE);
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
}
function historySummary(d, id) {
  const w = d.wifi && d.wifi.data;
  const pg = d.connectivity && d.connectivity.pings;
  const a = d.analysis || null;
  return {
    id: id != null ? id : (d.id || null), timestamp: d.timestamp || null,
    mode: d.mode || 'wifi',
    ssid: w ? w.ssid : null, signalPct: w ? w.signalPct : null,
    gateway: (d.connectivity && d.connectivity.gateway) || null,
    internetReachable: !!(d.connectivity && d.connectivity.internetReachable),
    gatewayReachable: !!(d.connectivity && d.connectivity.gatewayReachable),
    gwAvg: pg && pg.gateway ? pg.gateway.avg : null,
    inetAvg: pg && pg.internet ? pg.internet.avg : null,
    inetLoss: pg && pg.internet ? pg.internet.lossPct : null,
    scanDurationMs: d.scanDurationMs || null,
    status: a ? a.status : null,
    healthScore: a && typeof a.healthScore === 'number' ? a.healthScore : null,
    headline: a ? a.headline : null
  };
}

function newSurveyId() {
  return 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      body += c;
      // Stop accumulating past the cap but do NOT destroy the socket, so the
      // client still receives a clean 4xx instead of ECONNRESET.
      if (body.length > 25 * 1024 * 1024) { tooBig = true; body = ''; }
    });
    req.on('end', () => {
      if (tooBig) { reject(new Error('Body too large')); return; }
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const SURVEY_HEADERS = ['ID', 'Location', 'SSID', 'BSSID', 'Band', 'Channel', 'RSSI (dBm)', 'Signal (%)', 'Quality', 'TX (Mbps)', 'RX (Mbps)', 'Standard', 'Security', 'Download (Mbps)', 'Upload (Mbps)', 'Ping (ms)', 'Jitter (ms)', 'Packet Loss (%)', 'Latitude', 'Longitude', 'Network Type', 'LAN Link Speed', 'Distance (m)', 'Timestamp', 'Notes'];

function surveyRow(s) {
  return [s.id, s.locationName, s.ssid, s.bssid, s.band, s.channel, s.rssiDbm, s.signalPct, s.quality, s.linkTx, s.linkRx, s.standard, s.security, s.download, s.upload, s.ping, s.jitter, s.packetLoss, s.lat, s.lng, s.networkType, s.lanLinkSpeed, s.distanceM, s.timestamp, s.notes];
}

function toCsv(surveys) {
  const esc = v => {
    const t = v == null ? '' : String(v);
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = [SURVEY_HEADERS.map(esc).join(',')];
  surveys.forEach(s => lines.push(surveyRow(s).map(esc).join(',')));
  return '\ufeff' + lines.join('\r\n');
}

function crc32(buf) {
  if (!crc32.table) {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    crc32.table = t;
  }
  const t = crc32.table;
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

function xmlEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toXlsx(surveys) {
  const rows = [SURVEY_HEADERS].concat(surveys.map(surveyRow));
  const widths = [];
  rows.forEach(r => r.forEach((v, i) => {
    const len = String(v == null ? '' : v).length;
    widths[i] = Math.max(widths[i] || 0, Math.min(len, 40));
  }));
  const colsXml = '<cols>' + widths.map((w, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(8, w + 2) + '" customWidth="1"/>').join('') + '</cols>';
  const rowsXml = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = colLetter(ci) + (ri + 1);
      const style = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
      return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    }).join('');
    return '<row r="' + (ri + 1) + '">' + cells + '</row>';
  }).join('');
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    colsXml + '<sheetData>' + rowsXml + '</sheetData></worksheet>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Survey" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') }
  ]);
}

function toKml(surveys) {
  const places = surveys.filter(s => s.lat != null && s.lng != null).map(s =>
    '  <Placemark>\n' +
    '    <name>' + xmlEsc(s.locationName || s.id) + '</name>\n' +
    '    <description>' + xmlEsc('SSID ' + (s.ssid || '') + ' | Signal ' + (s.signalPct != null ? s.signalPct + '%' : '') + ' | Down ' + (s.download != null ? s.download : '') + ' Mbps | Ping ' + (s.ping != null ? s.ping : '') + ' ms') + '</description>\n' +
    '    <Point><coordinates>' + s.lng + ',' + s.lat + ',0</coordinates></Point>\n' +
    '  </Placemark>'
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>NetPulse Wi-Fi Survey</name>\n' + places + '\n</Document>\n</kml>\n';
}

function pdfEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');
}

function clipCell(s, maxChars) {
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (t.length > maxChars) t = t.slice(0, Math.max(2, maxChars - 1)) + '~';
  return t;
}

function buildPdf(doc) {
  const W = 595, H = 842, M = 46;
  const streams = [];
  let ops = [];
  let y = H - M;
  const flush = () => { streams.push(Buffer.from(ops.join('\n'), 'latin1')); ops = []; };
  const ensure = (needed) => { if (y - needed < 52) { flush(); y = H - M; } };
  const text = (x, str, size, bold) => {
    ops.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + Math.round(x) + ' ' + Math.round(y) + ' Td (' + pdfEscape(str) + ') Tj ET');
  };
  const rule = () => ops.push('0.82 0.84 0.88 rg ' + M + ' ' + Math.round(y) + ' ' + (W - 2 * M) + ' 0.7 re f');
  const spacer = (pt) => { y -= pt; };
  const title = (str) => { ensure(30); text(M, str, 17, true); spacer(18); };
  const meta = (str) => { ensure(14); text(M, str, 9, false); spacer(11); };
  const heading = (str) => { ensure(18); text(M, str, 12, true); spacer(14); };
  const pair = (label, value) => { ensure(12); text(M, label, 9, true); text(M + 150, value, 9, false); spacer(11); };
  const table = (headers, rows, widths) => {
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    const scale = (W - 2 * M) / total;
    const xs = [];
    let acc = M;
    widths.forEach(w => { xs.push(acc); acc += w * scale; });
    ensure(16);
    headers.forEach((h, i) => text(xs[i], clipCell(h, Math.floor(widths[i] * scale / 5.1)), 9, true));
    spacer(12);
    rule();
    rows.forEach(r => {
      ensure(12);
      r.forEach((v, i) => text(xs[i], clipCell(v, Math.floor(widths[i] * scale / 5.1)), 9, false));
      spacer(10.5);
    });
    spacer(5);
  };
  title(doc.title);
  doc.meta.forEach(m => meta(m));
  spacer(5);
  (doc.tables || []).forEach(t => { heading(t.heading); table(t.headers, t.rows, t.widths); });
  (doc.blocks || []).forEach(b => {
    heading(b.heading);
    b.rows.forEach(r => pair(r[0], r[1]));
    spacer(6);
  });
  flush();
  const n = streams.length;
  const pageNums = [];
  for (let i = 0; i < n; i++) pageNums.push(3 + i);
  const f1 = 3 + n;
  const f2 = 4 + n;
  const streamNums = [];
  for (let i = 0; i < n; i++) streamNums.push(5 + n + i);
  const objs = [];
  objs[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
  objs[2] = Buffer.from('<< /Type /Pages /Kids [' + pageNums.map(p => p + ' 0 R').join(' ') + '] /Count ' + n + ' >>', 'latin1');
  pageNums.forEach((p, i) => {
    objs[p] = Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + streamNums[i] + ' 0 R >>', 'latin1');
  });
  objs[f1] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1');
  objs[f2] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', 'latin1');
  streams.forEach((s, i) => {
    objs[streamNums[i]] = Buffer.concat([
      Buffer.from('<< /Length ' + s.length + ' >>\nstream\n', 'latin1'),
      s,
      Buffer.from('\nendstream', 'latin1')
    ]);
  });
  let offset = 0;
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = offset;
    const body = Buffer.concat([Buffer.from(i + ' 0 obj\n', 'latin1'), objs[i], Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(body);
    offset += body.length;
  }
  const xrefPos = offset;
  const total = objs.length;
  const xref = Buffer.from('xref\n0 ' + total + '\n0000000000 65535 f \n' +
    offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF', 'latin1');
  return Buffer.concat(parts.concat([xref]));
}

function pdfDoc(surveys) {
  return {
    title: 'NetPulse - Wi-Fi Survey Report',
    meta: [
      'Generated: ' + new Date().toLocaleString(),
      'Survey points: ' + surveys.length,
      'NetPulse | Wi-Fi Site Survey & Network Analysis'
    ],
    tables: [{
      heading: 'Survey Summary',
      headers: ['Location', 'Coordinates', 'Network', 'Signal', 'RSSI', 'Quality', 'Band/Ch', 'Download', 'Upload', 'Ping', 'Time'],
      widths: [18, 16, 9, 8, 8, 9, 10, 10, 10, 8, 14],
      rows: surveys.map(s => [
        s.locationName || '-',
        (s.lat != null && s.lng != null) ? s.lat + ', ' + s.lng : '-',
        s.networkType || '-',
        (s.signalPct != null ? s.signalPct + '%' : '-'),
        (s.rssiDbm != null ? s.rssiDbm + '' : '-'),
        s.quality || '-',
        (s.band || '-') + '/' + (s.channel || '-'),
        (s.download != null ? s.download + ' Mbps' : '-'),
        (s.upload != null ? s.upload + ' Mbps' : '-'),
        (s.ping != null ? s.ping + ' ms' : '-'),
        (s.timestamp || '').replace('T', ' ').slice(0, 16)
      ])
    }],
    blocks: surveys.map(s => ({
      heading: (s.locationName || 'Survey point') + '  |  ' + (s.timestamp || '').replace('T', ' ').slice(0, 16),
      rows: [
        ['SSID', s.ssid || '-'],
        ['BSSID', s.bssid || '-'],
        ['Network Type', s.networkType || '-'],
        ['GPS', (s.lat != null && s.lng != null) ? s.lat + ', ' + s.lng : 'not available'],
        ['Band / Channel', (s.band || '-') + ' / ' + (s.channel || '-')],
        ['Signal', (s.signalPct != null ? s.signalPct + '%' : '-') + '  (' + (s.rssiDbm != null ? s.rssiDbm + ' dBm' : '-') + ')  ' + (s.quality || '')],
        ['Link Speed', 'TX ' + (s.linkTx != null ? s.linkTx + ' Mbps' : '-') + ' / RX ' + (s.linkRx != null ? s.linkRx + ' Mbps' : '-')],
        ['Standard / Security', (s.standard || '-') + ' / ' + (s.security || '-')],
        ['Distance (est.)', s.distanceM != null ? s.distanceM + ' m' : '-'],
        ['Internet', 'Down ' + (s.download != null ? s.download + ' Mbps' : '-') + ' / Up ' + (s.upload != null ? s.upload + ' Mbps' : '-')],
        ['Latency', 'Ping ' + (s.ping != null ? s.ping + ' ms' : '-') + ' / Jitter ' + (s.jitter != null ? s.jitter + ' ms' : '-') + ' / Loss ' + (s.packetLoss != null ? s.packetLoss + '%' : '-')],
        ['LAN', (s.lanStatus || '-') + (s.lanLinkSpeed ? ' @ ' + s.lanLinkSpeed : '')],
        ['Gateway / IP', (s.gateway || '-') + ' / ' + (s.ip || '-')],
        ['Notes', s.notes || '-']
      ]
    }))
  };
}

function diagnosisPdfDoc(data, analysis) {
  analysis = analysis || { status: 'n/a', healthScore: 0, osiLayer: null, findings: [] };
  const gw = data.connectivity && data.connectivity.gateway;
  const active = data.connectivity && data.connectivity.activeIface;
  const w = data.wifi && data.wifi.data;
  const conn = data.connectivity || {};
  const mtu = data.mtu || {};
  const ipv6 = data.ipv6 || {};
  return {
    title: 'NetPulse - Diagnosis Report',
    meta: ['Generated: ' + new Date().toLocaleString(), 'Status: ' + analysis.status + ' | Health: ' + analysis.healthScore + '%', 'OSI Layer: ' + (analysis.osiLayer ? analysis.osiLayer.label : '-')],
    blocks: [
      { heading: 'Summary', rows: [
        ['Status', analysis.status],
        ['Health Score', analysis.healthScore + '%'],
        ['OSI Layer', analysis.osiLayer ? analysis.osiLayer.label : '-'],
        ['Interface', active ? active.name + ' (' + active.ipv4 + ')' : 'none'],
        ['Gateway', (gw || 'none') + (conn.gatewayArp && conn.gatewayArp.vendor ? ' [' + conn.gatewayArp.vendor + ']' : '')],
        ['WiFi Signal', w ? w.signalPct + '% (' + w.ssid + ')' : 'n/a'],
        ['Internet', conn.internetReachable ? 'Reachable' : 'NOT reachable'],
        ['DNS', (data.dns && data.dns.server) ? data.dns.server + ' (' + data.dns.lookupMs + 'ms)' : 'FAILED'],
        ['MTU', mtu.mtu != null ? mtu.mtu + ' bytes' : 'n/a'],
        ['IPv6', (ipv6.enabled ? 'Enabled' : 'Disabled') + ' (internet ' + (ipv6.internetOk ? 'OK' : 'n/a') + ')']
      ]}
    ],
    tables: [
      { heading: 'Findings & Root Cause', headers: ['Fault', 'Severity', 'Confidence', 'OSI Layer'], widths: [30, 10, 11, 12], rows: analysis.findings.map(f => [f.title, f.severity, Math.round(f.confidence) + '%', f.layer ? f.layer.label : '']) },
      { heading: 'Traceroute', headers: ['Hop', 'IP', 'Times (ms)', 'Loss'], widths: [7, 22, 22, 8], rows: ((data.trace && data.trace.hops) || []).map(h => [h.hop, h.ip, (h.times || []).map(t => t === null ? '*' : t).join(', '), h.lossPct + '%']) }
    ]
  };
}

async function exportSurveys(format, folderName, ids) {
  let surveys = readSurveys();
  if (Array.isArray(ids) && ids.length) surveys = surveys.filter(s => ids.indexOf(s.id) !== -1);
  if (!surveys.length) return { ok: false, error: 'No survey points to export' };
  const folder = String(folderName || '').replace(/[^\w -]/g, '').trim() || 'Survey_' + new Date().toISOString().slice(0, 10);
  const dir = path.join(SURVEYS_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const files = [];
  const save = (ext, buf) => {
    const f = path.join(dir, 'Survey_' + stamp + '.' + ext);
    fs.writeFileSync(f, buf);
    files.push(f);
  };
  switch (format) {
    case 'csv': save('csv', toCsv(surveys)); break;
    case 'xlsx': save('xlsx', toXlsx(surveys)); break;
    case 'json': save('json', JSON.stringify({ exportedAt: new Date().toISOString(), count: surveys.length, surveys }, null, 2)); break;
    case 'pdf': save('pdf', buildPdf(pdfDoc(surveys))); break;
    case 'kml': save('kml', toKml(surveys)); break;
    default: return { ok: false, error: 'Unsupported format: ' + format };
  }
  return { ok: true, folder: dir, files };
}

async function runFullScan(signal) {
  const isCancelled = () => signal && signal.cancelled;
  const scan = {
    timestamp: new Date().toISOString(),
    phase1: { startedAt: performance.now() },
    wifi: null,
    neighbors: [],
    interfaces: [],
    ipconfig: [],
    arp: [],
    routeGateway: null
  };
  const dq = { platform: getPlatform(), commands: [], warnings: [], locationPermissionBlocked: false, coreCommandsFailed: [] };
  const record = (name, r, emptyParse) => {
    const entry = { name, ok: !!r.ok, emptyParse: !!emptyParse };
    if (!r.ok) entry.error = String(r.out || '').trim().slice(0, 200) || 'command failed';
    dq.commands.push(entry);
  };

  const lanPromise = getLanSpeed();
  const [wlan, nets, ifs, ipc, arp] = await Promise.all([
    runCmd('netsh', ['wlan', 'show', 'interfaces'], 8000),
    runCmd('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 8000),
    runCmd('netsh', ['interface', 'show', 'interface'], 8000),
    runCmd('ipconfig', ['/all'], 8000),
    runCmd('arp', ['-a'], 8000)
  ]);

  scan.wifi = parseWlanInterfaces(wlan.out);
  if (scan.wifi && scan.wifi.data) scan.wifi.data.band = inferBand(scan.wifi.data);
  scan.neighbors = parseNeighbors(nets.out);
  scan.interfaces = parseInterfaces(ifs.out);
  scan.ipconfig = parseIpconfig(ipc.out);
  scan.arp = parseArp(arp.out);

  // Location-permission detection (Windows 11 24H2 blocks netsh wlan without it).
  if (LOCATION_PERMISSION_RE.test(wlan.out || '') || LOCATION_PERMISSION_RE.test(nets.out || '')) {
    dq.locationPermissionBlocked = true;
    dq.warnings.push('netsh wlan needs Location permission; Wi-Fi data is unavailable (this is not a Wi-Fi fault).');
  }

  record('netsh wlan show interfaces', wlan, !scan.wifi || !scan.wifi.data);
  record('netsh wlan show networks', nets, false);
  record('netsh interface show interface', ifs, scan.interfaces.length === 0);
  record('ipconfig /all', ipc, scan.ipconfig.length === 0);
  record('arp -a', arp, false);
  if (scan.ipconfig.length === 0) dq.coreCommandsFailed.push('ipconfig /all');
  if (isCancelled()) return null;

  const route = await runCmd('route', ['print', '0.0.0.0'], 8000);
  for (const raw of route.out.split(/\r?\n/)) {
    const m = raw.trim().match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) { scan.routeGateway = m[1]; break; }
  }
  record('route print', route, !scan.routeGateway);
  if (isCancelled()) return null;

  const picked = pickActiveIface(scan.ipconfig, scan.routeGateway);
  const active = picked.active;
  const gateway = picked.gateway;
  if (!gateway) dq.warnings.push('No default gateway found (no active interface or no route).');

  const hosts = [
    { key: 'gateway', host: gateway },
    { key: 'internet', host: '8.8.8.8' },
    { key: 'alt', host: '1.1.1.1' }
  ].filter(h => h.host);

  const pingResults = {};
  await Promise.all(hosts.map(async (h) => {
    const t0 = performance.now();
    const r = await runCmd('ping', ['-n', String(CFG.pingCount), '-w', String(CFG.pingTimeoutMs), h.host], 15000);
    const p = parsePing(r.out);
    p.durationMs = Math.round(performance.now() - t0);
    pingResults[h.key] = p;
    record('ping ' + h.host, r, p.sent === 0);
  }));
  if (isCancelled()) return null;

  const dnsT0 = performance.now();
  const nsl = await runCmd('nslookup', ['google.com'], 8000);
  const dnsLookupMs = Math.round(performance.now() - dnsT0);
  const dns = parseNslookup(nsl.out);
  dns.lookupMs = dnsLookupMs; dns.tests = await dnsLatencyTests([dns.server].concat(CFG.dnsServers));
  record('nslookup google.com', nsl, false);
  if (isCancelled()) return null;

  const mtu = await detectMtu(gateway);
  const ipv6 = await ipv6Test();
  if (isCancelled()) return null;
  const tr = await runCmd('tracert', ['-d', '-h', String(CFG.traceMaxHops), '-w', '1000', '8.8.8.8'], 60000);
  const trace = parseTracert(tr.out);
  record('tracert 8.8.8.8', tr, trace.hops.length === 0);
  const lan = await lanPromise;

  const gatewayArp = gateway ? (scan.arp.find(e => e.ip === gateway) || null) : null; if (gatewayArp) gatewayArp.vendor = vendorFor(gatewayArp.mac);

  const activeIface = active || null;

  const result = {
    timestamp: scan.timestamp,
    mode: scan.wifi && scan.wifi.connected ? 'wifi' : 'lan',
    connectivity: {
      gateway,
      gatewayArp,
      hasGateway: !!gateway,
      internetReachable: !!(pingResults.internet && pingResults.internet.received > 0),
      gatewayReachable: !!(pingResults.gateway && pingResults.gateway.received > 0),
      pings: pingResults,
      activeIface: activeIface ? {
        name: activeIface.name,
        ipv4: activeIface.ipv4,
        subnet: activeIface.subnet,
        gateway: activeIface.gateway,
        dhcp: activeIface.dhcp,
        dhcpServer: activeIface.dhcpServer,
        mac: activeIface.mac,
        apipa: activeIface.apipa
      } : null
    },
    wifi: scan.wifi,
    neighbors: scan.neighbors,
    interfaces: scan.interfaces,
    ipconfig: scan.ipconfig,
    arp: scan.arp,
    lan,
    dns,
    mtu,
    ipv6,
    trace,
    dataQuality: dq,
    scanDurationMs: Math.round(performance.now() - scan.phase1.startedAt)
  };
  result.analysis = analyzeData(result);
  return result;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://speed.cloudflare.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");
}

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return LOCAL_HOSTNAMES.indexOf(o.hostname) !== -1 && String(o.port || '') === String(PORT);
  } catch (e) { return false; }
}

// Host header allow-list (DNS-rebinding guard).
function allowedHostNames() {
  const names = LOCAL_HOSTNAMES.slice();
  const bind = String(BIND || '').replace(/^\[|\]$/g, '');
  if (bind && bind !== '0.0.0.0' && bind !== '::' && names.indexOf(bind) === -1) names.push(bind);
  return names;
}
function hostAllowed(req) {
  const host = String(req.headers.host || '');
  if (!host) return false;
  const pm = host.match(/:(\d+)$/);
  if (pm && String(pm[1]) !== String(PORT)) return false;
  const bm = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  const h = bm ? bm[1] : host.replace(/:\d+$/, '');
  return allowedHostNames().indexOf(h) !== -1;
}

// When bound to a non-loopback interface we require a shared token.
const AUTH_REQUIRED = !bindIsLoopback();
function authOk(req) {
  if (!AUTH_REQUIRED) return true;
  const token = CFG.authToken;
  if (!token) return false;
  const given = req.headers['x-netpulse-token'];
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function isStaticAllowed(pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) return true;
  if (/^\/[A-Za-z0-9_\-]+\.(png|ico)$/.test(pathname)) return true;
  return false;
}

async function isElevated() {
  if (getPlatform() !== 'win32') return false;
  const r = await runCmd('net', ['session'], 5000);
  return r.ok;
}

async function handlePreflight(res) {
  const platform = getPlatform();
  let isAdmin = false, locationPermission = 'unknown', wlanAvailable = false;
  if (platform === 'win32') {
    isAdmin = await isElevated();
    const wlan = await runCmd('netsh', ['wlan', 'show', 'interfaces'], 8000);
    if (LOCATION_PERMISSION_RE.test(wlan.out || '')) {
      locationPermission = 'blocked';
    } else if (wlan.ok) {
      const w = parseWlanInterfaces(wlan.out);
      wlanAvailable = !!(w && w.available);
      locationPermission = 'ok';
    } else {
      locationPermission = 'unknown';
    }
  }
  sendJson(res, 200, { ok: true, platform, nodeVersion: process.version, isAdmin, locationPermission, wlanAvailable });
}

function analysisOf(entry) {
  if (entry && entry.data && entry.data.analysis) return entry.data.analysis;
  return analyzeData(entry && entry.data);
}

function actionableIds(A) {
  if (!A || !Array.isArray(A.findings)) return [];
  const so = (Analyzer && Analyzer.SEV_ORDER) || { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Healthy': 0 };
  return A.findings.filter(f => (so[f.severity] || 0) >= 2).map(f => f.id);
}

function scanMetrics(data, A) {
  const p = (data && data.connectivity && data.connectivity.pings) || {};
  const w = data && data.wifi && data.wifi.data;
  return {
    healthScore: A && typeof A.healthScore === 'number' ? A.healthScore : null,
    signalPct: w && typeof w.signalPct === 'number' ? w.signalPct : null,
    gatewayLossPct: p.gateway ? p.gateway.lossPct : null,
    internetLossPct: p.internet ? p.internet.lossPct : null,
    internetAvgMs: p.internet ? p.internet.avg : null,
    jitterMs: p.internet ? (typeof p.internet.rttRange === 'number' ? p.internet.rttRange : p.internet.jitter) : null,
    dnsLookupMs: data && data.dns ? data.dns.lookupMs : null
  };
}

function metricOf(key, label, unit, higherIsBetter, before, after) {
  let direction = 'same';
  if (typeof before === 'number' && typeof after === 'number') {
    if (after === before) direction = 'same';
    else if ((after > before) === higherIsBetter) direction = 'better';
    else direction = 'worse';
  }
  return { key, label, before: before == null ? null : before, after: after == null ? null : after, unit, direction };
}

function buildMetrics(before, after, A0, A1) {
  const m0 = scanMetrics(before.data, A0);
  const m1 = scanMetrics(after.data, A1);
  return [
    metricOf('healthScore', 'Health score', '%', true, m0.healthScore, m1.healthScore),
    metricOf('signalPct', 'WiFi signal', '%', true, m0.signalPct, m1.signalPct),
    metricOf('gatewayLossPct', 'Gateway packet loss', '%', false, m0.gatewayLossPct, m1.gatewayLossPct),
    metricOf('internetLossPct', 'Internet packet loss', '%', false, m0.internetLossPct, m1.internetLossPct),
    metricOf('internetAvgMs', 'Internet average RTT', 'ms', false, m0.internetAvgMs, m1.internetAvgMs),
    metricOf('jitterMs', 'Internet jitter', 'ms', false, m0.jitterMs, m1.jitterMs),
    metricOf('dnsLookupMs', 'DNS lookup time', 'ms', false, m0.dnsLookupMs, m1.dnsLookupMs)
  ];
}

function buildVerification(before, after) {
  const A0 = analysisOf(before) || {};
  const A1 = analysisOf(after) || {};
  const d0 = (before.data && before.data.dataQuality) || {};
  const d1 = (after.data && after.data.dataQuality) || {};
  const reasons = [];
  [['before', d0], ['after', d1]].forEach(([label, d]) => {
    if (d.platform && d.platform !== 'win32') reasons.push(label + ' scan was not a Windows scan');
    if (d.locationPermissionBlocked) reasons.push(label + ' scan had Wi-Fi blocked by Location permission');
    if (Array.isArray(d.coreCommandsFailed) && d.coreCommandsFailed.length) reasons.push(label + ' scan had failing core commands: ' + d.coreCommandsFailed.join(', '));
  });
  const i0 = before.data && before.data.connectivity && before.data.connectivity.activeIface;
  const i1 = after.data && after.data.connectivity && after.data.connectivity.activeIface;
  const mac0 = i0 && i0.mac, mac1 = i1 && i1.mac;
  if (mac0 && mac1 && mac0 !== mac1) reasons.push('scans were taken on different adapters');
  else if (!mac0 && !mac1 && i0 && i1 && i0.name && i1.name && i0.name !== i1.name) reasons.push('scans were taken on different adapters');
  const ssid0 = before.data && before.data.wifi && before.data.wifi.data && before.data.wifi.data.ssid;
  const ssid1 = after.data && after.data.wifi && after.data.wifi.data && after.data.wifi.data.ssid;
  if (ssid0 && ssid1 && ssid0 !== ssid1) reasons.push('scans were taken on different SSIDs');

  const metrics = buildMetrics(before, after, A0, A1);
  if (reasons.length) {
    return { beforeId: before.id, afterId: after.id, verdict: 'inconclusive', resolvedFindingIds: [], newFindingIds: [], metrics, reasons };
  }

  const b = actionableIds(A0);
  const a = actionableIds(A1);
  const resolvedFindingIds = b.filter(id => a.indexOf(id) === -1);
  const newFindingIds = a.filter(id => b.indexOf(id) === -1);
  const h0 = typeof A0.healthScore === 'number' ? A0.healthScore : null;
  const h1 = typeof A1.healthScore === 'number' ? A1.healthScore : null;
  const healthUp = h0 != null && h1 != null && h1 - h0 >= 5;
  const healthDown = h0 != null && h1 != null && h0 - h1 >= 5;

  let verdict;
  if (b.length > 0 && a.length === 0) verdict = 'resolved';
  else if (resolvedFindingIds.length > 0 && newFindingIds.length === 0) verdict = 'improved';
  else if (newFindingIds.length > 0 && resolvedFindingIds.length === 0) verdict = 'worse';
  else if (newFindingIds.length > 0 && resolvedFindingIds.length > 0) verdict = healthUp ? 'improved' : 'worse';
  else if (healthUp) verdict = 'improved';
  else if (healthDown) verdict = 'worse';
  else verdict = 'unchanged';

  return { beforeId: before.id, afterId: after.id, verdict, resolvedFindingIds, newFindingIds, metrics, reasons };
}

let scanInProgress = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  sendSecurityHeaders(res);

  const isApiPath = pathname.startsWith('/api/');
  if (isApiPath) {
    if (!hostAllowed(req)) {
      sendJson(res, 403, { ok: false, code: 'HOST_NOT_ALLOWED', error: 'Host header not allowed' });
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site' || !isSameOrigin(req)) {
      sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Cross-origin request blocked' });
      return;
    }
    if (!authOk(req)) {
      sendJson(res, 401, { ok: false, code: 'AUTH_REQUIRED', error: 'Missing or invalid X-NetPulse-Token' });
      return;
    }
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, name: 'netpulse', version: '1.0.0' });
    return;
  }

  // Unified scan pipeline. POST /api/scan is preferred; GET /api/scan is kept
  // for the legacy UI (and still writes history). /api/network uses the same
  // collector but never writes history.
  if ((pathname === '/api/scan' || pathname === '/api/network') && (req.method === 'GET' || req.method === 'POST')) {
    if (getPlatform() !== 'win32') {
      sendJson(res, 501, {
        ok: false, code: 'UNSUPPORTED_PLATFORM',
        error: 'Live network diagnostics require Windows (process.platform = ' + getPlatform() + ').',
        hint: 'Run NetPulse on Windows, or use the Simulation Lab scenarios.'
      });
      return;
    }
    if (scanInProgress) {
      sendJson(res, 409, { ok: false, code: 'SCAN_BUSY', error: 'A scan is already running' });
      return;
    }
    scanInProgress = true;
    const scanSignal = { cancelled: false };
    res.on('close', () => { scanSignal.cancelled = true; });
    try {
      const data = await runFullScan(scanSignal);
      if (!data || res.destroyed) return;
      if (pathname === '/api/scan') {
        data.id = newSurveyId();
        const hist = readHistory();
        hist.unshift({ id: data.id, data });
        if (hist.length > HISTORY_LIMIT) hist.length = HISTORY_LIMIT;
        writeHistory(hist);
      }
      if (res.destroyed) return;
      sendJson(res, 200, { ok: true, data });
    } catch (e) {
      if (res.destroyed) return;
      sendJson(res, 500, { ok: false, code: 'SCAN_FAILED', error: String(e && e.message || e) });
    } finally {
      scanInProgress = false;
    }
    return;
  }

  if (pathname === '/api/speedtest/data' && req.method === 'GET') {
    const bytes = Math.min(Math.max(parseInt(url.searchParams.get('bytes') || '8388608', 10) || 8388608, 524288), 67108864);
    const buf = Buffer.alloc(bytes);
    const pattern = Buffer.from('NetPlusAISpeedTest0123456789abcdefghijklmnopqrstuvwxyz!@#', 'latin1');
    for (let i = 0; i < bytes; i += pattern.length) pattern.copy(buf, i);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes });
    res.end(buf);
    return;
  }

  if (pathname === '/api/speedtest/upload' && req.method === 'POST') {
    const t0 = performance.now();
    let size = 0;
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      size += c.length;
      // Drain (but stop counting) instead of destroying, so the client gets a
      // clean 413 rather than a connection reset.
      if (size > 64 * 1024 * 1024) { tooBig = true; }
    });
    req.on('end', () => {
      if (tooBig) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
        return;
      }
      const ms = Math.max(1, performance.now() - t0);
      const mbps = Math.round(size * 8 / 1e6 / (ms / 1000) * 100) / 100;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, bytes: size, ms: Math.round(ms * 10) / 10, mbps }));
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(tooBig ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: tooBig ? 'Payload too large' : 'Upload aborted' }));
      }
    });
    return;
  }

  if (pathname === '/api/surveys' && req.method === 'GET') {
    const list = readSurveys().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, surveys: list }));
    return;
  }

  if (pathname === '/api/surveys' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const survey = Object.assign({}, body);
      if (!survey.id) survey.id = newSurveyId();
      if (!survey.timestamp) survey.timestamp = new Date().toISOString();
      const list = readSurveys();
      list.unshift(survey);
      writeSurveys(list);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, survey }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  const surveyMatch = pathname.match(/^\/api\/surveys\/([A-Za-z0-9_-]{1,64})$/);
  if (surveyMatch) {
    const id = surveyMatch[1];
    if (req.method === 'PUT') {
      try {
        const body = await readJsonBody(req);
        const list = readSurveys();
        const idx = list.findIndex(s => s.id === id);
        if (idx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Survey point not found' }));
          return;
        }
        list[idx] = Object.assign({}, list[idx], body, { id });
        writeSurveys(list);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, survey: list[idx] }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
      return;
    }
    if (req.method === 'DELETE') {
      writeSurveys(readSurveys().filter(s => s.id !== id));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  if (pathname === '/api/export' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const result = await exportSurveys(String(body.format || '').toLowerCase(), body.folder, body.ids);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }

  if (pathname === '/api/report' && req.method === 'POST') {
    let body = '';
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      body += c;
      // Drain (but stop buffering) instead of destroying, so the client gets a
      // clean 413 rather than a connection reset.
      if (body.length > 2 * 1024 * 1024) { tooBig = true; body = ''; }
    });
    req.on('end', () => {
      if (tooBig) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Report too large' }));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        const reportsDir = REPORTS_DIR;
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        let file;
        if (parsed.format === 'pdf' && parsed.json) {
          file = path.join(reportsDir, 'diagnosis_' + stamp + '.pdf');
          fs.writeFileSync(file, buildPdf(diagnosisPdfDoc(parsed.json.data, parsed.json.analysis)));
        } else {
          file = path.join(reportsDir, 'report_' + stamp + '.html');
          fs.writeFileSync(file, parsed.html || '');
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, path: file }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(tooBig ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: tooBig ? 'Report too large' : 'Request aborted' }));
      }
    });
    return;
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, list: readHistory().map(h => historySummary(h.data, h.id)) }));
    return;
  }
  if (pathname === '/api/history' && req.method === 'DELETE') {
    writeHistory([]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const historyMatch = pathname.match(/^\/api\/history\/([A-Za-z0-9_-]{1,64})$/);
  if (historyMatch && req.method === 'GET') {
    const item = readHistory().find(h => h.id === historyMatch[1]);
    if (!item) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Scan not found' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, data: item.data }));
    return;
  }
  if (historyMatch && req.method === 'DELETE') {
    const before = readHistory();
    const after = before.filter(h => h.id !== historyMatch[1]);
    if (after.length === before.length) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Scan not found' })); return; }
    writeHistory(after);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (pathname === '/api/preflight' && req.method === 'GET') {
    await handlePreflight(res);
    return;
  }

  if (pathname === '/api/action' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body.confirm !== true) {
        sendJson(res, 400, { ok: false, code: 'CONFIRM_REQUIRED', error: 'confirm:true is required to run an action' });
        return;
      }
      const name = String(body.action || '');
      const acts = {
        'dhcp-renew': { label: 'DHCP renew (release + renew)', steps: [['ipconfig', ['/release']], ['ipconfig', ['/renew']]] },
        'flush-dns': { label: 'DNS cache flush', steps: [['ipconfig', ['/flushdns']]] }
      };
      if (name === 'restore-dns-dhcp') {
        // Validate the adapter against a FRESH ipconfig parse; the value is
        // passed as an execFile argument (never a shell string).
        const ipc = await runCmd('ipconfig', ['/all'], 8000);
        const adapters = parseIpconfig(ipc.out);
        const wanted = String(body.adapter || '');
        const match = adapters.find(x => x.name === wanted);
        if (!match) {
          sendJson(res, 400, { ok: false, code: 'INVALID_ADAPTER', error: 'Unknown adapter name; it must match a fresh ipconfig entry exactly.' });
          return;
        }
        if (!(await isElevated())) {
          sendJson(res, 403, { ok: false, code: 'ADMIN_REQUIRED', error: 'This action needs Administrator rights.', hint: 'Restart the terminal as Administrator.' });
          return;
        }
        const r = await runCmd('netsh', ['interface', 'ip', 'set', 'dns', 'name=' + match.name, 'dhcp'], 25000);
        sendJson(res, 200, { ok: true, action: name, label: 'Restore DNS + DHCP on ' + match.name, outputs: [{ cmd: 'netsh interface ip set dns name=' + match.name + ' dhcp', ok: r.ok, out: (r.out || '').trim().slice(0, 800) }] });
        return;
      }
      const a = acts[name];
      if (!a) { sendJson(res, 400, { ok: false, code: 'UNKNOWN_ACTION', error: 'Unknown action' }); return; }
      const outputs = [];
      for (const [cmd, args] of a.steps) {
        const r = await runCmd(cmd, args, 25000);
        outputs.push({ cmd: cmd + ' ' + args.join(' '), ok: r.ok, out: (r.out || '').trim().slice(0, 800) });
      }
      sendJson(res, 200, { ok: true, action: name, label: a.label, outputs });
    } catch (e) {
      sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: String(e && e.message || e) });
    }
    return;
  }

  if (pathname === '/api/verify' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.beforeId || !body.afterId) {
        sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: 'beforeId and afterId are required' });
        return;
      }
      const hist = readHistory();
      const before = hist.find(h => h.id === body.beforeId);
      const after = hist.find(h => h.id === body.afterId);
      if (!before || !after) {
        sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Unknown history id' });
        return;
      }
      sendJson(res, 200, Object.assign({ ok: true }, buildVerification(before, after)));
    } catch (e) {
      sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: String(e && e.message || e) });
    }
    return;
  }

  if (!isStaticAllowed(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function openBrowser() {
  if (process.env.NETPULSE_NO_OPEN === '1') return;
  try { exec('start "" http://' + BIND + ':' + PORT, { windowsHide: true, shell: 'cmd.exe' }, () => {}); } catch (e) { /* best effort */ }
}

function startServer() {
  return new Promise((resolve, reject) => {
    if (!bindIsLoopback() && !CFG.authToken) {
      const msg = 'Refusing to start: bindHost "' + BIND + '" is not loopback and config.authToken is not set. ' +
        'Set a token (config.authToken) or bind to 127.0.0.1.';
      reject(new Error(msg));
      return;
    }
    server.once('error', reject);
    server.listen(PORT, BIND, () => {
      console.log('');
      console.log('==========================================');
      console.log('  NetPulse - Network Diagnosis & Wi-Fi Survey');
      console.log(`  Server running: http://localhost:${PORT}`);
      if (AUTH_REQUIRED) console.log('  Auth: X-NetPulse-Token required (non-loopback bind)');
      console.log('==========================================');
      console.log('');
      openBrowser();
      resolve(server);
    });
  });
}

process.on('uncaughtException', (e) => {
  console.error('[NetPulse] Uncaught exception:', e && e.stack ? e.stack : e);
  process.exit(1);
});

if (require.main === module) {
  startServer().catch((e) => {
    console.error('[NetPulse] Failed to start:', e && e.message);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  server,
  setRunner,
  runFullScan,
  analyzeData,
  buildVerification,
  analysisOf,
  actionableIds,
  scanMetrics,
  historySummary,
  newSurveyId,
  isElevated,
  hostAllowed,
  isSameOrigin,
  authOk,
  getPlatform,
  inferBand,
  pickActiveIface,
  vendorFor,
  parseWlanInterfaces,
  parseNeighbors,
  parseInterfaces,
  parseIpconfig,
  parsePing,
  parseNslookup,
  parseTracert,
  parseArp,
  PORT,
  BIND
};
