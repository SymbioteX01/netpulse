/*!
 * NetPulse geo / point-classification core (UMD).
 *
 * Exposes window.NPGeo in the browser and module.exports in Node.
 * Dependency-free, DOM-free, no timers, no fetch, no Leaflet.
 *
 * This module is the SINGLE source of truth for survey point validation and
 * coordinate/signal classification. The server and the browser both call it,
 * so what validates on the client is exactly what validates on the wire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NPGeo = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LOCATION_SOURCES = ['browser-geolocation', 'manual-map', 'manual-entry'];

  // Quality palette. Thresholds, labels and colours MUST match js/survey.js
  // (QUALITY / NA). test/geo.test.js enforces parity against that file.
  var NA = { key: 'na', label: 'N/A', color: '#8b98a9' };
  var QUALITY = {
    excellent: { key: 'excellent', label: 'Excellent', color: '#34d399' },
    good: { key: 'good', label: 'Good', color: '#fbbf24' },
    fair: { key: 'fair', label: 'Fair', color: '#fb923c' },
    poor: { key: 'poor', label: 'Poor', color: '#f87171' }
  };

  // Continuous absolute colour anchors: 0% red, 25% orange, 50% yellow, 75%+ green.
  var ANCHORS = [
    { v: 0, c: [248, 113, 113] },  // #f87171
    { v: 25, c: [251, 146, 60] },  // #fb923c
    { v: 50, c: [251, 191, 36] },  // #fbbf24
    { v: 75, c: [52, 211, 153] }   // #34d399
  ];

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function isNullish(v) { return v === null || v === undefined || v === ''; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function rgbHex(c) {
    return '#' + c.map(function (x) {
      var h = Math.round(x).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  // A coordinate is valid only if BOTH parts are real numbers in range and it
  // is not the "null island" sentinel (exactly 0,0), which usually means
  // "unknown" rather than a real fix off the coast of Africa.
  function isValidLatLng(lat, lng) {
    if (!isFiniteNum(lat) || !isFiniteNum(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
  }

  function isValidSignalPct(v) {
    return isFiniteNum(v) && v >= 0 && v <= 100;
  }

  // Discrete bucket, identical to js/survey.js qualityOf().
  function qualityOf(pct) {
    var v = isValidSignalPct(pct) ? pct : -1;
    if (v >= 75) return QUALITY.excellent;
    if (v >= 50) return QUALITY.good;
    if (v >= 25) return QUALITY.fair;
    if (v < 0) return NA;
    return QUALITY.poor;
  }

  // Continuous absolute colour for a signal percentage. null / invalid -> N/A grey.
  function signalColor(pct) {
    if (!isValidSignalPct(pct)) return NA.color;
    var v = Math.max(0, Math.min(100, pct));
    if (v <= ANCHORS[0].v) return rgbHex(ANCHORS[0].c);
    if (v >= ANCHORS[ANCHORS.length - 1].v) return rgbHex(ANCHORS[ANCHORS.length - 1].c);
    for (var i = 0; i < ANCHORS.length - 1; i++) {
      var a = ANCHORS[i], b = ANCHORS[i + 1];
      if (v >= a.v && v <= b.v) {
        var t = (v - a.v) / (b.v - a.v);
        return rgbHex([0, 1, 2].map(function (k) { return a.c[k] + (b.c[k] - a.c[k]) * t; }));
      }
    }
    return rgbHex(ANCHORS[ANCHORS.length - 1].c);
  }

  // accuracy (metres) -> 'good' (<=20) | 'fair' (<=50) | 'poor' (>50) | 'unknown'.
  function accuracyClassOf(acc) {
    if (!isFiniteNum(acc)) return 'unknown';
    if (acc <= 20) return 'good';
    if (acc <= 50) return 'fair';
    return 'poor';
  }

  // Classification of a single survey point. Never throws on odd input.
  function classifyPoint(s) {
    s = (s && typeof s === 'object') ? s : {};
    var lat = s.lat, lng = s.lng;
    var plottable = false, reason = null;
    if (isNullish(lat) && isNullish(lng)) {
      reason = 'no-coordinates';
    } else if (!isFiniteNum(lat) || !isFiniteNum(lng) ||
               lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      reason = 'invalid-coordinates';
    } else if (lat === 0 && lng === 0) {
      reason = 'null-island';
    } else {
      plottable = true;
    }

    var hasSignal = isValidSignalPct(s.signalPct);
    var signalPct = hasSignal ? s.signalPct : null;
    var acc = isFiniteNum(s.gpsAccuracyM) ? s.gpsAccuracyM
      : (isFiniteNum(s.accuracy) ? s.accuracy : null);

    return {
      plottable: plottable,
      reason: reason,
      hasSignal: hasSignal,
      signalPct: signalPct,
      color: signalColor(signalPct),
      qualityKey: qualityOf(signalPct).key,
      accuracyM: acc,
      accuracyClass: accuracyClassOf(acc),
      locationSource: s.locationSource || null
    };
  }

  // Split a list into { plottable, unplottable }. Each entry is the original
  // survey plus its classification (under `survey` and as top-level fields).
  function partitionSurveys(list) {
    var arr = Array.isArray(list) ? list : [];
    var plottable = [], unplottable = [];
    for (var i = 0; i < arr.length; i++) {
      var c = classifyPoint(arr[i]);
      var item = {};
      for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) item[k] = c[k]; }
      item.survey = arr[i];
      (c.plottable ? plottable : unplottable).push(item);
    }
    return { plottable: plottable, unplottable: unplottable };
  }

  function localDateKey(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'unknown';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Group surveys into sessions. Records carrying a sessionId are grouped by it;
  // records without one are grouped by the LOCAL calendar date of their
  // timestamp under the id 'legacy:YYYY-MM-DD'. The input is never mutated.
  function groupIntoSessions(list) {
    var arr = Array.isArray(list) ? list : [];
    var map = {}, order = [];
    for (var i = 0; i < arr.length; i++) {
      var s = (arr[i] && typeof arr[i] === 'object') ? arr[i] : {};
      var sid = s.sessionId ? String(s.sessionId) : null;
      var id, name;
      if (sid) { id = 'session:' + sid; name = s.sessionName ? String(s.sessionName) : sid; }
      else { var dk = localDateKey(s.timestamp); id = 'legacy:' + dk; name = 'Legacy ' + dk; }
      if (!map[id]) {
        map[id] = { id: id, sessionId: sid, sessionName: name, points: [] };
        order.push(id);
      }
      map[id].points.push(s);
    }
    var out = order.map(function (id) {
      var g = map[id];
      var times = g.points.map(function (p) { return Date.parse(p.timestamp); })
        .filter(function (n) { return !isNaN(n); });
      g.startTs = times.length ? new Date(Math.min.apply(null, times)).toISOString() : null;
      g.endTs = times.length ? new Date(Math.max.apply(null, times)).toISOString() : null;
      g.pointCount = g.points.length;
      return g;
    });
    out.sort(function (a, b) {
      var av = a.endTs ? Date.parse(a.endTs) : -Infinity;
      var bv = b.endTs ? Date.parse(b.endTs) : -Infinity;
      return bv - av;
    });
    return out;
  }

  function toRad(d) { return d * Math.PI / 180; }

  // Great-circle distance in metres.
  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371008.8; // mean Earth radius (m)
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Gaussian-weighted MEAN of signalPct over valid samples within 2.5 * radiusM.
  // Returns { value, confidence }; value is null when no sample is in range.
  // confidence = 1 - exp(-sum(weights)) so it rises with corroboration at range.
  function heatValueAt(samples, center, opts) {
    opts = opts || {};
    var radiusM = isFiniteNum(opts.radiusM) && opts.radiusM > 0 ? opts.radiusM : 50;
    if (!center || !isValidLatLng(center.lat, center.lng)) return { value: null, confidence: 0 };
    var maxD = 2.5 * radiusM;
    var sigma = radiusM;
    var wsum = 0, vsum = 0;
    var arr = Array.isArray(samples) ? samples : [];
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i] || {};
      if (!isValidSignalPct(s.signalPct)) continue;
      if (!isValidLatLng(s.lat, s.lng)) continue;
      var d = haversineM(center.lat, center.lng, s.lat, s.lng);
      if (d > maxD) continue;
      var w = Math.exp(-(d * d) / (2 * sigma * sigma));
      wsum += w;
      vsum += w * s.signalPct;
    }
    if (wsum <= 0) return { value: null, confidence: 0 };
    return { value: vsum / wsum, confidence: 1 - Math.exp(-wsum) };
  }

  // Validate a survey patch/full object. Shared by the server and the client.
  // Returns { ok, errors[], clean }. Unknown legacy fields are carried through.
  function validateSurveyInput(obj, opts) {
    var partial = !!(opts && opts.partial);
    var errors = [];
    var clean = {};
    var input = (obj && typeof obj === 'object') ? obj : {};
    Object.keys(input).forEach(function (k) { clean[k] = input[k]; });
    var has = function (k) { return Object.prototype.hasOwnProperty.call(input, k); };

    if (!partial || has('lat') || has('lng')) {
      var lat = has('lat') ? input.lat : null;
      var lng = has('lng') ? input.lng : null;
      if (isNullish(lat) && isNullish(lng)) {
        clean.lat = null; clean.lng = null;
      } else if (isValidLatLng(lat, lng)) {
        clean.lat = lat; clean.lng = lng;
      } else {
        errors.push('lat/lng must both be valid coordinates, or both null');
      }
    }

    if (!partial || has('signalPct')) {
      var sp = has('signalPct') ? input.signalPct : null;
      if (isNullish(sp)) clean.signalPct = null;
      else if (isValidSignalPct(sp)) clean.signalPct = sp;
      else errors.push('signalPct must be a number between 0 and 100, or null');
    }

    if (!partial || has('gpsAccuracyM')) {
      var ac = has('gpsAccuracyM') ? input.gpsAccuracyM : null;
      if (isNullish(ac)) clean.gpsAccuracyM = null;
      else if (isFiniteNum(ac) && ac >= 0) clean.gpsAccuracyM = ac;
      else errors.push('gpsAccuracyM must be a finite number >= 0, or null');
    }

    if (!partial || has('locationSource')) {
      var ls = has('locationSource') ? input.locationSource : null;
      if (isNullish(ls)) clean.locationSource = null;
      else if (LOCATION_SOURCES.indexOf(ls) !== -1) clean.locationSource = ls;
      else errors.push('locationSource must be one of: ' + LOCATION_SOURCES.join(', ') + ', or null');
    }

    if (!partial || has('timestamp')) {
      var ts = has('timestamp') ? input.timestamp : null;
      if (isNullish(ts)) { if (has('timestamp')) clean.timestamp = null; }
      else if (typeof ts === 'string' && !isNaN(Date.parse(ts))) clean.timestamp = ts;
      else errors.push('timestamp must be a parseable ISO date string');
    }

    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  return {
    LOCATION_SOURCES: LOCATION_SOURCES,
    isValidLatLng: isValidLatLng,
    isValidSignalPct: isValidSignalPct,
    qualityOf: qualityOf,
    signalColor: signalColor,
    accuracyClassOf: accuracyClassOf,
    classifyPoint: classifyPoint,
    partitionSurveys: partitionSurveys,
    groupIntoSessions: groupIntoSessions,
    heatValueAt: heatValueAt,
    haversineM: haversineM,
    validateSurveyInput: validateSurveyInput
  };
}));
