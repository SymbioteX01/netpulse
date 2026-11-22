'use strict';
/*
 * Unit tests for js/survey-live.js (window.NPLive / module.exports).
 *
 * Everything is injected (geolocation, timers, clock, signal fetch, id), so the
 * whole controller is exercised without a browser, a network, or real Wi-Fi.
 */
const test = require('node:test');
const assert = require('node:assert');

const NPLive = require('../js/survey-live.js');

function makeClock() {
  let t = 1000000;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

function makeTimers() {
  let seq = 1;
  const pending = new Map();
  return {
    set: (fn) => { const h = seq++; pending.set(h, fn); return h; },
    clear: (h) => { pending.delete(h); },
    size: () => pending.size,
    async tick() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) await fn(); }
  };
}

function makeGeo() {
  const g = {
    watchCount: 0, clearCount: 0, lastWatchOpts: null, lastGetOpts: null,
    _cb: null, _getOk: null, _getErr: null,
    watchPosition(onOk, onErr, opts) { g.watchCount++; g._cb = { onOk, onErr }; g.lastWatchOpts = opts; return 'w' + g.watchCount; },
    clearWatch() { g.clearCount++; g._cb = null; },
    getCurrentPosition(onOk, onErr, opts) {
      g.lastGetOpts = opts;
      if (g._getErr) onErr(g._getErr);
      else if (g._getOk) onOk(g._getOk);
      else onErr({ code: 2, message: 'no fix' });
    },
    emit(pos) { if (g._cb) g._cb.onOk(pos); },
    emitError(e) { if (g._cb) g._cb.onErr(e); },
    setFix(pos) { g._getOk = pos; },
    setGetError(e) { g._getErr = e; }
  };
  return g;
}

function fix(lat, lng, accuracy, ts) {
  return { coords: { latitude: lat, longitude: lng, accuracy }, timestamp: ts };
}

function connectedSignal(pct) {
  return () => Promise.resolve({ ok: true, connected: true, signalPct: pct, ssid: 'ExampleNet', bssid: '02:11:22:33:44:55', band: '2.4 GHz', channel: '6' });
}

function makeController(over) {
  over = over || {};
  const clock = makeClock();
  const timers = makeTimers();
  const geolocation = over.geolocation !== undefined ? over.geolocation : makeGeo();
  let n = 0;
  return {
    clock, timers, geolocation,
    ctl: NPLive.create({
      geolocation,
      fetchSignal: over.fetchSignal || connectedSignal(70),
      now: clock.now,
      setTimer: timers.set,
      clearTimer: timers.clear,
      uid: () => 'pt' + (++n)
    }, over.opts || {})
  };
}

test('start/stop: running guard, watch cleared and timers cleared on stop', async () => {
  const { ctl, geolocation, timers } = makeController();
  const events = [];
  ctl.on('state', s => events.push(s.status));

  ctl.start();
  assert.strictEqual(ctl.getState().status, 'running');
  ctl.start(); // no-op while running
  assert.strictEqual(geolocation.watchCount, 1, 'double start must not open a second watch');
  assert.ok(timers.size() >= 1, 'a tick timer is scheduled');

  ctl.stop();
  assert.strictEqual(ctl.getState().status, 'stopped');
  assert.strictEqual(timers.size(), 0, 'stop clears the tick timer');
  assert.strictEqual(geolocation.clearCount, 1, 'stop clears the geolocation watch');
  assert.ok(events.includes('running') && events.includes('stopped'));
});

test('permission denied / unavailable / timeout map to error codes with no points', async () => {
  const cases = [
    [{ code: 1, message: 'denied' }, 'PERMISSION_DENIED'],
    [{ code: 2, message: 'nope' }, 'POSITION_UNAVAILABLE'],
    [{ code: 3, message: 'slow' }, 'TIMEOUT']
  ];
  for (const [err, code] of cases) {
    const { ctl, geolocation, timers } = makeController();
    const errors = [];
    ctl.on('error', e => errors.push(e));
    ctl.start();
    geolocation.emitError(err);
    const st = ctl.getState();
    assert.strictEqual(st.status, 'error', code + ' status');
    assert.strictEqual(st.errorCode, code);
    assert.ok(typeof st.message === 'string' && st.message.length > 0, 'human-readable message');
    assert.strictEqual(ctl.getPoints().length, 0, 'no points on error');
    assert.strictEqual(timers.size(), 0, 'error clears timers');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, code);
  }
});

test('unsupported geolocation (insecure context) -> UNSUPPORTED, no points', async () => {
  for (const geo of [null, {}]) {
    const { ctl } = makeController({ geolocation: geo });
    ctl.start();
    const st = ctl.getState();
    assert.strictEqual(st.status, 'error');
    assert.strictEqual(st.errorCode, 'UNSUPPORTED');
    assert.strictEqual(ctl.getPoints().length, 0);
  }
});

test('tick skips: noGps, timeout, lowAccuracy', async () => {
  // noGps: tick before any fix arrives.
  {
    const { ctl, timers } = makeController();
    const skips = [];
    ctl.on('skip', s => skips.push(s.reason));
    ctl.start();
    await timers.tick();
    assert.deepStrictEqual(skips, ['noGps']);
  }
  // timeout: the only fix is older than 2 * interval.
  {
    const { ctl, geolocation, timers, clock } = makeController();
    const skips = [];
    ctl.on('skip', s => skips.push(s.reason));
    ctl.start();
    geolocation.emit(fix(1, 1, 10, clock.now() - 20000));
    await timers.tick();
    assert.deepStrictEqual(skips, ['timeout']);
  }
  // lowAccuracy: accuracy worse than the configured max (default 50 m).
  {
    const { ctl, geolocation, timers, clock } = makeController();
    const skips = [];
    ctl.on('skip', s => skips.push(s.reason));
    ctl.start();
    geolocation.emit(fix(1, 1, 80, clock.now()));
    await timers.tick();
    assert.deepStrictEqual(skips, ['lowAccuracy']);
  }
});

