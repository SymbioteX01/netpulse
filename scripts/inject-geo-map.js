// Script to inject the geographic map card into index.html
const fs = require('fs');
const path = require('path');

let html = fs.readFileSync('index.html', 'utf8');

// The section to replace starts with the grid-2col that contains surveyMapCanvas
// and ends just before the Survey Comparison card
const REPLACE_START = '      <div class="grid-2col">\n        <div class="col">\n          <div class="card">\n            <div class="card-head"><h3 data-i18n="s-map">Survey Map</h3></div>';
const REPLACE_END_MARKER = '      <div class="card" id="compareCard"';

const si = html.indexOf(REPLACE_START);
if (si < 0) { console.error('START not found'); process.exit(1); }

const ei = html.indexOf(REPLACE_END_MARKER, si);
if (ei < 0) { console.error('END not found'); process.exit(2); }

const before = html.substring(0, si);
const after = html.substring(ei);

const geoCard = `      <!-- ============ GEOGRAPHIC SIGNAL MAP ============ -->
      <div class="card" id="geoMapCard">
        <div class="card-head">
          <h3>Geographic Signal Map</h3>
          <span class="tag-mono" id="geoMapPointCount">0 points</span>
        </div>
        <div class="card-body geo-map-body">
          <!-- Toolbar -->
          <div class="geo-map-toolbar">
            <div class="geo-toolbar-left">
              <label class="lbl-uppercase" for="geoSessionSelect">Session:</label>
              <select id="geoSessionSelect" class="input" style="min-width:160px">
                <option value="all">All points</option>
              </select>
            </div>
            <div class="geo-toolbar-right">
              <label class="geo-toggle-label"><input type="checkbox" id="geoToggleMarkers" checked><span>Markers</span></label>
              <label class="geo-toggle-label"><input type="checkbox" id="geoToggleHeat" checked><span>Heat layer</span></label>
              <label class="lbl-uppercase" for="geoRadiusSlider">Radius:</label>
              <input type="range" id="geoRadiusSlider" min="10" max="100" value="25" step="5" style="width:80px">
              <span id="geoRadiusVal" class="scan-status">25 m</span>
            </div>
          </div>
          <!-- Live survey controls -->
          <div class="geo-survey-controls">
            <button id="geoStartSurvey" class="btn-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
              Start Survey
            </button>
            <button id="geoStopSurvey" class="btn-ghost" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              Stop
            </button>
            <select id="geoIntervalSelect" class="input" title="Capture interval">
              <option value="3000">3 s</option>
              <option value="5000" selected>5 s</option>
              <option value="10000">10 s</option>
            </select>
            <select id="geoAccuracySelect" class="input" title="Max GPS accuracy">
              <option value="20">&le;20 m accuracy</option>
              <option value="50" selected>&le;50 m accuracy</option>
              <option value="100">&le;100 m accuracy</option>
            </select>
            <span id="geoSurveyStatus" class="scan-status" aria-live="polite">Idle</span>
          </div>
          <!-- Save/Discard bar -->
          <div id="geoSaveBar" class="geo-save-bar" style="display:none">
            <button id="geoSaveSession" class="btn-primary" disabled>Save 0 points</button>
            <button id="geoDiscardSession" class="btn-ghost danger-btn">Discard</button>
            <span id="geoSaveStatus" class="scan-status" aria-live="polite"></span>
          </div>
          <!-- Tile error banner -->
          <div id="geoTileBanner" class="geo-tile-banner" style="display:none" role="alert" aria-live="assertive"></div>
          <!-- Consent state -->
          <div id="geoConsentState" class="geo-consent-state" style="display:none">
            <div class="geo-consent-inner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:40px;height:40px;color:#3b82f6"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h4>Map tiles come from OpenStreetMap</h4>
              <p>Loading the map sends tile requests to <strong>tile.openstreetmap.org</strong>. Your IP address and the geographic area you view will be visible to the OpenStreetMap Foundation. No personal data is collected by NetPulse.</p>
              <p><a href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noopener">OSM tile usage policy &#8599;</a></p>
              <button class="btn-primary" data-action="load-map">Load Map</button>
            </div>
          </div>
          <!-- Empty state -->
          <div id="geoEmptyState" class="geo-empty-state" style="display:none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;color:#64748b"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <p>No plottable survey points yet.<br>Run a scan and save a point with a location name &mdash; or start a live survey.</p>
          </div>
          <!-- Map container (explicit height required by Leaflet) -->
          <div id="geoMap" class="geo-map-container"></div>
          <!-- Legend -->
          <div class="geo-legend-row">
            <span class="lg-dot" style="background:#f87171"></span> Poor &lt;25%
            <span class="lg-dot" style="background:#fb923c"></span> Fair 25-49%
            <span class="lg-dot" style="background:#fbbf24"></span> Good 50-74%
            <span class="lg-dot" style="background:#34d399"></span> Excellent 75%+
            <span class="lg-dot" style="background:#8b98a9"></span> No reading
            <span class="geo-legend-note">Colors use fixed signal thresholds</span>
          </div>
          <!-- Use my location -->
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button id="geoUseLocation" class="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
              Use my location
            </button>
            <span id="geoLocationStatus" class="scan-status"></span>
          </div>
          <!-- GPS Help panel -->
          <details class="gps-help-panel" style="margin-top:10px">
            <summary>GPS / Location help &amp; troubleshooting</summary>
            <div class="gps-help-body">
              <h4>1. Browser site location permission</h4>
              <ol><li>Click the <strong>padlock</strong> icon in the browser address bar.</li><li>Find <strong>Location</strong> and set it to <strong>Allow</strong>.</li><li>Reload the page and try again.</li></ol>
              <h4>2. Windows Location Settings (required on Windows 11 24H2+)</h4>
              <ol><li>Open <strong>Settings &rarr; Privacy &amp; security &rarr; Location</strong>.</li><li>Turn on <strong>Location services</strong> and allow your browser.</li><li>Also required for <code>netsh wlan</code> Wi-Fi signal data.</li></ol>
              <h4>Other issues</h4>
              <ul>
                <li><strong>Needs localhost or HTTPS</strong> &mdash; geolocation requires a secure context. <code>http://127.0.0.1</code> (loopback) is allowed.</li>
                <li><strong>Desktop accuracy</strong> &mdash; desktop PCs use Wi-Fi positioning or IP geolocation and can be hundreds of metres off. Use map-click or manual coordinate entry.</li>
                <li><strong>Accuracy too low</strong> &mdash; increase the accuracy limit above (e.g. &le;100 m).</li>
              </ul>
            </div>
          </details>
          <!-- Unplottable list -->
          <details id="geoUnplottableDetails" class="geo-unplottable" style="display:none;margin-top:10px">
            <summary>Cannot be plotted (<span id="geoUnplottableCount">0</span> points)</summary>
            <ul id="geoUnplottableList" class="geo-unplottable-list"></ul>
          </details>
        </div>
      </div>

      <!-- Indoor floor plan (not geographic) &mdash; collapsed by default -->
      <details class="card geo-indoor-details" style="margin-top:16px">
        <summary class="card-head geo-indoor-summary">
          <h3>Indoor floor plan <span class="tag-mono">not geographic</span></h3>
        </summary>
        <div class="card-body">
          <div class="grid-2col">
            <div class="col">
              <div class="map-wrap">
                <canvas id="surveyMapCanvas" width="520" height="320"></canvas>
                <div id="mapPopup" class="map-popup"></div>
              </div>
              <div class="legend-row">
                <span class="lg-dot" style="background:#34d399"></span> Excellent (75%+)
                <span class="lg-dot" style="background:#fbbf24"></span> Good (50-74%)
                <span class="lg-dot" style="background:#fb923c"></span> Fair (25-49%)
                <span class="lg-dot" style="background:#f87171"></span> Poor (&lt;25%)
              </div>
            </div>
            <div class="col">
              <canvas id="surveyHeatCanvas" width="520" height="320"></canvas>
              <div class="heat-legend"></div>
              <div class="heat-labels"><span>Dead zone</span><span>Weak</span><span>Medium</span><span>Strong</span></div>
            </div>
          </div>
          <div class="export-bar" style="margin-top:12px">
            <input id="floorPlanInput" type="file" accept="image/*">
            <button id="btnFloorClear" class="btn-ghost" data-i18n="btn-floor-clear">Remove Floor Plan</button>
          </div>
          <div class="row-sub">Upload a floor plan image &mdash; survey points plot over it (relative positions only, not GPS-aligned).</div>
        </div>
      </details>

`;

const result = before + geoCard + after;
fs.writeFileSync('index.html', result, 'utf8');
console.log('DONE. New size:', result.length, 'Original size:', html.length);
console.log('Lines:', result.split('\n').length);
