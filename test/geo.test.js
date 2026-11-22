'use strict';
/*
 * Unit tests for js/geo-core.js (window.NPGeo / module.exports).
 *
 * This is the shared validation + classification core used by BOTH the server
 * and the browser, so these tests pin the frozen behaviour: coordinate
 * validity, the survey input validator, quality parity with js/survey.js,
 * point classification, session grouping, and the heatmap weighting.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const geo = require('../js/geo-core.js');
const ROOT = path.join(__dirname, '..');
const vm = require('node:vm');

test('geo-core and survey-live also expose their browser globals (UMD)', () => {
  const sandbox = { self: undefined };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'geo-core.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'survey-live.js'), 'utf8'), sandbox);
  assert.ok(sandbox.NPGeo && typeof sandbox.NPGeo.validateSurveyInput === 'function', 'window.NPGeo');
  assert.ok(typeof sandbox.NPGeo.classifyPoint === 'function');
  assert.ok(sandbox.NPLive && typeof sandbox.NPLive.create === 'function', 'window.NPLive');
  assert.ok(typeof sandbox.NPLive.saveSession === 'function');
});

test('isValidLatLng: type/range/null-island rules', () => {
  assert.strictEqual(geo.isValidLatLng(28.6139, 77.209), true);
  assert.strictEqual(geo.isValidLatLng(-90, 180), true);
  assert.strictEqual(geo.isValidLatLng(90, -180), true);
  assert.strictEqual(geo.isValidLatLng(0, 5), true);   // one zero is fine
  assert.strictEqual(geo.isValidLatLng(5, 0), true);

  assert.strictEqual(geo.isValidLatLng('18.6', 77), false, 'numeric strings are not coordinates');
  assert.strictEqual(geo.isValidLatLng(18.6, '77'), false);
  assert.strictEqual(geo.isValidLatLng(NaN, 77), false);
  assert.strictEqual(geo.isValidLatLng(91, 77), false, 'lat > 90');
  assert.strictEqual(geo.isValidLatLng(-91, 77), false);
  assert.strictEqual(geo.isValidLatLng(18, 181), false, 'lng > 180');
  assert.strictEqual(geo.isValidLatLng(18, -181), false);
  assert.strictEqual(geo.isValidLatLng(0, 0), false, 'null island is rejected');
  assert.strictEqual(geo.isValidLatLng(null, 5), false, 'one of two null');
  assert.strictEqual(geo.isValidLatLng(5, null), false);
  assert.strictEqual(geo.isValidLatLng(undefined, undefined), false);
});

test('isValidSignalPct: only finite numbers in 0..100', () => {
  assert.strictEqual(geo.isValidSignalPct(0), true);
  assert.strictEqual(geo.isValidSignalPct(100), true);
  assert.strictEqual(geo.isValidSignalPct(50.5), true);
  assert.strictEqual(geo.isValidSignalPct(101), false);
  assert.strictEqual(geo.isValidSignalPct(-1), false);
  assert.strictEqual(geo.isValidSignalPct(NaN), false);
  assert.strictEqual(geo.isValidSignalPct('50'), false);
  assert.strictEqual(geo.isValidSignalPct(null), false);
  assert.strictEqual(geo.isValidSignalPct(undefined), false);
});

test('qualityOf matches js/survey.js QUALITY exactly (parity)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'survey.js'), 'utf8');
  const map = {};
  const re = /\{\s*key:\s*'([a-z]+)',\s*label:\s*'([^']+)',\s*color:\s*'(#[0-9a-fA-F]{6})'\s*\}/g;
  let m;
  while ((m = re.exec(src))) map[m[1]] = { label: m[2], color: m[3] };
  for (const k of ['excellent', 'good', 'fair', 'poor', 'na']) {
    assert.ok(map[k], 'survey.js must define quality "' + k + '" (parsed: ' + Object.keys(map) + ')');
  }

  const cases = [
    [100, 'excellent'], [75, 'excellent'],
    [74.9, 'good'], [50, 'good'],
    [49.9, 'fair'], [25, 'fair'],
    [24.9, 'poor'], [0, 'poor']
  ];
  for (const [pct, key] of cases) {
    const q = geo.qualityOf(pct);
    assert.strictEqual(q.key, key, pct + '% -> ' + key);
    assert.strictEqual(q.label, map[key].label, pct + '% label')
      ;
    assert.strictEqual(q.color, map[key].color, pct + '% colour');
  }
  const na = geo.qualityOf(null);
  assert.strictEqual(na.key, 'na');
  assert.strictEqual(na.label, map.na.label);
  assert.strictEqual(na.color, map.na.color);
});

test('signalColor: continuous absolute scale + N/A grey', () => {
  assert.strictEqual(geo.signalColor(0), '#f87171');
  assert.strictEqual(geo.signalColor(25), '#fb923c');
  assert.strictEqual(geo.signalColor(50), '#fbbf24');
  assert.strictEqual(geo.signalColor(75), '#34d399');
  assert.strictEqual(geo.signalColor(100), '#34d399');
  assert.strictEqual(geo.signalColor(null), '#8b98a9');
  assert.strictEqual(geo.signalColor('x'), '#8b98a9');
  // Between anchors -> an interpolated hex, not one of the anchors.
  assert.match(geo.signalColor(12), /^#[0-9a-f]{6}$/);
});

test('classifyPoint: reasons and null-signal handling', () => {
  const noCoords = geo.classifyPoint({ lat: null, lng: null, signalPct: 80 });
  assert.strictEqual(noCoords.plottable, false);
  assert.strictEqual(noCoords.reason, 'no-coordinates');

  const undef = geo.classifyPoint({});
  assert.strictEqual(undef.reason, 'no-coordinates');

  assert.strictEqual(geo.classifyPoint({ lat: '18.6', lng: 77 }).reason, 'invalid-coordinates');
  assert.strictEqual(geo.classifyPoint({ lat: 91, lng: 77 }).reason, 'invalid-coordinates');
  assert.strictEqual(geo.classifyPoint({ lat: 18, lng: -181 }).reason, 'invalid-coordinates');
  assert.strictEqual(geo.classifyPoint({ lat: 0, lng: 0 }).reason, 'null-island');

  const ok = geo.classifyPoint({ lat: 28.6, lng: 77.2, signalPct: 80, gpsAccuracyM: 12, locationSource: 'browser-geolocation' });
  assert.strictEqual(ok.plottable, true);
  assert.strictEqual(ok.reason, null);
  assert.strictEqual(ok.hasSignal, true);
  assert.strictEqual(ok.signalPct, 80);
  assert.strictEqual(ok.qualityKey, 'excellent');
  assert.strictEqual(ok.accuracyM, 12);
  assert.strictEqual(ok.accuracyClass, 'good');
  assert.strictEqual(ok.locationSource, 'browser-geolocation');

  // A missing/None signal must NOT become 0.
  const noSig = geo.classifyPoint({ lat: 28.6, lng: 77.2, signalPct: null });
  assert.strictEqual(noSig.hasSignal, false);
  assert.strictEqual(noSig.signalPct, null);
  assert.strictEqual(noSig.qualityKey, 'na');
  assert.strictEqual(noSig.color, '#8b98a9');
  assert.notStrictEqual(noSig.signalPct, 0);

  const undefSig = geo.classifyPoint({ lat: 28.6, lng: 77.2 });
  assert.strictEqual(undefSig.signalPct, null);

  // accuracy buckets
  assert.strictEqual(geo.classifyPoint({ lat: 1, lng: 1, gpsAccuracyM: 20 }).accuracyClass, 'good');
  assert.strictEqual(geo.classifyPoint({ lat: 1, lng: 1, gpsAccuracyM: 50 }).accuracyClass, 'fair');
  assert.strictEqual(geo.classifyPoint({ lat: 1, lng: 1, gpsAccuracyM: 51 }).accuracyClass, 'poor');
  assert.strictEqual(geo.classifyPoint({ lat: 1, lng: 1 }).accuracyClass, 'unknown');
});

test('partitionSurveys splits plottable vs unplottable without dropping the survey', () => {
  const list = [
    { id: 'a', lat: 28.6, lng: 77.2, signalPct: 80 },
    { id: 'b', lat: null, lng: null, signalPct: 30 },
    { id: 'c', lat: 0, lng: 0, signalPct: 10 }
  ];
  const p = geo.partitionSurveys(list);
  assert.strictEqual(p.plottable.length, 1);
  assert.strictEqual(p.plottable[0].survey.id, 'a');
  assert.strictEqual(p.plottable[0].plottable, true);
  assert.strictEqual(p.unplottable.length, 2);
  assert.deepStrictEqual(p.unplottable.map(x => x.reason).sort(), ['no-coordinates', 'null-island']);
  assert.strictEqual(p.unplottable[0].survey.id, 'b');
});

test('groupIntoSessions: by sessionId and legacy by LOCAL date, input untouched', () => {
  const d1 = new Date(2026, 0, 5, 9, 0, 0);   // local 2026-01-05
  const d2 = new Date(2026, 0, 5, 11, 0, 0);  // local 2026-01-05
  const d3 = new Date(2026, 1, 1, 8, 0, 0);   // local 2026-02-01
  const list = [
    { id: 's1', sessionId: 'SES-A', sessionName: 'Floor 1', timestamp: d1.toISOString(), lat: 1, lng: 1 },
    { id: 's2', sessionId: 'SES-A', sessionName: 'Floor 1', timestamp: d2.toISOString(), lat: 1.001, lng: 1.001 },
    { id: 'l1', timestamp: d1.toISOString(), lat: 2, lng: 2 },
    { id: 'l2', timestamp: d2.toISOString(), lat: 2.001, lng: 2.001 },
    { id: 'l3', timestamp: d3.toISOString(), lat: 3, lng: 3 }
  ];
  const snapshot = JSON.parse(JSON.stringify(list));

  const sessions = geo.groupIntoSessions(list);
  const byId = {};
  sessions.forEach(s => { byId[s.id] = s; });

  assert.ok(byId['session:SES-A'], 'sessionId group');
  assert.strictEqual(byId['session:SES-A'].points.length, 2);
  assert.strictEqual(byId['session:SES-A'].sessionName, 'Floor 1');

  assert.ok(byId['legacy:2026-01-05'], 'legacy group for local date');
  assert.strictEqual(byId['legacy:2026-01-05'].points.length, 2);
  assert.strictEqual(byId['legacy:2026-01-05'].sessionId, null);
  assert.ok(byId['legacy:2026-02-01']);
  assert.strictEqual(byId['legacy:2026-02-01'].points.length, 1);

  // The input must be byte-for-byte unchanged (no sorting, no injected fields).
  assert.deepStrictEqual(list, snapshot, 'groupIntoSessions must never mutate its input');
});

test('haversineM: known distance', () => {
  // ~0.001 degrees of longitude at the equator is ~111.3 m.
  const d = geo.haversineM(1, 1, 1, 1.001);
  assert.ok(d > 110 && d < 113, 'expected ~111 m, got ' + d);
  assert.strictEqual(geo.haversineM(1, 1, 1, 1), 0);
});

test('heatValueAt: Gaussian weighted mean, absolute scale, zero confidence far away', () => {
  const center = { lat: 1, lng: 1 };
  // Three samples exactly at the centre -> plain mean, corroborated.
  const same = geo.heatValueAt([
    { lat: 1, lng: 1, signalPct: 20 },
    { lat: 1, lng: 1, signalPct: 40 },
    { lat: 1, lng: 1, signalPct: 60 }
  ], center, { radiusM: 50 });
  assert.ok(Math.abs(same.value - 40) < 1e-6, 'weighted mean of 20/40/60 = 40, got ' + same.value);
  assert.ok(same.confidence > 0.9, 'confidence should be high with 3 samples');

  // A weak cluster can never look strong.
  const weak = geo.heatValueAt([
    { lat: 1, lng: 1, signalPct: 10 },
    { lat: 1.0001, lng: 1, signalPct: 20 }
  ], center, { radiusM: 50 });
  assert.ok(weak.value <= 20.0001, 'weak cluster must not be boosted, got ' + weak.value);

  // Far from any sample -> null value, zero confidence.
  const far = geo.heatValueAt([
    { lat: 5, lng: 5, signalPct: 90 }
  ], { lat: 1, lng: 1 }, { radiusM: 10 });
  assert.strictEqual(far.value, null);
  assert.strictEqual(far.confidence, 0);

  // No samples at all.
  assert.deepStrictEqual(geo.heatValueAt([], center, { radiusM: 10 }), { value: null, confidence: 0 });

  // Samples without a valid signal are ignored (null is not 0).
  const noSignal = geo.heatValueAt([{ lat: 1, lng: 1, signalPct: null }], center, { radiusM: 50 });
  assert.strictEqual(noSignal.value, null);
});

test('validateSurveyInput: full-object rules', () => {
  const good = geo.validateSurveyInput({
    lat: 28.6, lng: 77.2, signalPct: 70, gpsAccuracyM: 12,
    locationSource: 'browser-geolocation', timestamp: '2026-01-01T00:00:00.000Z',
    customLegacyField: 'kept'
  }, {});
  assert.strictEqual(good.ok, true, good.errors.join('; '));
  assert.strictEqual(good.clean.lat, 28.6);
  assert.strictEqual(good.clean.customLegacyField, 'kept', 'unknown legacy fields are kept');

  // lat and lng together, or both null.
  assert.strictEqual(geo.validateSurveyInput({ lat: 28.6 }, {}).ok, false, 'lat without lng');
  assert.strictEqual(geo.validateSurveyInput({ lat: '28.6', lng: '77' }, {}).ok, false, 'string coords');
  assert.strictEqual(geo.validateSurveyInput({ lat: 0, lng: 0 }, {}).ok, false, 'null island');
  const bothNull = geo.validateSurveyInput({ lat: null, lng: null }, {});
  assert.strictEqual(bothNull.ok, true);
  assert.strictEqual(bothNull.clean.lat, null);
  assert.strictEqual(bothNull.clean.lng, null);

  // signalPct
  assert.strictEqual(geo.validateSurveyInput({ signalPct: 150 }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ signalPct: '70' }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ signalPct: null }, {}).ok, true);

  // gpsAccuracyM
  assert.strictEqual(geo.validateSurveyInput({ gpsAccuracyM: -1 }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ gpsAccuracyM: '5' }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ gpsAccuracyM: 0 }, {}).ok, true);

  // locationSource
  assert.strictEqual(geo.validateSurveyInput({ locationSource: 'gps' }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ locationSource: 'manual-map' }, {}).ok, true);
  assert.strictEqual(geo.validateSurveyInput({ locationSource: null }, {}).ok, true);

  // timestamp
  assert.strictEqual(geo.validateSurveyInput({ timestamp: 'not-a-date' }, {}).ok, false);
  assert.strictEqual(geo.validateSurveyInput({ timestamp: '2026-01-01T00:00:00Z' }, {}).ok, true);
});

test('validateSurveyInput: partial patches only touch supplied fields', () => {
  const patch = geo.validateSurveyInput({ locationName: 'Lobby' }, { partial: true });
  assert.strictEqual(patch.ok, true);
  assert.strictEqual(patch.clean.locationName, 'Lobby');
  assert.ok(!('lat' in patch.clean) && !('lng' in patch.clean), 'untouched coords must be absent');

  const clear = geo.validateSurveyInput({ lat: null, lng: null }, { partial: true });
  assert.strictEqual(clear.ok, true);
  assert.strictEqual(clear.clean.lat, null);
  assert.strictEqual(clear.clean.lng, null);

  assert.strictEqual(geo.validateSurveyInput({ lat: 5 }, { partial: true }).ok, false, 'half a coordinate');
  assert.strictEqual(geo.validateSurveyInput({ signalPct: 200 }, { partial: true }).ok, false);
});
