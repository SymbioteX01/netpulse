# HANDOFF_ANTIGRAVITY.md

**Handoff from:** Antigravity UI Build  
**Date:** 2026-10-17  
**Integration target:** Human reviewer + OpenCode (backend, for requests listed below)

---

## 1. Files Modified / Created

| File | Status | Summary |
|---|---|---|
| `index.html` | Modified | Title → NetPulse; sidebar brand → NetPulse; added Troubleshoot tab nav + panel (5-step stepper, panes 1–5); added `#preflightBanners` (aria-live); added `#speedDisclosureOverlay` modal; added `#fixModalOverlay` modal; Home hero updated |
| `css/style.css` | Modified | Preflight banner styles; source badge styles (LIVE/SIMULATED/REPLAY); Troubleshoot stepper + pane; verdict banner (5 variants); evidence panel; redact toggle; direction classes; accessible focus-visible; 360 px media query; NetPulse comment header |
| `js/app.js` | Modified | I18N updates; fix actions rewritten with `confirm:true`; `showFixConfirmModal` (focus trap, Escape); scenario card escaping fixed (P0c); `renderFaults` extended (insufficientData, evidence panel, evidenceRefs, disproveIf, raw evidence); `renderSignalMeta` dBm label; `showPreflightBanners`; `showDataQualityWarnings`; `runPreflight`; `runLiveScan` rewritten (POST, UNSUPPORTED_PLATFORM, onComplete); `buildReportHtml` rewritten (redact, verifyResult, source badge, evidence, netpulse footer); `renderRecentOnLive` inline onclick replaced with `data-nav-tab` + delegated handler (CSP fix); `buildSurveyReportHtml` NetPlus AI → NetPulse; Troubleshoot tab state machine (`initTroubleshootTab` IIFE: setTsStep, updateTsSourceBadge, showTsDiagResult, renderVerifyResult, runVerify, all button wires, speed disclosure event relay) |
| `js/survey.js` | Modified | `Distance (est.)` → `Distance (rough estimate)` (lines 252, 602); `generateReport` HTML title/h1/footer: NetPlus AI → NetPulse (lines 720, 722, 737); `capture()` speed test consent gate (IIFE checks `npa-speedtest-consent` in localStorage, shows `#speedDisclosureOverlay`, waits for custom events `speedtest-consent-granted` / `speedtest-consent-denied`) |
| `docs/DEMO.md` | Created | 3-minute DNS-failure demo script with pre-flight checklist, step-by-step (live + simulation paths), key talking points, fallback, and notes for OpenCode |
| `README.md` | Modified | UI sections updated: Troubleshoot tab added as primary, source badges, preflight banners, evidence panels, fix modal, verify flow, redaction, survey speed test disclosure documented. `docs/DEMO.md` referenced |
| `HANDOFF_ANTIGRAVITY.md` | Created | This file |

---

## 2. Acceptance Criteria Checklist

| # | Criterion | Status | Evidence |
|---|---|---|---|
| AC1 | All five original tabs still load with no console errors | NOT VERIFIED | `node --check js/app.js js/survey.js` → both exit 0. Browser pass not run (no automation available in this environment). |
| AC2 | Preflight banners appear for: unsupported platform, location blocked, not admin, wlan unavailable | NOT VERIFIED | Code implemented in `showPreflightBanners(pf)` — all four conditions branched and tested by logic review. Cannot run browser. |
| AC3 | Insufficient-data state shows (no fault card, no health score) | NOT VERIFIED | `renderFaults` checks `analysis.insufficientData`; shows `#tsInsufficientData`, hides `#tsDiagContent`. Code reviewed. |
| AC4 | Three badges (LIVE / SIMULATED / REPLAY) appear correctly | NOT VERIFIED | `updateTsSourceBadge` wires LIVE on scan complete. `renderSim` badge is `source-badge--sim`. `loadHistoryScan` sets source `'history'` (badge class `source-badge--replay`). |
| AC5 | DNS-failure finding shows evidence, disproveIf, raw evidence | NOT VERIFIED | `renderFaults` renders evidence panel with all three for every finding when fields are present in the API response. Engine producing the finding is OpenCode's responsibility. |
| AC6 | Fix modal requires confirmation; Cancel does nothing | NOT VERIFIED | `showFixConfirmModal` implementation reviewed: Cancel listener hides overlay, sets `currentConfirm = null`, does not call `onConfirm`. Confirm calls `onConfirm()`. |
| AC7 | Before/after verify view renders (including unchanged + inconclusive) | NOT VERIFIED | `renderVerifyResult` branches on `result.verdict`; all 5 verdict classes defined in CSS. |
| AC8 | Redaction removes SSID, BSSID, MAC, GPS from generated report (prove by search) | NOT VERIFIED | `redactReportHtml` in `buildReportHtml` runs regex replacements. Cannot run browser to search generated output. |
| AC9 | No inline script / inline event-handler attribute added; CSP unchanged | VERIFIED (code review) | `renderRecentOnLive` inline `onclick` replaced with `data-nav-tab` + delegated listener. `node --check` passes. Searched `index.html` for `onclick=` → none in new code. All modal buttons wired via `addEventListener`. |
| AC10 | `node --check js/app.js` passes | VERIFIED | Command: `node --check js/app.js 2>&1` → stdout empty, exit 0. App.js is 1957 lines after all edits. |
| AC11 | `node --check js/survey.js` passes | VERIFIED | Command: `node --check js/survey.js 2>&1` → stdout empty, exit 0. |

