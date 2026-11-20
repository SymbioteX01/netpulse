/**
 * Script to apply Phase 2 geo map wiring changes to survey.js.
 * Applies targeted in-place modifications without breaking existing logic.
 */
'use strict';
const fs = require('fs');

let src = fs.readFileSync('js/survey.js', 'utf8');

// ── 1. Guard renderMap() – canvas may be inside collapsed <details> ──────────
src = src.replace(
  `  function renderMap() {
    const canvas = $('surveyMapCanvas');
    const ctx = canvas.getContext('2d');`,
  `  function renderMap() {
    const canvas = $('surveyMapCanvas');
    if (!canvas) return; // guarded: canvas lives inside collapsed indoor section
    const ctx = canvas.getContext('2d');`
);

// ── 2. Guard renderHeatmap() ─────────────────────────────────────────────────
src = src.replace(
  `  function renderHeatmap() {
    const canvas = $('surveyHeatCanvas');
    const ctx = canvas.getContext('2d');`,
  `  function renderHeatmap() {
    const canvas = $('surveyHeatCanvas');
    if (!canvas) return; // guarded
    const ctx = canvas.getContext('2d');`
);

// ── 3. Replace surveyHeatCanvas.toDataURL() in generateReport() ─────────────
src = src.replace(
  `      let heatImg = '';\n      try { heatImg = $('surveyHeatCanvas').toDataURL('image/png'); } catch (e) { heatImg = ''; }`,
  `      let heatImg = '';
      // Prefer NPMap geo heat overlay (no basemap, no cross-origin taint).
      // Fall back to the indoor canvas toDataURL if the element exists.
      try {
        if (typeof window.NPMap !== 'undefined' && window.NPMap.snapshotHeatOverlay) {
          heatImg = window.NPMap.snapshotHeatOverlay() || '';
        }
        if (!heatImg) {
          const heatCv = $('surveyHeatCanvas');
          if (heatCv) heatImg = heatCv.toDataURL('image/png');
        }
      } catch (e) { heatImg = ''; }`
);

// ── 4. In loadSurveys(), feed NPMap after renderMap/renderHeatmap ────────────
src = src.replace(
  `    surveys = (r.surveys || []).filter(s => s && s.id);
    selected = new Set(Array.from(selected).filter(id => surveys.some(s => s.id === id)));
    renderHistory();
    renderMap();
    renderHeatmap();
    renderTimeline();
    renderCompare();
    renderStats();`,
  `    surveys = (r.surveys || []).filter(s => s && s.id);
    selected = new Set(Array.from(selected).filter(id => surveys.some(s => s.id === id)));
    renderHistory();
    renderMap();
    renderHeatmap();
    renderTimeline();
    renderCompare();
    renderStats();
    // Feed the geographic map with partitioned data
    feedGeoMap();
    // Update session selector
    updateSessionSelector();`
);

// ── 5. Guard bind() canvas event listeners ───────────────────────────────────
// Guard surveyMapCanvas mousemove/mouseleave
src = src.replace(
  `    const mapCanvas = $('surveyMapCanvas');
    mapCanvas.addEventListener('mousemove', (ev) => {`,
  `    const mapCanvas = $('surveyMapCanvas');
    if (mapCanvas) mapCanvas.addEventListener('mousemove', (ev) => {`
);
// Fix closing brace of the mousemove listener
src = src.replace(
  `    });\n    mapCanvas.addEventListener('mouseleave', () => { $('mapPopup').style.display = 'none'; });\n    $('floorPlanInput').addEventListener`,
  `    });\n    if (mapCanvas) mapCanvas.addEventListener('mouseleave', () => { const pop = $('mapPopup'); if (pop) pop.style.display = 'none'; });\n    const floorInput = $('floorPlanInput'); if (floorInput) floorInput.addEventListener`
);
// Guard floorPlanInput change handler closing
src = src.replace(
  `    });\n    $('btnFloorClear').addEventListener('click', () => {\n      floorPlanImg = null;\n      $('floorPlanInput').value = '';`,
  `    });\n    const btnFloorClear = $('btnFloorClear'); if (btnFloorClear) btnFloorClear.addEventListener('click', () => {\n      floorPlanImg = null;\n      const fp = $('floorPlanInput'); if (fp) fp.value = '';`
);

