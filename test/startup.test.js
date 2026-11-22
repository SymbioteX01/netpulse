'use strict';
/*
 * Proves that a server which cannot start is detected as a failure.
 *
 * Every other *.test.js asserts `assert.ok(srv.ready, ...)` in its before()
 * hook. When the server cannot bind, startServer() resolves with ready === false
 * and a non-zero exit code, so those before() hooks fail and `npm test` exits
 * non-zero.
 *
 * NOTE: the failure is provoked with an unassignable bind address (TEST-NET-1,
 * RFC 5737) rather than an occupied port. On Windows SO_REUSEADDR can let two
 * sockets bind the same port, which makes the "occupied port" variant unreliable
 * (the child stays up and the test hangs).
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { startServer, SERVER, ROOT } = require('./helpers/server.js');

// 192.0.2.0/24 is TEST-NET-1: never assigned to a local interface, so listen()
// fails with EADDRNOTAVAIL. A token is supplied so the child reaches the bind
// step instead of the "non-loopback without token" refuse-to-start guard.
const BAD_BIND = '192.0.2.1';
const TOKEN = 'startup-test-token';

test('startServer reports not-ready and a non-zero exit when the server cannot bind', async () => {
  const handle = await startServer({ env: { NETPULSE_BIND: BAD_BIND, NETPULSE_AUTH_TOKEN: TOKEN } });
  try {
    assert.strictEqual(handle.ready, false, 'startServer must not report ready when the server cannot bind');
    const code = await handle.exited;
    assert.notStrictEqual(code, 0, 'a server that failed to bind must exit non-zero');
    assert.match(handle.getOutput(), /Failed to start|EADDRNOTAVAIL/i);
  } finally {
    await handle.stop();
  }
});

test('server.js exits non-zero on an unassignable bind address (direct spawn)', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NETPULSE_BIND: BAD_BIND,
      NETPULSE_AUTH_TOKEN: TOKEN,
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