test('tick skips noSignal when the AP is not connected or the reading is missing', async () => {
  for (const sig of [
    () => Promise.resolve({ ok: true, connected: false, signalPct: null }),
    () => Promise.resolve({ ok: true, connected: true, signalPct: null }),
    () => Promise.resolve({ ok: false })
  ]) {
    const { ctl, geolocation, timers, clock } = makeController({ fetchSignal: sig });
    const skips = [];
    ctl.on('skip', s => skips.push(s.reason));
    ctl.start();
    geolocation.emit(fix(1, 1, 10, clock.now()));
    await timers.tick();
    assert.deepStrictEqual(skips, ['noSignal']);
    assert.strictEqual(ctl.getPoints().length, 0);
  }
});

test('capture: a valid fix becomes one in-memory point with the live metadata', async () => {
  const { ctl, geolocation, timers, clock } = makeController();
  const points = [];
  ctl.on('point', p => points.push(p));
  ctl.start();
  geolocation.emit(fix(28.6, 77.2, 12, clock.now()));
  await timers.tick();

  assert.strictEqual(points.length, 1);
  const p = points[0];
  assert.strictEqual(p.lat, 28.6);
  assert.strictEqual(p.lng, 77.2);
  assert.strictEqual(p.signalPct, 70);
  assert.strictEqual(p.gpsAccuracyM, 12);
  assert.strictEqual(p.locationSource, 'browser-geolocation');
  assert.strictEqual(p.measurementMode, 'live-signal');
  assert.strictEqual(p.signalSource, 'netsh-wlan');
  assert.strictEqual(p.ping, null);
  assert.strictEqual(p.download, null);
  assert.ok(p.id && typeof p.id === 'string');
  assert.strictEqual(ctl.getState().pointCount, 1);
  assert.strictEqual(ctl.getPoints().length, 1);

  // Points live only in memory until saveSession is called.
  ctl.discard();
  assert.strictEqual(ctl.getPoints().length, 0);
  assert.strictEqual(ctl.getState().pointCount, 0);
});

test('duplicate fix (< minMoveM) is skipped', async () => {
  const { ctl, geolocation, timers, clock } = makeController();
  const skips = [];
  ctl.on('skip', s => skips.push(s.reason));
  ctl.start();
  geolocation.emit(fix(1, 1, 10, clock.now()));
  await timers.tick();
  assert.strictEqual(ctl.getPoints().length, 1, 'first fix captured');
  geolocation.emit(fix(1.00002, 1, 10, clock.now())); // ~2.2 m away
  await timers.tick();
  assert.ok(skips.includes('duplicate'), 'close fix is a duplicate');
  assert.strictEqual(ctl.getPoints().length, 1);
});

test('three consecutive identical fixes warn once with LOCATION_NOT_UPDATING', async () => {
  const { ctl, geolocation, timers, clock } = makeController();
  const errors = [];
  ctl.on('error', e => errors.push(e));
  ctl.start();
  for (let i = 0; i < 3; i++) {
    geolocation.emit(fix(1, 1, 10, clock.now()));
    await timers.tick();
  }
  const notUpdating = errors.filter(e => e.code === 'LOCATION_NOT_UPDATING');
  assert.strictEqual(notUpdating.length, 1, 'warn exactly once');
  assert.strictEqual(notUpdating[0].code, 'LOCATION_NOT_UPDATING');
});

test('captureNow uses a fresh one-shot fix (maximumAge 0)', async () => {
  const { ctl, geolocation, clock } = makeController();
  geolocation.setFix(fix(10, 20, 8, clock.now()));
  const p = await ctl.captureNow();
  assert.ok(p, 'captureNow resolves with the point');
  assert.strictEqual(p.lat, 10);
  assert.strictEqual(p.lng, 20);
  assert.strictEqual(geolocation.lastGetOpts.maximumAge, 0, 'must request a fresh fix');
  assert.strictEqual(ctl.getPoints().length, 1);
});

test('acquirePosition: one-shot fix with maximumAge defaulting to 0', async () => {
  const g = makeGeo();
  g.setFix(fix(5, 6, 9, 12345));
  const res = await NPLive.acquirePosition(g, {});
  assert.strictEqual(res.lat, 5);
  assert.strictEqual(res.lng, 6);
  assert.strictEqual(res.accuracyM, 9);
  assert.strictEqual(res.timestamp, 12345);
  assert.strictEqual(g.lastGetOpts.maximumAge, 0);
  assert.strictEqual(g.lastGetOpts.enableHighAccuracy, true);

  // Unsupported geolocation rejects with a stable code.
  await assert.rejects(() => NPLive.acquirePosition(null, {}), (e) => e.code === 'UNSUPPORTED');
});

test('saveSession performs a single batch POST', async () => {
  const calls = [];
  const api = (path, opts) => { calls.push({ path, opts }); return Promise.resolve({ ok: true, saved: 2 }); };
  const r = await NPLive.saveSession([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], { sessionId: 'S1', sessionName: 'Run' }, api);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls.length, 1, 'exactly one request');
  assert.strictEqual(calls[0].path, '/api/surveys/batch');
  const body = JSON.parse(calls[0].opts.body);
  assert.strictEqual(body.sessionId, 'S1');
  assert.strictEqual(body.points.length, 2);
});