// ── 6. Add geo map functions and initGeoMap() call before bind() ─────────────
const GEO_MAP_CODE = `
  /* ----------------------------------------------------------------
   * Geographic map (NPMap) integration — Phase 2
   * ---------------------------------------------------------------- */
  let liveController = null;
  let livePoints = [];
  let _currentSessionFilter = 'all';

  function esc2(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function feedGeoMap() {
    if (typeof window.NPMap === 'undefined') return;
    const geo = typeof window.NPGeo !== 'undefined' ? window.NPGeo : null;
    if (!geo) {
      // No NPGeo: pass raw surveys directly, map.js validates internally
      const pts = surveys.filter(s => isNum(s.lat) && isNum(s.lng)).map(s => Object.assign({}, s));
      window.NPMap.setPoints(pts);
      updateGeoMapPointCount(pts.length);
      return;
    }
    // Partition through NPGeo
    const list = _currentSessionFilter === 'all'
      ? surveys
      : surveys.filter(s => {
          if (_currentSessionFilter.startsWith('session:')) {
            return s.sessionId && ('session:' + s.sessionId) === _currentSessionFilter;
          }
          if (_currentSessionFilter.startsWith('legacy:')) {
            const dk = _currentSessionFilter.replace('legacy:', '');
            const d = new Date(s.timestamp);
            if (isNaN(d)) return false;
            const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            return key === dk;
          }
          return true;
        });

    const part = geo.partitionSurveys(list);
    window.NPMap.setPoints(part.plottable);
    updateGeoMapPointCount(part.plottable.length);
    renderUnplottable(part.unplottable);
  }

  function updateGeoMapPointCount(n) {
    const el = $('geoMapPointCount');
    if (el) el.textContent = n + ' point' + (n === 1 ? '' : 's');
  }

  function renderUnplottable(list) {
    const det = $('geoUnplottableDetails');
    const cnt = $('geoUnplottableCount');
    const ul  = $('geoUnplottableList');
    if (!det || !cnt || !ul) return;
    if (!list || !list.length) { det.style.display = 'none'; return; }
    det.style.display = '';
    cnt.textContent = String(list.length);
    ul.innerHTML = list.map(function(item) {
      const name = esc2((item.survey && item.survey.locationName) || (item.survey && item.survey.id) || '(unnamed)');
      const reason = esc2(item.reason || 'unknown');
      return '<li>' + name + '<span class="reason-badge">' + reason + '</span></li>';
    }).join('');
  }

  function updateSessionSelector() {
    const sel = $('geoSessionSelect');
    if (!sel) return;
    const geo = typeof window.NPGeo !== 'undefined' ? window.NPGeo : null;
    if (!geo) return;
    const groups = geo.groupIntoSessions(surveys);
    // Keep 'all' option first
    while (sel.options.length > 1) sel.remove(1);
    groups.forEach(function(g) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.sessionName + ' (' + g.pointCount + ')';
      sel.appendChild(opt);
    });
  }

  function updateGeoSurveyStatus(text) {
    const el = $('geoSurveyStatus');
    if (el) el.textContent = text || 'Idle';
  }

  function setGeoSaveBar(visible, n) {
    const bar = $('geoSaveBar');
    const btn = $('geoSaveSession');
    if (!bar) return;
    bar.style.display = visible ? '' : 'none';
    if (btn) {
      btn.textContent = 'Save ' + (n || 0) + ' point' + (n === 1 ? '' : 's');
      btn.disabled = !(n > 0);
    }
  }

  function initGeoMap() {
    const container = $('geoMap');
    if (!container) return;
    if (typeof window.NPMap === 'undefined') return;

    const bannerEl = $('geoTileBanner');
    const consentEl = $('geoConsentState');
    const emptyEl = $('geoEmptyState');

    // Override bannerEl show/hide to use display
    const wrappedBanner = bannerEl ? {
      get textContent() { return bannerEl.textContent; },
      set textContent(v) {
        bannerEl.textContent = v;
        bannerEl.style.display = v ? '' : 'none';
      },
      style: bannerEl.style
    } : null;

    window.NPMap.init(container, {
      bannerEl: wrappedBanner,
      emptyEl: emptyEl,
      consentEl: consentEl,
      onConsentAccept: function() {
        // After consent, feed existing points
        feedGeoMap();
      }
    });

    // Show empty state if no points and consent given
    const status = window.NPMap.getStatus();
    if (status.hasConsent && emptyEl) {
      emptyEl.style.display = surveys.length === 0 ? '' : 'none';
    }

    // Session selector
    const sessEl = $('geoSessionSelect');
    if (sessEl) {
      sessEl.addEventListener('change', function() {
        _currentSessionFilter = sessEl.value;
        feedGeoMap();
      });
    }

    // Marker toggle
    const mTog = $('geoToggleMarkers');
    if (mTog) {
      mTog.addEventListener('change', function() {
        window.NPMap.setVisibility({ markers: mTog.checked });
      });
    }

    // Heat toggle
    const hTog = $('geoToggleHeat');
    if (hTog) {
      hTog.addEventListener('change', function() {
        window.NPMap.setVisibility({ heat: hTog.checked });
      });
    }

    // Radius slider
    const slider = $('geoRadiusSlider');
    const radVal = $('geoRadiusVal');
    if (slider) {
      slider.addEventListener('input', function() {
        const v = parseInt(slider.value, 10);
        if (radVal) radVal.textContent = v + ' m';
        window.NPMap.setRadius(v);
      });
    }

    // Use my location button
    const locBtn = $('geoUseLocation');
    const locStatus = $('geoLocationStatus');
    if (locBtn) {
      locBtn.addEventListener('click', function() {
        if (locStatus) locStatus.textContent = 'Requesting position…';
        locBtn.disabled = true;
        const live = typeof window.NPLive !== 'undefined' ? window.NPLive : null;
        if (live && navigator.geolocation) {
          live.acquirePosition(navigator.geolocation, { maximumAge: 0, timeout: 12000, enableHighAccuracy: true })
            .then(function(pos) {
              locBtn.disabled = false;
              if (pos.error || !isNum(pos.lat) || !isNum(pos.lng)) {
                if (locStatus) locStatus.textContent = 'Error: ' + (pos.error || 'position unavailable');
                return;
              }
              if (locStatus) locStatus.textContent = 'Accuracy: ' + (isNum(pos.accuracyM) ? pos.accuracyM.toFixed(0) + ' m' : 'unknown');
              window.NPMap.showUserLocation({ lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM });
              window.NPMap.flyTo(pos.lat, pos.lng, 16);
            })
            .catch(function(e) {
              locBtn.disabled = false;
              if (locStatus) locStatus.textContent = 'Error: ' + (e.message || 'position unavailable');
            });
        } else if (navigator.geolocation) {
          // Fallback without NPLive
          navigator.geolocation.getCurrentPosition(
            function(p) {
              locBtn.disabled = false;
              if (locStatus) locStatus.textContent = 'Accuracy: ' + (p.coords.accuracy ? p.coords.accuracy.toFixed(0) + ' m' : 'unknown');
              window.NPMap.showUserLocation({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy });
              window.NPMap.flyTo(p.coords.latitude, p.coords.longitude, 16);
            },
            function(err) {
              locBtn.disabled = false;
              if (locStatus) locStatus.textContent = 'Error: ' + (err.message || 'unavailable');
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
          );
        } else {
          locBtn.disabled = false;
          if (locStatus) locStatus.textContent = 'Geolocation not supported';
        }
      });
    }

    // Start/Stop survey
    const startBtn = $('geoStartSurvey');
    const stopBtn  = $('geoStopSurvey');
    if (startBtn && stopBtn) {
      startBtn.addEventListener('click', function() {
        const live = typeof window.NPLive !== 'undefined' ? window.NPLive : null;
        if (!live) { updateGeoSurveyStatus('NPLive not available'); return; }
        if (liveController) return; // already running

        const intervalMs = parseInt(($('geoIntervalSelect') || {}).value || '5000', 10);
        const maxAccM    = parseInt(($('geoAccuracySelect') || {}).value || '50', 10);

        livePoints = [];
        liveController = live.create({
          geolocation: navigator.geolocation || null,
          fetchSignal: function(opts) {
            return fetch('/api/wifi/signal').then(function(r) { return r.json(); }).catch(function() { return { ok: false }; });
          },
          api: api
        }, {
          intervalMs: intervalMs,
          maxAccuracyM: maxAccM,
          sessionName: 'Live Survey ' + new Date().toLocaleString()
        });

        liveController.on('state', function(state) {
          const s = liveController.getState ? liveController.getState() : state;
          const status = s ? s.status : (state && state.status ? state.status : 'running');
          const collected = (s && s.pointCount) || livePoints.length;
          const skips = s && s.lastSkipReason ? ' (skip: ' + s.lastSkipReason + ')' : '';
          updateGeoSurveyStatus(status + ' — ' + collected + ' collected' + skips);
        });

        liveController.on('point', function(p) {
          livePoints.push(p);
          window.NPMap.addPoint({
            lat: p.lat,
            lng: p.lng,
            signalPct: isNum(p.signalPct) ? p.signalPct : null,
            locationName: 'Live point ' + livePoints.length,
            locationSource: p.locationSource || 'browser-geolocation',
            accuracyM: p.accuracyM,
            measurementMode: 'live-signal',
            timestamp: p.timestamp || new Date().toISOString()
          });
          setGeoSaveBar(false, livePoints.length);
          updateGeoSurveyStatus('Running — ' + livePoints.length + ' collected');
        });

        liveController.on('skip', function(info) {
          updateGeoSurveyStatus('Skipped: ' + (info && info.reason ? info.reason : 'unknown'));
        });

        liveController.on('error', function(err) {
          updateGeoSurveyStatus('Error: ' + (err && (err.message || err.code) ? (err.message || err.code) : 'unknown'));
        });

        liveController.start();
        startBtn.disabled = true;
        stopBtn.disabled = false;
        setGeoSaveBar(false, 0);
        updateGeoSurveyStatus('Starting…');
      });

      stopBtn.addEventListener('click', function() {
        if (!liveController) return;
        liveController.stop();
        liveController = null;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        setGeoSaveBar(true, livePoints.length);
        updateGeoSurveyStatus('Stopped — ' + livePoints.length + ' points collected');
      });
    }

    // Save session
    const saveBtn = $('geoSaveSession');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        if (!livePoints.length) return;
        const saveStatus = $('geoSaveStatus');
        saveBtn.disabled = true;
        const live = typeof window.NPLive !== 'undefined' ? window.NPLive : null;
        if (!live || !live.saveSession) {
          if (saveStatus) saveStatus.textContent = 'NPLive.saveSession not available';
          saveBtn.disabled = false;
          return;
        }
        const meta = { sessionName: 'Live Survey ' + new Date().toLocaleString() };
        live.saveSession(livePoints, meta, api)
          .then(function(result) {
            if (result && result.ok) {
              if (saveStatus) saveStatus.textContent = 'Saved ' + (result.saved || livePoints.length) + ' points';
              livePoints = [];
              setGeoSaveBar(false, 0);
              return loadSurveys();
            } else {
              if (saveStatus) saveStatus.textContent = 'Save error: ' + ((result && result.error) || 'unknown');
              saveBtn.disabled = false;
            }
          })
          .catch(function(e) {
            if (saveStatus) saveStatus.textContent = 'Save error: ' + e.message;
            saveBtn.disabled = false;
          });
      });
    }

    // Discard session
    const discardBtn = $('geoDiscardSession');
    if (discardBtn) {
      discardBtn.addEventListener('click', function() {
        livePoints = [];
        setGeoSaveBar(false, 0);
        updateGeoSurveyStatus('Idle');
      });
    }

    // Warn before leaving with unsaved live points
    window.addEventListener('beforeunload', function(e) {
      if (livePoints.length > 0) {
        e.preventDefault();
        e.returnValue = 'You have ' + livePoints.length + ' unsaved live survey points. Leave anyway?';
      }
    });
  }

`;

// Insert GEO_MAP_CODE just before the bind() function
const BIND_MARKER = `  /* ---------------- events ---------------- */
  function bind() {`;
src = src.replace(BIND_MARKER, GEO_MAP_CODE + BIND_MARKER);

// ── 7. Call initGeoMap() at the bottom, after bind() and loadSurveys() ───────
src = src.replace(
  `  bind();\n  loadSurveys();\n})(window);`,
  `  bind();\n  initGeoMap();\n  loadSurveys();\n})(window);`
);

fs.writeFileSync('js/survey.js', src, 'utf8');
console.log('survey.js patched. Size:', src.length, 'Lines:', src.split('\n').length);

// Syntax check
const { execSync } = require('child_process');
try {
  execSync('node --check js/survey.js', { stdio: 'pipe' });
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.stderr.toString());
  process.exit(1);
}
