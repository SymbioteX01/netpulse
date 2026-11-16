'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Start server.js as a child process on a free port with a TEMP data dir.
// Never touches the real data/ or Surveys/ folders.
async function startServer(opts) {
  opts = opts || {};
  const port = opts.port || await freePort();
  const dataDir = opts.dataDir || tempDir('netpulse-data-');
  const surveysDir = opts.surveysDir || tempDir('netpulse-surveys-');
  const reportsDir = opts.reportsDir || tempDir('netpulse-reports-');
  const env = Object.assign({}, process.env, {
    NETPULSE_PORT: String(port),
    NETPULSE_DATA_DIR: dataDir,
    NETPULSE_SURVEYS_DIR: surveysDir,
    NETPULSE_REPORTS_DIR: reportsDir,
    NETPULSE_NO_OPEN: '1'
  }, opts.env || {});
  const child = spawn(process.execPath, [SERVER], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', c => out += c);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const base = 'http://127.0.0.1:' + port;

  const handle = {
    port, base, dataDir, surveysDir, reportsDir, child,
    getOutput: () => out,
    exited,
    ready: false,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
      }
    }
  };

  if (opts.noWait) return handle;

  const deadline = Date.now() + 20000;
  const probeHeaders = { Host: '127.0.0.1:' + port };
  if (env.NETPULSE_AUTH_TOKEN) probeHeaders['X-NetPulse-Token'] = env.NETPULSE_AUTH_TOKEN;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      // ANY HTTP response means the server is listening (a 401 from an
      // auth-protected bind still proves readiness).
      const r = await fetch(base + '/api/health', { headers: probeHeaders });
      if (r.status > 0) { handle.ready = true; break; }
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return handle;
}

module.exports = { startServer, freePort, tempDir, ROOT, SERVER };