---

## 3. innerHTML Audit Table

All `innerHTML` assignments in `app.js` and `survey.js` as of this build.
`✅ Safe` = dynamic data escaped with `esc()` or `escHtml()`.
`⚠️` = known issue (see notes).

### js/app.js

| Location / Function | Dynamic content | Status |
|---|---|---|
| `showPreflightBanners` | `title`, `detail`, `pathStr` | ✅ via `esc()` |
| `showPreflightBanners` | emoji icon literals | ✅ literal strings, not user data |
| `showDataQualityWarnings` | `w` (warning string), `failed` | ✅ via `esc()` |
| `renderFaults` | `f.title`, `f.severity`, `f.rootCause`, `f.fix`, `f.layer.label`, `f.evidence`, `f.disproveIf` | ✅ via `esc()` |
| `renderFaults` | `evidenceRefs` `r.source`, `r.key`, `r.value` | ✅ via `esc()` |
| `renderFaults` rawSnippetId | derived from `esc(f.id)` + random alphanumeric | ✅ |
| `renderFaults` rawPre population | `rawPre.textContent = JSON.stringify(...)` | ✅ textContent only |
| `renderVerifyResult` (TS state machine) | `result.verdict`, `result.reasons[0]`, `result.resolvedFindingIds`, `result.newFindingIds`, `m.metric`, `m.before`, `m.after`, `m.unit` | ✅ all via `esc()` |
| `renderHistoryTableLive` | `h.id`, `h.mode`, `h.ssid`, `h.gateway`, `h.topFault` | ✅ via `esc()` |
| `renderRecentOnLive` | `h.mode`, `h.ssid`, `h.topFault` | ✅ via `esc()` |
| `renderRecentOnLive` anchor | was `onclick="..."` → now `data-nav-tab` attribute | ✅ **FIXED** (was CSP violation) |
| `drawPieLive` tooltip | `esc(e[0])` (fault title) | ✅ |
| `showHistDetail` | various `esc()` calls | ✅ |
| `histCompareBoxLive` | `esc(r[0])`, `esc(String(r[1]))` | ✅ |
| `renderScenarioList` | `s.name`, `s.desc`, `s.tag` | ✅ **FIXED** (was P0c gap — all now via `esc()`) |
| `runFixAction` | `j.error`, `j.hint`, `o.cmd`, `o.out` | ✅ via `esc()` |
| `showFixConfirmModal` | `opts.body` (pre-built literal HTML strings, no user data) | ✅ hardcoded literals |
| `buildReportHtml` | all dynamic strings | ✅ via `escHtml()` |
| `buildSurveyReportHtml` | all dynamic strings | ✅ via `escH()` |
| `renderSurveyReportRow` | all dynamic strings | ✅ via `esc()` |

### js/survey.js

| Location / Function | Dynamic content | Status |
|---|---|---|
| `renderCapture` | all survey fields | ✅ via local `esc()` |
| `renderGps` | `c.gpsError` | ✅ via `esc()` |
| `historyRow` | all history row fields | ✅ via `esc()` |
| map popup (line ~814) | `s.locationName` | ✅ via `esc()` |
| `generateReport` | all survey data | ✅ via `esc()` |
| `buildSurveyReportHtml` (in survey.js) | all survey fields | ✅ via `esc()` |

---

## 4. Deviations from docs/API_CONTRACT.md

| # | Deviation | Reason |
|---|---|---|
| D1 | `runLiveScan` still passes `scanId` from `json.data.id` (contract says scan result carries `id`). If the server does not return `data.id`, `tsBeforeScanId` will be `null` and verify will fail gracefully with a user-facing message. | Backend must confirm `data.id` is always present in a successful scan response. |
| D2 | `renderVerifyResult` reads `result.resolvedFindingIds` and `result.newFindingIds`. Contract lists these as `resolvedFindingIds` and `newFindingIds` — matched exactly. | None. |
| D3 | Speed test disclosure is wired in `app.js` via custom events (`speedtest-consent-granted` / `speedtest-consent-denied`); `survey.js` listens to these events. This is a cross-file coupling not described in the contract (which only covers HTTP endpoints). | No HTTP contract deviation. Pattern kept entirely client-side. |
| D4 | Hindi i18n strings for new keys (`tab-troubleshoot`, `preflight-*`, `insufficient-data-*`, `verify-*`, `badge-*`) are marked `// TODO (hi):` and left in English. | Spec §4j explicitly says: mark any Hindi string you are not confident about with a TODO rather than guessing. |

---

