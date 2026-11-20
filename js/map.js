/*!
 * NetPulse — Geographic Signal Map (UMD)
 * Exposes window.NPMap in the browser; module.exports in Node (for tests).
 *
 * Depends on: Leaflet (injected as L), window.NPGeo (geo-core.js).
 * No CDN, no inline scripts, no Leaflet.heat.
 * Tile layer: OpenStreetMap. Consent required before tile requests.
 * Heat layer: custom L.Layer drawing on a canvas in the overlay pane.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;   // Node: caller passes (L, document, NPGeo)
  } else {
    root.NPMap = factory(root.L, root.document, root.NPGeo);
  }
}(typeof self !== 'undefined' ? self : this, function (L, doc, NPGeo) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
  var MAX_ZOOM = 19;
  var CONSENT_KEY = 'npa-map-consent';
  var DEFAULT_RADIUS_M = 25;
  var TILE_ERROR_THRESHOLD = 5;
  var HEAT_CELL_PX = 7;   // coarse grid cell size in pixels

  /* ------------------------------------------------------------------ */
  /* Module-level state (singleton map instance)                         */
  /* ------------------------------------------------------------------ */
  var _map = null;          // Leaflet map instance
  var _container = null;    // container element used for the current map
  var _tileLayer = null;
  var _markerLayer = null;  // L.LayerGroup for circleMarkers
  var _heatCanvas = null;   // <canvas> element in overlay pane
  var _heatCtx = null;
  var _heatLayer = null;    // custom L.Layer instance
  var _userMarker = null;   // blue dot for "use my location"
  var _placementActive = false;
  var _placementCb = null;
  var _resizeObserver = null;
  var _rafPending = false;

  var _points = [];         // current plottable points
  var _visibility = { markers: true, heat: true };
  var _radiusM = DEFAULT_RADIUS_M;
  var _tileErrorCount = 0;
  var _tilesState = 'none'; // 'none' | 'loading' | 'ok' | 'error'
  var _consentGiven = false;
  var _bannerEl = null;
  var _emptyEl = null;
  var _consentEl = null;
  var _droppedCount = 0;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function safeNPGeo() {
    // Allow injection for tests via module.exports(L, doc, NPGeo) pattern
    return NPGeo || (typeof window !== 'undefined' && window.NPGeo) || null;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function hasConsent() {
    try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch (e) { return false; }
  }

  function grantConsent() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) {}
    _consentGiven = true;
  }

  /* ------------------------------------------------------------------ */
  /* Validate a point through NPGeo; return {ok, reason}                */
  /* ------------------------------------------------------------------ */
  function validatePoint(p) {
    var geo = safeNPGeo();
    if (!geo) return { ok: true }; // no NPGeo available (tests without it)
    if (!geo.isValidLatLng(p.lat, p.lng)) {
      return { ok: false, reason: 'invalid-coordinates' };
    }
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */
  function byId(id) { return doc && doc.getElementById(id); }

  function showBanner(msg) {
    if (_bannerEl) {
      _bannerEl.textContent = msg;
      _bannerEl.style.display = msg ? '' : 'none';
    }
  }

  function clearBanner() { showBanner(''); }

  /* ------------------------------------------------------------------ */
  /* Heat layer (custom L.Layer)                                         */
  /* ------------------------------------------------------------------ */
  function createHeatLayer() {
    if (!L) return null;

    var HeatLayer = L.Layer.extend({
      onAdd: function (map) {
        var pane = map.getPane('overlayPane');
        _heatCanvas = doc.createElement('canvas');
        _heatCanvas.style.position = 'absolute';
        _heatCanvas.style.top = '0';
        _heatCanvas.style.left = '0';
        _heatCanvas.style.pointerEvents = 'none';
        _heatCanvas.style.zIndex = '200';
        pane.appendChild(_heatCanvas);
        _heatCtx = _heatCanvas.getContext('2d');

        map.on('zoomend moveend resize', scheduleRedraw, this);
        scheduleRedraw();
      },

      onRemove: function (map) {
        map.off('zoomend moveend resize', scheduleRedraw, this);
        if (_heatCanvas && _heatCanvas.parentNode) {
          _heatCanvas.parentNode.removeChild(_heatCanvas);
        }
        _heatCanvas = null;
        _heatCtx = null;
      },

      redraw: redrawHeat
    });

    return new HeatLayer();
  }

  function scheduleRedraw() {
    if (_rafPending) return;
    _rafPending = true;
    var raf = (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame : function (fn) { setTimeout(fn, 16); };
    raf(function () {
      _rafPending = false;
      redrawHeat();
    });
  }

  function redrawHeat() {
    if (!_map || !_heatCanvas || !_heatCtx || !_visibility.heat) {
      if (_heatCanvas) {
        _heatCanvas.width = 0;
        _heatCanvas.height = 0;
      }
      return;
    }

    var size = _map.getSize();
    var W = size.x;
    var H = size.y;
    if (W <= 0 || H <= 0) return;

    // Resize canvas to match map viewport
    _heatCanvas.width = W;
    _heatCanvas.height = H;

    // Position canvas over the map
    var mapOffset = _map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(_heatCanvas, mapOffset);

    var geo = safeNPGeo();

    // Points that have a valid signal for heat
    var heatPts = _points.filter(function (p) {
      return geo ? geo.isValidSignalPct(p.signalPct) : isNum(p.signalPct) && p.signalPct >= 0 && p.signalPct <= 100;
    });

    if (!heatPts.length) {
      _heatCtx.clearRect(0, 0, W, H);
      return;
    }

    var imgData = _heatCtx.createImageData(W, H);
    var data = imgData.data;

    // Coarse grid: compute heat value at each cell center, then fill cell
    var cellW = HEAT_CELL_PX;
    var cellH = HEAT_CELL_PX;
    var cols = Math.ceil(W / cellW);
    var rows = Math.ceil(H / cellH);

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var cx = col * cellW + cellW / 2;
        var cy = row * cellH + cellH / 2;

        // Convert container point -> latlng
        var latlng;
        try {
          latlng = _map.containerPointToLatLng([cx, cy]);
        } catch (e) { continue; }

        var center = { lat: latlng.lat, lng: latlng.lng };
        var result;
        if (geo) {
          result = geo.heatValueAt(heatPts, center, { radiusM: _radiusM });
        } else {
          result = fallbackHeatValueAt(heatPts, center, _radiusM);
        }

        if (result.value === null || result.confidence <= 0) continue;

        // Color by absolute signal scale; alpha by confidence
        var color = geo ? geo.signalColor(result.value) : fallbackSignalColor(result.value);
        var rgb = hexToRgb(color);
        if (!rgb) continue;
        var alpha = Math.round(Math.min(1, result.confidence) * 200); // max alpha 200/255

        // Fill the cell pixels
        var x0 = col * cellW;
        var x1 = Math.min(W - 1, x0 + cellW - 1);
        var y0 = row * cellH;
        var y1 = Math.min(H - 1, y0 + cellH - 1);
        for (var py = y0; py <= y1; py++) {
          for (var px = x0; px <= x1; px++) {
            var idx = (py * W + px) * 4;
            data[idx]     = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = alpha;
          }
        }
      }
    }

    _heatCtx.putImageData(imgData, 0, 0);
  }

  function hexToRgb(hex) {
    if (!hex || hex.length < 7) return null;
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }

  // Fallbacks when NPGeo not available (tests)
  function fallbackSignalColor(pct) {
    if (!isNum(pct)) return '#8b98a9';
    if (pct >= 75) return '#34d399';
    if (pct >= 50) return '#fbbf24';
    if (pct >= 25) return '#fb923c';
    return '#f87171';
  }

  function fallbackHeatValueAt(samples, center, radiusM) {
    var sigma = radiusM;
    var maxD = 2.5 * radiusM;
    var wsum = 0, vsum = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!isNum(s.signalPct)) continue;
      var dlat = (center.lat - s.lat) * 111320;
      var dlng = (center.lng - s.lng) * 111320 * Math.cos(center.lat * Math.PI / 180);
      var d = Math.sqrt(dlat * dlat + dlng * dlng);
      if (d > maxD) continue;
      var w = Math.exp(-(d * d) / (2 * sigma * sigma));
      wsum += w;
      vsum += w * s.signalPct;
    }
    if (wsum <= 0) return { value: null, confidence: 0 };
    return { value: vsum / wsum, confidence: 1 - Math.exp(-wsum) };
  }

  /* ------------------------------------------------------------------ */
  /* Tile error banner                                                   */
  /* ------------------------------------------------------------------ */
  function onTileLoad() {
    _tileErrorCount = 0;
    _tilesState = 'ok';
    clearBanner();
  }

  function onTileError() {
    _tileErrorCount++;
    _tilesState = 'error';
    if (_tileErrorCount >= TILE_ERROR_THRESHOLD) {
      showBanner('Map tiles unavailable (offline or blocked) — points and heat still render on blank background');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Marker creation                                                     */
  /* ------------------------------------------------------------------ */
  function makePopupHtml(s) {
    var geo = safeNPGeo();
    var q = geo ? geo.qualityOf(s.signalPct) : { label: s.signalPct != null ? String(s.signalPct) + '%' : 'N/A' };
    var color = geo ? geo.signalColor(s.signalPct) : '#8b98a9';
    var rows = [
      ['Location', escHtml(s.locationName || s.survey && s.survey.locationName || '—')],
      ['Signal', isNum(s.signalPct) ? escHtml(String(s.signalPct)) + '%' : '—'],
      ['Quality', '<span style="color:' + escHtml(color) + '">' + escHtml(q.label) + '</span>'],
      ['SSID', escHtml(s.ssid || s.survey && s.survey.ssid || '—')],
      ['BSSID', escHtml(s.bssid || s.survey && s.survey.bssid || '—')],
      ['Band / Channel', escHtml((s.band || s.survey && s.survey.band || '—') + ' / ' + (s.channel || s.survey && s.survey.channel || '—'))],
      ['RSSI (estimated)', isNum(s.rssiDbm || s.survey && s.survey.rssiDbm) ? escHtml(String(s.rssiDbm || s.survey.rssiDbm)) + ' dBm' : '—'],
      ['Download / Upload', (isNum(s.download || s.survey && s.survey.download) ? String(s.download || s.survey.download) + ' / ' + String(s.upload || s.survey && s.survey.upload) + ' Mbps' : '—')],
      ['Ping', isNum(s.ping || s.survey && s.survey.ping) ? escHtml(String(s.ping || s.survey.ping)) + ' ms' : '—'],
      ['Coordinates', escHtml(String(s.lat) + ', ' + String(s.lng))],
      ['Accuracy', isNum(s.accuracyM) ? escHtml(String(s.accuracyM)) + ' m' : (s.locationSource ? 'not recorded (legacy)' : 'not recorded')],
      ['Location source', escHtml(s.locationSource || s.survey && s.survey.locationSource || 'legacy')],
      ['Timestamp', escHtml(s.survey && s.survey.timestamp ? new Date(s.survey.timestamp).toLocaleString() : (s.timestamp ? new Date(s.timestamp).toLocaleString() : '—'))],
      ['Mode', escHtml(s.measurementMode || s.survey && s.survey.measurementMode || '—')]
    ];
    return '<div class="np-popup"><table>' +
      rows.map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>'; }).join('') +
      '</table></div>';
  }

  function addMarkerForPoint(p) {
    if (!_map || !_markerLayer) return;
    var geo = safeNPGeo();
    var q = geo ? geo.qualityOf(p.signalPct) : { color: '#8b98a9' };
    var isNoReading = !isNum(p.signalPct);
    var color = isNoReading ? '#8b98a9' : (geo ? geo.signalColor(p.signalPct) : fallbackSignalColor(p.signalPct));

    var m = L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: color,
      fillColor: color,
      fillOpacity: 0.7,
      weight: 2,
      opacity: _visibility.markers ? 1 : 0,
      fillOpacity: _visibility.markers ? 0.7 : 0
    });
    m.bindPopup(makePopupHtml(p), { maxWidth: 320 });
    m._npPoint = p;
    _markerLayer.addLayer(m);
  }

  /* ------------------------------------------------------------------ */
  /* Rebuild all markers from scratch                                    */
  /* ------------------------------------------------------------------ */
  function rebuildMarkers() {
    if (!_map || !_markerLayer) return;
    _markerLayer.clearLayers();
    _points.forEach(addMarkerForPoint);
    applyMarkerVisibility();
  }

  function applyMarkerVisibility() {
    if (!_markerLayer) return;
    _markerLayer.eachLayer(function (m) {
      if (m.setStyle) {
        m.setStyle({
          opacity: _visibility.markers ? 1 : 0,
          fillOpacity: _visibility.markers ? 0.7 : 0
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Consent UI                                                          */
  /* ------------------------------------------------------------------ */
  function showConsentState() {
    if (_consentEl) _consentEl.style.display = '';
    if (_emptyEl) _emptyEl.style.display = 'none';
  }

  function hideConsentState() {
    if (_consentEl) _consentEl.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * init(containerEl, opts) — idempotent. Second call returns same instance.
   * opts: { bannerEl, emptyEl, consentEl, onConsentAccept }
   */
  function init(containerEl, opts) {
    opts = opts || {};

    // Idempotency: if already initialised on this container, return existing
    if (_map && _container === containerEl) return publicApi;
    // Guard against Leaflet's own duplicate-init check
    if (containerEl && containerEl._leaflet_id) {
      if (_map && _container === containerEl) return publicApi;
      // Container was used by a previous map that wasn't destroyed — destroy first
      destroy();
    }

    if (_map) destroy();

    if (!L || !containerEl) return publicApi; // safety (tests may pass null)

    _container = containerEl;
    _bannerEl = opts.bannerEl || null;
    _emptyEl = opts.emptyEl || null;
    _consentEl = opts.consentEl || null;
    _consentGiven = hasConsent();

    if (!_consentGiven) {
      showConsentState();
      // Wire the Load Map button if present
      var loadBtn = _consentEl && _consentEl.querySelector('[data-action="load-map"]');
      if (loadBtn) {
        loadBtn.addEventListener('click', function onLoadClick() {
          loadBtn.removeEventListener('click', onLoadClick);
          grantConsent();
          hideConsentState();
          _buildMap(containerEl, opts);
          if (opts.onConsentAccept) opts.onConsentAccept();
        });
      }
      return publicApi;
    }

    _buildMap(containerEl, opts);
    return publicApi;
  }

  function _buildMap(containerEl, opts) {
    _map = L.map(containerEl, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true
    });

    _tileLayer = L.tileLayer(OSM_URL, {
      maxZoom: MAX_ZOOM,
      attribution: OSM_ATTR,
      referrerPolicy: 'no-referrer-when-downgrade'
    }).addTo(_map);

    _tileLayer.on('tileload', onTileLoad);
    _tileLayer.on('tileerror', onTileError);

    _markerLayer = L.layerGroup().addTo(_map);

    _heatLayer = createHeatLayer();
    if (_heatLayer) _heatLayer.addTo(_map);

    // ResizeObserver for tab-switch / panel-resize
    if (typeof ResizeObserver !== 'undefined') {
      _resizeObserver = new ResizeObserver(function () {
        if (_map) _map.invalidateSize({ animate: false });
        scheduleRedraw();
      });
      _resizeObserver.observe(containerEl);
    }

    // Placement (click-to-place) handler
    _map.on('click', function (e) {
      if (_placementActive && _placementCb) {
        _placementCb({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    // Populate existing points
    if (_points.length) {
      rebuildMarkers();
      fitToData();
    }
  }

  /**
   * destroy() — removes map, observers, resets state.
   */
  function destroy() {
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    if (_map) {
      try { _map.remove(); } catch (e) {}
      _map = null;
    }
    _container = null;
    _tileLayer = null;
    _markerLayer = null;
    _heatLayer = null;
    _heatCanvas = null;
    _heatCtx = null;
    _userMarker = null;
    _placementActive = false;
    _placementCb = null;
    _rafPending = false;
    _tileErrorCount = 0;
    _tilesState = 'none';
  }

  /**
   * setPoints(plottableArray) — replaces all points (from NPGeo.partitionSurveys).
   * Does NOT recreate the map.
   */
  function setPoints(list) {
    _droppedCount = 0;
    _points = [];
    var geo = safeNPGeo();
    (list || []).forEach(function (p) {
      // Each item from partitionSurveys has .lat/.lng at top level
      var lat = p.lat, lng = p.lng;
      // Also handle plain survey records
      if (!isNum(lat) && p.survey) { lat = p.survey.lat; lng = p.survey.lng; }
      var check = { lat: lat, lng: lng };
      var valid = validatePoint(check);
      if (!valid.ok) { _droppedCount++; return; }
      var point = Object.assign({}, p, { lat: lat, lng: lng });
      // merge survey fields for popup
      if (p.survey) {
        var s = p.survey;
        if (!isNum(point.signalPct)) point.signalPct = s.signalPct;
        point.ssid = point.ssid || s.ssid;
        point.bssid = point.bssid || s.bssid;
        point.band = point.band || s.band;
        point.channel = point.channel || s.channel;
        point.rssiDbm = point.rssiDbm || s.rssiDbm;
        point.download = point.download || s.download;
        point.upload = point.upload || s.upload;
        point.ping = point.ping || s.ping;
        point.locationName = point.locationName || s.locationName;
        point.locationSource = point.locationSource || s.locationSource;
        point.measurementMode = point.measurementMode || s.measurementMode;
        point.accuracyM = isNum(point.accuracyM) ? point.accuracyM : (isNum(s.gpsAccuracyM) ? s.gpsAccuracyM : null);
        point.timestamp = point.timestamp || s.timestamp;
      }
      _points.push(point);
    });
    if (_map) {
      rebuildMarkers();
      scheduleRedraw();
      if (_points.length) fitToData();
    }
  }

  /**
   * addPoint(p) — incremental: adds one point without recreating the map.
   */
  function addPoint(p) {
    var lat = isNum(p.lat) ? p.lat : null;
    var lng = isNum(p.lng) ? p.lng : null;
    if (!isNum(lat) || !isNum(lng)) { _droppedCount++; return; }
    var valid = validatePoint({ lat: lat, lng: lng });
    if (!valid.ok) { _droppedCount++; return; }
    var point = Object.assign({}, p, { lat: lat, lng: lng });
    _points.push(point);
    if (_map) {
      addMarkerForPoint(point);
      scheduleRedraw();
    }
  }

  /**
   * setVisibility({markers, heat})
   */
  function setVisibility(vis) {
    if (vis && typeof vis.markers === 'boolean') _visibility.markers = vis.markers;
    if (vis && typeof vis.heat === 'boolean') _visibility.heat = vis.heat;
    applyMarkerVisibility();
    if (_heatLayer) {
      if (_visibility.heat) {
        scheduleRedraw();
      } else if (_heatCanvas) {
        _heatCtx && _heatCtx.clearRect(0, 0, _heatCanvas.width, _heatCanvas.height);
      }
    }
  }

  /**
   * setRadius(m) — heat radius in metres, 10–100.
   */
  function setRadius(m) {
    _radiusM = Math.max(10, Math.min(100, isNum(m) ? m : DEFAULT_RADIUS_M));
    scheduleRedraw();
  }

  /**
   * fitToData() — fit map bounds to current points.
   */
  function fitToData() {
    if (!_map || !_points.length) return;
    try {
      var latlngs = _points.map(function (p) { return [p.lat, p.lng]; });
      _map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
    } catch (e) {}
  }

  /**
   * flyTo(lat, lng, zoom)
   */
  function flyTo(lat, lng, zoom) {
    if (!_map || !isNum(lat) || !isNum(lng)) return;
    _map.flyTo([lat, lng], isNum(zoom) ? zoom : 14);
  }

  /**
   * enablePlacement(cb) — map click fires cb({lat, lng}).
   */
  function enablePlacement(cb) {
    _placementActive = true;
    _placementCb = cb;
    if (_map && _map.getContainer) {
      _map.getContainer().style.cursor = 'crosshair';
    }
  }

  /**
   * disablePlacement()
   */
  function disablePlacement() {
    _placementActive = false;
    _placementCb = null;
    if (_map && _map.getContainer) {
      _map.getContainer().style.cursor = '';
    }
  }

  /**
   * showUserLocation({lat, lng, accuracyM}) — blue circle + dot.
   */
  function showUserLocation(pos) {
    if (!_map || !isNum(pos.lat) || !isNum(pos.lng)) return;
    if (_userMarker) { _map.removeLayer(_userMarker); _userMarker = null; }
    var g = L.layerGroup().addTo(_map);
    if (isNum(pos.accuracyM) && pos.accuracyM > 0) {
      L.circle([pos.lat, pos.lng], {
        radius: pos.accuracyM,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.08,
        weight: 1
      }).addTo(g);
    }
    L.circleMarker([pos.lat, pos.lng], {
      radius: 7,
      color: '#fff',
      fillColor: '#2563eb',
      fillOpacity: 1,
      weight: 2
    }).addTo(g);
    _userMarker = g;
  }

  /**
   * invalidate() — force Leaflet to recalculate size (call after tab switch).
   */
  function invalidate() {
    if (_map) {
      _map.invalidateSize({ animate: false });
      scheduleRedraw();
    }
  }

  /**
   * snapshotHeatOverlay(w, h) — returns dataURL of the heat canvas only
   * (NO basemap: tiles are cross-origin and would taint the canvas).
   * w, h are optional; defaults to current canvas dimensions.
   * Returns empty string if no heat canvas or no data.
   */
  function snapshotHeatOverlay(w, h) {
    if (!_heatCanvas) return '';
    try {
      var sw = w || _heatCanvas.width;
      var sh = h || _heatCanvas.height;
      if (sw <= 0 || sh <= 0) return '';
      if (sw === _heatCanvas.width && sh === _heatCanvas.height) {
        return _heatCanvas.toDataURL('image/png');
      }
      // Resize to requested dimensions
      var tmp = doc.createElement('canvas');
      tmp.width = sw; tmp.height = sh;
      tmp.getContext('2d').drawImage(_heatCanvas, 0, 0, sw, sh);
      return tmp.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  /**
   * getStatus() → { tilesState, pointCount, droppedCount, hasConsent }
   */
  function getStatus() {
    return {
      tilesState: _tilesState,
      pointCount: _points.length,
      droppedCount: _droppedCount,
      hasConsent: _consentGiven || hasConsent()
    };
  }

  var publicApi = {
    init: init,
    destroy: destroy,
    setPoints: setPoints,
    addPoint: addPoint,
    setVisibility: setVisibility,
    setRadius: setRadius,
    fitToData: fitToData,
    flyTo: flyTo,
    enablePlacement: enablePlacement,
    disablePlacement: disablePlacement,
    showUserLocation: showUserLocation,
    invalidate: invalidate,
    snapshotHeatOverlay: snapshotHeatOverlay,
    getStatus: getStatus,
    // Expose internals for test access
    _getMap: function () { return _map; },
    _getPoints: function () { return _points; },
    _getTileErrorCount: function () { return _tileErrorCount; },
    _getTilesState: function () { return _tilesState; },
    _simulateTileError: function () { onTileError(); },
    _simulateTileLoad: function () { onTileLoad(); }
  };

  return publicApi;
}));
