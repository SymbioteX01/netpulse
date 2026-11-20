# NetPulse — Manual Map Checklist

Use this checklist to manually verify the Geographic Signal Map feature
after deployment. No browser automation is available, so each item must
be checked by a human tester.

---

## 1. Consent & Tile Loading

| # | Step | Expected | Pass? |
|---|---|---|---|
| 1.1 | Clear `localStorage.removeItem('npa-map-consent')` in DevTools. Open Survey & Mapping tab. | Consent notice shown, map tiles NOT loaded, **Load Map** button visible. | |
| 1.2 | Click **Load Map**. | Consent notice hides, Leaflet map initialises, OSM tiles begin loading. | |
| 1.3 | Reload page without clearing consent. Open Survey & Mapping tab. | Map loads immediately (no consent notice). | |

---

## 2. Tile Unavailability (offline / blocked)

| # | Step | Expected | Pass? |
|---|---|---|---|
| 2.1 | In DevTools Network, block `tile.openstreetmap.org`. Trigger 5 tile requests (zoom / pan). | Yellow/purple banner appears: "Map tiles unavailable (offline or blocked)". Points & heat still render on blank background. | |
| 2.2 | Unblock tiles, trigger one successful tile load. | Banner disappears. | |

---

## 3. Location Permission — Denied

| # | Step | Expected | Pass? |
|---|---|---|---|
| 3.1 | Block location in browser (padlock → Location → Block). Click **Use my location**. | Error message shown next to button: "Location permission was denied…" | |
| 3.2 | GPS Help panel → expand. | Shows two sets of instructions: (1) browser padlock, (2) Windows Settings path. | |

---

## 4. Accuracy Too Low

| # | Step | Expected | Pass? |
|---|---|---|---|
| 4.1 | Set accuracy limit to ≤20 m. Start a live survey in an area with only IP/Wi-Fi positioning (typical desktop). | Status shows "Skipped: lowAccuracy" repeatedly. No points are added to the map. | |
| 4.2 | Change accuracy limit to ≤100 m. | Survey captures points despite coarse positioning. | |

---

## 5. Points at Real Coordinates

| # | Step | Expected | Pass? |
|---|---|---|---|
| 5.1 | Save a survey point with known GPS coordinates (e.g. a location with valid lat/lng). Open Survey & Mapping. | Circle marker appears at the correct geographic position. Popup shows the right lat/lng, signal %, quality, SSID. | |
| 5.2 | Point with `signalPct: null`. | Grey marker rendered (no reading). Heat layer excludes it. | |
| 5.3 | Point at (0, 0) / null island. | Point listed in "Cannot be plotted" section with reason `null-island`. Not drawn on map. | |

---

## 6. Heat Layer

| # | Step | Expected | Pass? |
|---|---|---|---|
| 6.1 | Add ≥2 points at different coordinates with different signal values. | Heat layer renders with colour matching the absolute scale (red = poor, green = excellent). | |
| 6.2 | Move the radius slider from 10 m to 100 m. | Heat blob visibly expands/contracts without page reload. | |
| 6.3 | Toggle **Heat layer** off. | Heat canvas clears. Toggle on → heat redraws. | |
| 6.4 | Toggle **Markers** off. | Circle markers become invisible. Toggle on → reappear. | |

---

## 7. Tab Switch × 5

| # | Step | Expected | Pass? |
|---|---|---|---|
| 7.1 | Click away from Survey & Mapping to another tab, then back — repeat 5 times. | Map container always renders correctly (no blank grey box). Leaflet `invalidateSize` is called. | |
| 7.2 | Resize the browser window to a narrow width (< 700 px) while on the Survey tab. | Map container height adjusts (60 vh), toolbar stacks vertically, controls remain touch-sized. | |

---

## 8. Mobile / Narrow Width

| # | Step | Expected | Pass? |
|---|---|---|---|
| 8.1 | Set DevTools to a 375 px wide viewport. Open Survey & Mapping. | Map renders at ≥ 280 px height. No horizontal scroll. All controls visible and tappable. | |
| 8.2 | GPS Help panel is visible and expandable at 375 px. | Panel text readable, no overflow. | |

---

## 9. Legacy Data Display

| # | Step | Expected | Pass? |
|---|---|---|---|
| 9.1 | Load the app with existing legacy survey data (no `sessionId`, no `locationSource`). | Legacy points appear in the "All points" session and on the map. Session selector shows "Legacy YYYY-MM-DD" groups. | |
| 9.2 | Open a legacy point popup. | `locationSource` shows "legacy", accuracy shows "not recorded (legacy)". Data is NOT modified. | |
| 9.3 | Legacy point with no `lat`/`lng`. | Listed under "Cannot be plotted" with reason `no-coordinates`. Original record unchanged. | |

---

## 10. Null-Coordinate Point

| # | Step | Expected | Pass? |
|---|---|---|---|
| 10.1 | POST a survey point with `{ "lat": null, "lng": null, "signalPct": 72, "locationName": "No GPS" }`. | Point appears in history table. "Cannot be plotted (1 points)" section visible. No crash. | |
| 10.2 | Generate HTML report with zero plottable points. | Report generates successfully. Heat overlay section shows "no data" caption instead of a broken image. | |

---

## 11. Report Generation

| # | Step | Expected | Pass? |
|---|---|---|---|
| 11.1 | With ≥1 plottable point, click **Generate HTML Report**. | Report opens/saves. Heat overlay image is present with caption "heat overlay, no basemap". | |
| 11.2 | With zero plottable points (all unplottable), click **Generate HTML Report**. | Report generates without error. Heat section absent or shows empty note. | |

---

## 12. Indoor Floor Plan (collapsed section)

| # | Step | Expected | Pass? |
|---|---|---|---|
| 12.1 | Expand "Indoor floor plan (not geographic)" section. | Old canvas-based map + heatmap visible. Floor plan upload works as before. | |
| 12.2 | Close the section. | Section collapses. Geographic map is still visible and functional above it. | |

---

## NOT VERIFIED (browser automation unavailable)

All items above are **NOT VERIFIED** in automated testing. They require a human tester
with a running `node server.js` instance and a real browser.

The following additional items require specific hardware/network conditions:

- Real GPS fix on a Windows laptop with Location Services enabled
- Live `netsh wlan` signal capture (`LIVE signal (netsh, connected AP only)` mode)
- Actual tile rendering from `tile.openstreetmap.org`
- PDF report with embedded heat overlay image
