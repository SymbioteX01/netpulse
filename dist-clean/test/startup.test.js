'use strict';
/*
 * Proves that a server that cannot start is detected as a failure.
 *
 * Every other *.test.js file asserts `assert.ok(srv.ready, ...)` in its before()
 * hook. This file demonstrates that when the server cannot bind, startServer()
 * resolves with ready === false and a non-zero exit code, so those before()
 * hooks fail and `npm test` exits non-zero.
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { startServer, SERVER, ROOT } = require('./helpers/server.js');

function occupyPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('server that cannot bind is reported not-ready with a non-zero exit', async () => {
  const blocker = await occupyPort();
  const port = blocker.address().port;
  let handle;
  try {
    handle = await startServer({ port });
    assert.strictEqual(handle.ready, false, 'startServer must not report ready when the port is taken');
    const code = await handle.exited;
    assert.notStrictEqual(code, 0, 'a server that failed to bind must exit non-zero');
    assert.match(handle.getOutput(), /Failed to start|EADDRINUSE|address already in use/i);
  } finally {
    if (handle) await handle.stop();
    await new Promise(r => blocker.close(r));
  }
});

test('invalid bindHost with a token exits non-zero (bind error, not token guard)', async () => {
  // 192.0.2.0/24 is TEST-NET-1 (documentation range), never assigned locally,
  // so listen() fails with EADDRNOTAVAIL. A token is supplied so this exercises
  // the bind failure path rather than the refuse-to-start guard.
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NETPULSE_BIND: '192.0.2.1',
      NETPULSE_AUTH_TOKEN: 'startup-test-token',
      NETPULSE_PORT: '0',
      NETPULSE_NO_OPEN: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', c => out += c);
  child.stderr.on('data', c => out += c);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notStrictEqual(code, 0, 'bad bind must exit non-zero; output: ' + out);
  assert.match(out, /Failed to start/i);
  assert.strictEqual(SERVER, path.join(ROOT, 'server.js'));
});
