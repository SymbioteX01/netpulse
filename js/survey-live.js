/*!
 * NetPulse live survey controller (UMD).
 *
 * Exposes window.NPLive in the browser and module.exports in Node.
 * No DOM, no fetch, no Leaflet. Every side effect (geolocation, signal
 * polling, clock, timers, id generation, api) is injectable, so the whole
 * controller can be driven from tests without a browser.
 *
 * Points are held in memory only; persistence happens through saveSession(),
 * which makes ONE batch request (so a live survey never evicts the rolling
 * backups the way per-point writes would).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NPLive = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_INTERVAL_MS = 5000;
  var DEFAULT_MAX_ACCURACY_M = 50;
  var DEFAULT_MIN_MOVE_M = 5;

  function resolveGeo(opts) {
    if (opts && opts.geo) return opts.geo;
    if (typeof window !== 'undefined' && window.NPGeo) return window.NPGeo;
    if (typeof global !== 'undefined' && global.NPGeo) return global.NPGeo;
    try { if (typeof require === 'function') return require('./geo-core.js'); } catch (e) { /* ignore */ }
    return null;
  }

  function num(v, dflt) {
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  // Map a W3C GeolocationPositionError to a stable code + human message.
  function geoErrorCode(err) {
    if (!err) return 'POSITION_UNAVAILABLE';
    if (err.code === 1 || err.code === 'PERMISSION_DENIED') return 'PERMISSION_DENIED';
    if (err.code === 2 || err.code === 'POSITION_UNAVAILABLE') return 'POSITION_UNAVAILABLE';
    if (err.code === 3 || err.code === 'TIMEOUT') return 'TIMEOUT';
    if (err.code === 'UNSUPPORTED') return 'UNSUPPORTED';
    return 'POSITION_UNAVAILABLE';
  }

  function geoErrorMessage(code) {
    if (code === 'PERMISSION_DENIED') return 'Location permission was denied. Allow location access and try again.';
    if (code === 'TIMEOUT') return 'Timed out waiting for a location fix. Move to an area with a clearer GPS/Wi-Fi view.';
    if (code === 'UNSUPPORTED') return 'Geolocation is not available (the page must be served over a secure context and the browser must support it).';
    return 'Location is currently unavailable. Check that location services are enabled.';
  }

  function normalizeGeoError(err) {
    var code = geoErrorCode(err);
    var e = new Error(err && err.message ? err.message : geoErrorMessage(code));
    e.code = code;
    return e;
  }

  // One-shot position acquisition. maximumAge defaults to 0 (a FRESH fix), not
  // the 60000 ms the old ad-hoc code used. Resolves {lat,lng,accuracyM,timestamp}.
  function acquirePosition(geolocation, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        var e = new Error(geoErrorMessage('UNSUPPORTED'));
        e.code = 'UNSUPPORTED';
        reject(e);
        return;
      }
      var onOk = function (pos) {
        var c = (pos && pos.coords) || {};
        resolve({
          lat: c.latitude,
          lng: c.longitude,
          accuracyM: (typeof c.accuracy === 'number' ? c.accuracy : null),
          timestamp: (pos && pos.timestamp) || (opts.now ? opts.now() : Date.now())
        });
      };
      var onErr = function (err) { reject(normalizeGeoError(err)); };
      try {
        geolocation.getCurrentPosition(onOk, onErr, {
          enableHighAccuracy: opts.enableHighAccuracy !== false,
          maximumAge: opts.maximumAge == null ? 0 : opts.maximumAge,
          timeout: opts.timeoutMs || 15000
        });
      } catch (err) { reject(normalizeGeoError(err)); }
    });
  }

  // ONE batch write for a whole session.
  function saveSession(points, meta, api) {
    meta = meta || {};
    var body = {
      sessionId: meta.sessionId != null ? meta.sessionId : null,
      sessionName: meta.sessionName != null ? meta.sessionName : null,
      points: Array.isArray(points) ? points : []
    };
    if (typeof api === 'function') {
      return api('/api/surveys/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
    if (api && typeof api.post === 'function') return api.post('/api/surveys/batch', body);
    throw new Error('saveSession requires an api function (or api.post)');
  }

  function create(deps, opts) {
    deps = deps || {};
    opts = opts || {};

    var geo = resolveGeo(opts);
    var validate = deps.validateSurveyInput || (geo && geo.validateSurveyInput);
    var haversineM = (geo && geo.haversineM) || function () { return Infinity; };
    var isValidSignalPct = (geo && geo.isValidSignalPct) || function (v) { return typeof v === 'number' && v >= 0 && v <= 100; };

    var now = deps.now || function () { return Date.now(); };
    var setTimer = deps.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = deps.clearTimer || function (h) { if (h != null) clearTimeout(h); };
    var uid = deps.uid || function () { return 'L' + Math.random().toString(36).slice(2, 10); };
    var geolocation = deps.geolocation || null;
    var fetchSignal = deps.fetchSignal || function () { return Promise.resolve({ ok: false }); };

    var intervalMs = num(opts.intervalMs, DEFAULT_INTERVAL_MS);
    var maxAccuracyM = num(opts.maxAccuracyM, DEFAULT_MAX_ACCURACY_M);
    var minMoveM = num(opts.minMoveM, DEFAULT_MIN_MOVE_M);
    var sessionId = opts.sessionId || uid();
    var sessionName = opts.sessionName || ('Session ' + sessionId);

    var listeners = {};
    var points = [];
    var timer = null;
    var watchId = null;
    var running = false;
    var latestFix = null;
    var lastFixKey = null;
    var identicalCount = 0;
    var warnedNotUpdating = false;
    var lastAccepted = null;

    var state = {
      status: 'idle',
      errorCode: null,
      message: null,
      intervalMs: intervalMs,
      maxAccuracyM: maxAccuracyM,
      minMoveM: minMoveM,
      sessionId: sessionId,
      sessionName: sessionName,
      startedAt: null,
      pointCount: 0,
      lastFix: null,
      lastSkipReason: null
    };

    function on(evt, fn) {
      if (typeof fn !== 'function') return;
      (listeners[evt] = listeners[evt] || []).push(fn);
    }
    function off(evt, fn) {
      var l = listeners[evt];
      if (!l) return;
      if (!fn) { delete listeners[evt]; return; }
      var i = l.indexOf(fn);
      if (i !== -1) l.splice(i, 1);
    }
    function emit(evt, payload) {
      (listeners[evt] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { /* listener errors must not break capture */ }
      });
    }
    function setState(patch) {
      for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) state[k] = patch[k]; }
      emit('state', getState());
    }
    function getState() {
      return {
        status: state.status, errorCode: state.errorCode, message: state.message,
        intervalMs: state.intervalMs, maxAccuracyM: state.maxAccuracyM, minMoveM: state.minMoveM,
        sessionId: state.sessionId, sessionName: state.sessionName,
        startedAt: state.startedAt, pointCount: state.pointCount,
        lastFix: state.lastFix ? { lat: state.lastFix.lat, lng: state.lastFix.lng, accuracyM: state.lastFix.accuracyM, timestamp: state.lastFix.timestamp } : null,
        lastSkipReason: state.lastSkipReason
      };
    }
    function skip(reason) {
      setState({ lastSkipReason: reason });
      emit('skip', { reason: reason });
    }
    function fail(code, message) {
      running = false;
      if (timer != null) { clearTimer(timer); timer = null; }
      if (watchId != null && geolocation && typeof geolocation.clearWatch === 'function') {
        try { geolocation.clearWatch(watchId); } catch (e) { /* ignore */ }
      }
      watchId = null;
      setState({ status: 'error', errorCode: code, message: message || geoErrorMessage(code) });
      emit('error', { code: code, message: message || geoErrorMessage(code) });
    }

    function scheduleTick() {
      timer = setTimer(function () {
        timer = null;
        if (!running) return undefined;
        return tick();
      }, intervalMs);
    }

    function onFix(pos) {
      if (!running) return;
      var c = (pos && pos.coords) || {};
      latestFix = {
        lat: c.latitude,
        lng: c.longitude,
        accuracyM: (typeof c.accuracy === 'number' ? c.accuracy : null),
        timestamp: (pos && pos.timestamp) || now()
      };
      setState({ lastFix: latestFix });
    }

    function tick() {
      return captureFromFix(latestFix).then(function () {
        if (running) scheduleTick();
      });
    }

    function captureFromFix(fix) {
      if (!fix) { skip('noGps'); return Promise.resolve(null); }
      var age = now() - fix.timestamp;
      if (!(age <= 2 * intervalMs)) { skip('timeout'); return Promise.resolve(null); }
      if (!(typeof fix.accuracyM === 'number' && isFinite(fix.accuracyM)) || fix.accuracyM > maxAccuracyM) {
        skip('lowAccuracy'); return Promise.resolve(null);
      }

      var key = fix.lat + ',' + fix.lng;
      if (lastFixKey === key) {
        identicalCount++;
      } else {
        lastFixKey = key;
        identicalCount = 1;
      }
      if (identicalCount >= 3 && !warnedNotUpdating) {
        warnedNotUpdating = true;
        emit('error', { code: 'LOCATION_NOT_UPDATING', message: 'Location has not changed across several fixes; the device may be reporting a cached position.' });
      }

      if (lastAccepted) {
        var moved = haversineM(lastAccepted.lat, lastAccepted.lng, fix.lat, fix.lng);
        if (!(moved >= minMoveM)) { skip('duplicate'); return Promise.resolve(null); }
      }

      return Promise.resolve()
        .then(function () { return fetchSignal(); })
        .catch(function () { return null; })
        .then(function (sig) {
          if (!sig || !sig.ok || !sig.connected || !isValidSignalPct(sig.signalPct)) {
            skip('noSignal');
            return null;
          }
          var raw = {
            lat: fix.lat,
            lng: fix.lng,
            signalPct: sig.signalPct,
            ssid: sig.ssid != null ? sig.ssid : null,
            bssid: sig.bssid != null ? sig.bssid : null,
            band: sig.band != null ? sig.band : null,
            channel: sig.channel != null ? sig.channel : null,
            gpsAccuracyM: fix.accuracyM,
            locationSource: 'browser-geolocation',
            measurementMode: 'live-signal',
            signalSource: 'netsh-wlan',
            sessionId: sessionId,
            sessionName: sessionName,
            timestamp: new Date(fix.timestamp).toISOString(),
            rssiDbm: null,
            distanceM: null,
            ping: null,
            jitter: null,
            packetLoss: null,
            download: null,
            upload: null,
            notes: ''
          };
          var v = validate ? validate(raw, {}) : { ok: true, clean: raw, errors: [] };
          if (!v.ok) {
            emit('error', { code: 'INVALID_POINT', message: (v.errors || []).join('; ') });
            skip('invalid');
            return null;
          }
          var point = {};
          for (var k in v.clean) { if (Object.prototype.hasOwnProperty.call(v.clean, k)) point[k] = v.clean[k]; }
          point.id = uid();
          points.push(point);
          lastAccepted = { lat: fix.lat, lng: fix.lng };
          setState({ pointCount: points.length, lastSkipReason: null });
          emit('point', point);
          return point;
        });
    }

    function start() {
      if (running) return; // no-op while running
      running = true;
      warnedNotUpdating = false;
      identicalCount = 0;
      lastFixKey = null;
      lastAccepted = null;
      latestFix = null;
      setState({ status: 'running', errorCode: null, message: null, startedAt: now(), lastSkipReason: null });

      if (!geolocation || typeof geolocation.watchPosition !== 'function') {
        fail('UNSUPPORTED', geoErrorMessage('UNSUPPORTED'));
        return;
      }
      try {
        watchId = geolocation.watchPosition(onFix, function (err) {
          if (!running) return;
          var code = geoErrorCode(err);
          fail(code, geoErrorMessage(code));
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: intervalMs * 2 });
      } catch (e) {
        fail('POSITION_UNAVAILABLE', geoErrorMessage('POSITION_UNAVAILABLE'));
        return;
      }
      scheduleTick();
    }

    function stop() {
      running = false;
      if (timer != null) { clearTimer(timer); timer = null; }
      if (watchId != null && geolocation && typeof geolocation.clearWatch === 'function') {
        try { geolocation.clearWatch(watchId); } catch (e) { /* ignore */ }
      }
      watchId = null;
      setState({ status: 'stopped' });
    }

    function captureNow() {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        skip('noGps');
        return Promise.resolve(null);
      }
      return acquirePosition(geolocation, { maximumAge: 0, now: now })
        .then(function (fix) {
          latestFix = fix;
          setState({ lastFix: fix });
          return captureFromFix(fix);
        })
        .catch(function (err) {
          var code = geoErrorCode(err);
          fail(code, geoErrorMessage(code));
          return null;
        });
    }

    function getPoints() { return points.slice(); }
    function discard() {
      points = [];
      lastAccepted = null;
      setState({ pointCount: 0 });
    }

    return {
      start: start,
      stop: stop,
      captureNow: captureNow,
      getState: getState,
      getPoints: getPoints,
      discard: discard,
      on: on,
      off: off
    };
  }

  return {
    create: create,
    acquirePosition: acquirePosition,
    saveSession: saveSession,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
    DEFAULT_MAX_ACCURACY_M: DEFAULT_MAX_ACCURACY_M,
    DEFAULT_MIN_MOVE_M: DEFAULT_MIN_MOVE_M
  };
}));