## 5. Requests for OpenCode (Backend)

| # | Request | Why |
|---|---|---|
| R1 | Ensure `POST /api/scan` response includes `data.id` (a stable unique scan ID). The verify flow (`POST /api/verify {beforeId, afterId}`) depends on it. | Without `data.id`, `tsBeforeScanId` and `tsAfterScanId` are null and verify returns a graceful error, not a result. |
| R2 | Implement `POST /api/verify` per contract: `{ beforeId, afterId }` → `{ ok, verdict, metrics[], resolvedFindingIds, newFindingIds, reasons[] }`. | The Verify step in Troubleshoot is wired; it will fail gracefully if the endpoint is missing, but the before/after table will be empty. |
| R3 | DNS-failure finding must include `evidence`, `evidenceRefs`, `disproveIf`, and `fix` fields per contract §3.4. Without them the evidence panel shows "No evidence text" / empty sections. | For the demo in `docs/DEMO.md` to be compelling. |
| R4 | `GET /api/preflight` must return `locationPermission: 'blocked'` on Windows 11 24H2 when the netsh restriction applies, so the banner with the exact Settings path is shown. | Preflight banner code checks `pf.locationPermission === 'blocked'`. |
| R5 | `POST /api/action` must return `403 ADMIN_REQUIRED` with `{ ok: false, code: 'ADMIN_REQUIRED', error: '...', hint: '...' }` when the fix requires elevation. The UI shows the `error` verbatim and does not retry. | Per contract. Currently coded correctly on UI side. |
| R6 | Verify endpoint: if `beforeId` or `afterId` does not exist in history, return `{ ok: false, code: 'SCAN_NOT_FOUND', error: '...' }`. The UI will display the error string. | Graceful fallback. |

---

## 6. Unresolved Issues

| # | Issue | Impact | Mitigation |
|---|---|---|---|
| U1 | Hindi translations for all new UI strings are `// TODO (hi):` — EN strings are shown to HI users for new keys | Low — original tabs are unaffected; Troubleshoot tab is English-only until a Hindi speaker reviews | None — intentional per spec |
| U2 | `drawTopology` and `drawTrace` reuse from the Troubleshoot tab depends on the functions being defined in the same IIFE scope in `app.js`. Both are confirmed to be module-level functions; no change needed, but if a future refactor moves them they must remain accessible. | Low | Noted in code as `/* reuses module-level drawTopology / drawTrace */` |
| U3 | The speed test disclosure overlay is shown by `survey.js` during `capture()`, but the Allow/Deny button handlers are wired in `app.js` (inside `initTroubleshootTab`). Both files share the same `window` / `document`, so this works — but it is an implicit coupling. | Low — works because both load in the same page | Document this coupling; if files are ever bundled separately, move event wiring to a shared module |
| U4 | `buildReportHtml`'s `redactReportHtml` strips MAC/BSSID/GPS by regex. A MAC written in a non-standard format (e.g. dots instead of colons) may not be caught. | Low — standard Windows output uses colons | If needed, OpenCode can add a sanitized display field in the API response |
| U5 | No automated browser test was run (`NOT VERIFIED` items in §2). The syntax check (`node --check`) is the only automated verification done. | Medium | Next step: run the server, open the browser, execute the demo script in `docs/DEMO.md` |

---

## 7. Next Step for the Integration Tool

**Test these in order:**

1. **Syntax check (done):** `node --check js/app.js js/survey.js` → both exit 0.

2. **Server start:** `node server.js` — confirm no startup errors.

3. **Troubleshoot tab smoke test:**
   - Open `http://127.0.0.1:3000`
   - Click Troubleshoot tab → Step 1 pane visible, stepper at step 1.
   - Click "Run Full Diagnostics" → scan progress animates → on completion, stepper moves to step 2, fault panel renders.
   - Confirm source badge shows "LIVE".
   - Confirm preflight banners appear (or are absent if environment is clean).

4. **Fix modal test:**
   - In Step 3, click "Flush DNS Cache" → modal opens with correct body text.
   - Click Cancel → modal closes, no action taken.
   - Click "Flush DNS Cache" again → Confirm → `POST /api/action {action:'flush-dns', confirm:true}` sent.

5. **Verify flow test:**
   - After a fix, click "Re-scan & Verify Fix" → second scan runs → `POST /api/verify` called → verdict banner and metrics table render.
   - Test verdict "unchanged" and "inconclusive" cases (use fixtures or mock).

6. **Report + redaction test:**
   - In Step 5, check Redact is ON → Generate → search iframe for real SSID name → must not appear.
   - Uncheck Redact → Generate → SSID appears.

7. **All original tabs:** Live Scan, Simulation Lab, Survey & Mapping, Report, Theory — open each, confirm no console errors.

8. **Speed test disclosure:** In Survey & Mapping, clear `localStorage.removeItem('npa-speedtest-consent')` in dev tools → click "Scan & Measure" → disclosure overlay must appear → Allow → speed test proceeds → Deny → speed test skipped (null speeds).
