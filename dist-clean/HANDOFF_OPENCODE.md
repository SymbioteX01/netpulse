# HANDOFF_OPENCODE.md

NetPulse backend / diagnostic-engine / tests / security handoff (OpenCode run).
This file is completed section by section. UI files (`index.html`, `css/style.css`,
`js/app.js`, `js/survey.js`) were NOT touched.

---

## 1. BASELINE (before any change)

Environment: Windows, Node.js v24.19.0, not a git repository (`git status` -> "not a git repository").
`npm` `.ps1` shim is blocked by the machine execution policy; `npm.cmd` works
(v11.17.0) - use `npm.cmd test` or `cmd /c npm test`.

### 1.1 `node test_engine.js`

```
lan/lan-healthy -> [Healthy] health=100% layer=- | top: No Fault Detected
lan/lan-cable -> [Critical] health=55% layer=Physical | top: Gateway Link Down
lan/lan-congestion -> [Medium] health=90% layer=Network | top: Network Congestion
lan/lan-duplex -> [High] health=80% layer=Data Link | top: Gateway Unstable (High Loss)
lan/lan-dhcp -> [Critical] health=65% layer=Network | top: DHCP Server Unreachable (APIPA)
wifi/wifi-healthy -> [Healthy] health=95% layer=- | top: LAN Cable Not Connected
wifi/wifi-interference -> [High] health=70% layer=Data Link | top: WiFi Interference / Channel Congestion
wifi/wifi-weak -> [Medium] health=75% layer=Data Link | top: Weak Signal
wifi/wifi-auth -> [High] health=80% layer=Data Link | top: WiFi Connection Failed
wifi/wifi-users -> [Medium] health=85% layer=Network | top: Network Congestion
mobile/mob-healthy -> [Healthy] health=100% layer=- | top: No Fault Detected
mobile/mob-coverage -> [Critical] health=55% layer=Data Link | top: Critical Weak Signal
mobile/mob-apn -> [Critical] health=55% layer=Network | top: Internet Unreachable (ISP / WAN Issue)
mobile/mob-congestion -> [Medium] health=90% layer=Network | top: Network Congestion
mobile/mob-tower -> [Critical] health=65% layer=Physical | top: Cellular Outage / No Service
engine/dns -> [Critical] health=65% | DNS rule fired: true
LIVE SCAN SKIPPED: fetch failed
  (start the server with `node server.js` to include the live scan test)
RESULT: pass=16 fail=0
```

Baseline defects visible here (fixed later): `wifi-healthy` top finding is the
informational `LAN Cable Not Connected` while status is Healthy; status Healthy
does not force a `No fault detected` headline.

### 1.2 `node test_history.js` (server running on 3000)

```
PASS | history list endpoint
PASS | scan runs for history test | mode=wifi
PASS | scan saved to history | count=9
PASS | history item GET | id=<redacted>
PASS | history item 404
PASS | report pdf | <reports path redacted>
PASS | report pdf magic | %PDF
PASS | report html | <reports path redacted>
PASS | action flush-dns | ipconfig /flushdns
PASS | action unknown 400
PASS | history item DELETE | id=<redacted>
PASS | history back to original | count=8
RESULT: pass=12 fail=0
```

### 1.3 `node test_survey.js` (server running on 3000)

```
PASS | health
PASS | network scan | duration=13358ms, mode=wifi
PASS | speedtest data | 1048576 bytes
PASS | speedtest upload | 635.06 Mbps
PASS | survey create | <id redacted>
PASS | survey list | 3 points
PASS | survey update
PASS | export csv | <path redacted>
PASS | export xlsx | <path redacted>
PASS | export json | <path redacted>
PASS | export pdf | <path redacted>
PASS | export kml | <path redacted>
PASS | csv content
PASS | csv filename has time | <path redacted>
PASS | xlsx zip magic | PK..
PASS | json content
PASS | pdf magic | 3200 bytes
PASS | kml content | Placemarks=1
PASS | survey delete
PASS | action flush-dns | DNS cache flush
PASS | action unknown guard
PASS | export empty guard
RESULT: pass=22 fail=0
```

These three legacy scripts passed but only assert "something exists"; they also
exit 0 / write to the real `data/` folder (see sections 3 and 7).

---

## 2. Changed / added files (this run)

There is no git repository here, so this is the full inventory (no commit was
made). UI files owned by Antigravity were **not** touched:
`index.html`, `css/style.css`, `js/app.js`, `js/survey.js`.

### Modified

| File | Change |
|---|---|
| `server.js` | Main backend. Unified collector (removed duplicate `runNetworkScan`; `/api/scan` + `/api/network` both call `runFullScan`), non-Windows **501** guard, `dataQuality` block, injectable runner (`setRunner`) for tests, Host/Origin/auth guards, preflight, destructive-action `confirm:true` (+ admin-only `restore-dns-dhcp`), `/api/verify` + `buildVerification`, ping `rttRange`/`jitter`, product renames, `uncaughtException` log + `exit(1)`, `module.exports`, env overrides, refuse-to-start on non-loopback bind without token. |
| `js/analyzer.js` | Root-cause engine rewritten as UMD (browser global **kept** as `NetFaultAnalyzer`): stable finding `id`s, `evidenceRefs`, `disproveIf`, contradictions, no early returns, `insufficientData` contract, DNS per-server tests, `mtu`/`ipv6` unused-evidence notes, `pctToDbmNumber`. |
| `js/scenarios.js` | UMD wrapper so the file works in both Node and the browser; one `mob-coverage` tag reconciled `Physical Layer` → `Data Link Layer` to match the engine. No scenario data changed. |
| `package.json` | `name` → `netpulse`; scripts `start`, `test`, `capture-fixtures`, `clean-package`. No dependencies. |
| `config.json` | Added `"authToken": null` (required only for non-loopback binds). |
| `README.md` | NetPulse name; new **Backend API** and **Access control** sections; requirement, architecture table, engine rule, and troubleshooting rows updated. |
| `test_engine.js` / `test_history.js` / `test_survey.js` | Converted to thin shims that `require` the matching `test/*.test.js` suite (they now start their own temp server, so no manual `node server.js` and no writes to the real `data/`). |
| `HANDOFF_OPENCODE.md` | This file. |

### Added

| File | Purpose |
|---|---|
| `.gitignore` | Keeps `data/`, `reports/`, `Surveys/`, `fixtures/private/`, `dist-clean/`, `node_modules/` out of a repo. |
| `docs/API_CONTRACT.md` | Frozen HTTP/JSON contract for the UI build. |
| `docs/PRIVACY_CLEANUP.md` | How to keep real SSID/BSSID/MAC/GPS out of shares; `git rm --cached` recipe; clean-package + sanitizer usage. |
| `test/helpers/server.js` | Spawns `server.js` on a free port with **temp** data dirs; readiness probe tolerates auth. |
| `test/engine.test.js` | 15 scenarios with explicit expected id/status/headline, plus engine edge cases. |
| `test/parsers.test.js` | Parser fixtures + collector behavior via injected runner. |
| `test/verify.test.js` | `buildVerification` verdicts from fixtures. |
| `test/api.test.js` | Guards (Host/Origin/auth), action confirm, 501, verify endpoint, live scan (skipped unless enabled). |
| `test/history.test.js` | History CRUD + report writing into temp dirs. |
| `test/survey.test.js` | Survey CRUD + all export formats round-trip. |
| `test/privacy.test.js` | `.gitignore` entries, fixtures carry only documentation values, sanitizer behavior, tests use temp dirs. |
| `fixtures/commands/*.txt` | 16 hand-written, invented command outputs for parser tests. |
| `fixtures/scans/verify-pairs.json` | Seeded before/after scan pairs for the five verify verdicts. |
| `fixtures/private/.gitkeep` | Placeholder so the ignored folder exists. |
| `scripts/make-clean-package.js` | Copies the project to `dist-clean/` **without** private data (`--force` only removes the generated `dist-clean/`). |
| `scripts/capture-fixtures.js` | Windows-only: runs real commands and stores **sanitized** fixtures; refuses to write unmasked output. |

---

## 3. Acceptance criteria

Legend: **VERIFIED** (demonstrated), **NOT VERIFIED** (not demonstrated here),
**FAILED**.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| AC1 | No npm dependencies; tests use Node core `node:test`/`node:assert` (v18+) | **VERIFIED** | `package.json` has `"dependencies": {}`; `npm test` runs offline. |
| AC2 | One collector: `/api/scan` and `/api/network` share `runFullScan` | **VERIFIED** | `server.js` route + code comments; both exercised by tests. |
| AC3 | Engine: stable ids, `evidenceRefs`, `disproveIf`, `insufficientData` contract | **VERIFIED** | `test/engine.test.js` (all findings have id/evidenceRefs/disproveIf; insufficient-data cases). |
| AC4 | Guards: Host allow-list, Origin, auth-on-non-loopback, action `confirm:true` | **VERIFIED** | `test/api.test.js`: 403 `HOST_NOT_ALLOWED`, 403 `ORIGIN_NOT_ALLOWED`, 401 `AUTH_REQUIRED`, 400 `CONFIRM_REQUIRED`, 400 `INVALID_ADAPTER`. |
| AC5 | Non-Windows live scan → 501 `UNSUPPORTED_PLATFORM` | **VERIFIED** | `test/api.test.js` with `NETPULSE_FORCE_PLATFORM=linux` for GET and POST. |
| AC6 | `/api/verify` + `buildVerification` return the 5 verdicts | **VERIFIED** | `test/verify.test.js` + `test/api.test.js` (seeded fixtures). |
| AC7 | Tests never touch the real `data/`; fixtures sanitized | **VERIFIED** | `test/api.test.js` asserts the real `data/` signature is unchanged; `test/privacy.test.js`. |
| AC8 | Rename to NetPulse is metadata/user-visible strings only | **VERIFIED** | `GET /api/health` → `name: "netpulse"`; `package.json`; README; KML doc name asserted in `test/survey.test.js`. |
| AC9 | UI-owned files untouched | **VERIFIED** | `index.html`, `css/style.css`, `js/app.js`, `js/survey.js` not in the changed list. |
| AC10 | Docs: API contract + privacy cleanup written | **VERIFIED** | `docs/API_CONTRACT.md`, `docs/PRIVACY_CLEANUP.md`. |
| AC11 | `npm test` fails if the server cannot start | **VERIFIED** | Forced bad bind (`NETPULSE_BIND=256.256.256.256`) → `assert.ok(srv.ready, ...)` in `before()` failed → `EXITCODE=1`. |
| AC12 | Live Windows full scan produces a real analysis | **VERIFIED** | `NETPULSE_LIVE_SCAN=1 npm test` → `POST /api/scan on Windows (live)` passed (real collector, temp data dir). |
| AC13 | Parser correctness against real command shapes | **VERIFIED** | `test/parsers.test.js` (ping/jitter, ipconfig/APIPA, wlan, neighbors, arp, nslookup, tracert, locale-garbled). |

No criterion is FAILED. Nothing was left NOT VERIFIED.

---

## 4. Test suite

Run (PowerShell `.ps1` shim may be blocked - use `cmd`):

```bat
npm test                 :: or: npm.cmd test   or: cmd /c npm test
set NETPULSE_LIVE_SCAN=1 && npm test   :: adds the real Windows scan (~25 s)
```

`npm test` = `node --test "test/*.test.js"`. Note: on Node 24 the test runner
rejects a bare directory argument, hence the glob; the glob form works on 18+.

### Counts

| Run | tests | passed | failed | skipped |
|---|---|---|---|---|
| `npm test` (default, Windows) | 77 | 76 | 0 | 1 |
| `NETPULSE_LIVE_SCAN=1 npm test` (Windows) | 77 | 77 | 0 | 0 |

The single default skip is `POST /api/scan on Windows (live)` - it skips with
reason `set NETPULSE_LIVE_SCAN=1 to run the real scan` on Windows and with
`requires win32` on any other platform.

Legacy entry points (each runs the matching suite and exits non-zero on failure):

| Command | Result |
|---|---|
| `node test_engine.js` | 28 pass / 0 fail |
| `node test_history.js` | 3 pass / 0 fail |
| `node test_survey.js` | 3 pass / 0 fail |

Per-file suites: engine, parsers, verify, api, history, survey, privacy.

---

## 5. Windows-only limitations

- **The live collector is Windows-only.** It shells out to `netsh wlan`,
  `netsh interface`, `ipconfig /all`, `ping`, `nslookup`, `tracert`, `arp`,
  `route`. Any non-Windows platform gets **501** `UNSUPPORTED_PLATFORM` from
  `/api/scan` and `/api/network` (tested with `NETPULSE_FORCE_PLATFORM`).
- **The only test that skips is the live Windows scan.** On non-Windows it
  reports skip reason `requires win32`. Everything else runs from fixtures and
  is platform-independent.
- **Admin checks** (`/api/preflight` `isAdmin`, admin-only `restore-dns-dhcp`)
  use Windows facilities (`net session`); behavior on non-Windows is "not admin".
- **`scripts/capture-fixtures.js` refuses to run** off Windows.
- **Location permission**: when Windows Location is off, `netsh wlan` returns no
  data; the collector sets `dataQuality.locationPermissionBlocked` and the engine
  surfaces `location-permission-blocked` instead of a false WiFi fault.
- **Mobile RSRP** is not obtainable from a PC; Mobile mode is simulation-only.
- **Locale**: on a non-English Windows the command output may not parse; the
  collector degrades to `insufficientData` rather than inventing faults
  (`locale-garbled.txt` fixture covers this).
- No CI is configured, and none could run the live tests off Windows.

---

## 6. Deviations from the original plan / contract

- **`pctToDbm` is documented as an estimate.** Windows only exposes signal as a
  0-100 percent, so `pctToDbmNumber` uses a linear map (`100 % → -50 dBm`,
  `50 % → -70 dBm`) and the human string is labelled `approx`. It is not a
  measured dBm.
- **Interference rule threshold is a 60 ms heuristic** on the RTT spread
  (`rttRange` when present, else `jitter`). Documented as a heuristic, not a
  calibrated value.
- **`restore-dns-dhcp` is admin-gated** (HTTP 403 `ADMIN_REQUIRED` when not
  elevated). The pre-existing `flush-dns` / `dhcp-renew` are unchanged.
- **`js/scenarios.js` `mob-coverage` tag** was reconciled `Physical Layer` →
  `Data Link Layer` to match what the engine reports (consistency, not new data).
- **Server defaults to loopback** (`bindHost: 127.0.0.1`). Exposing it on a LAN
  now **requires** `authToken` and the `X-NetPulse-Token` header; the server
  refuses to start on a non-loopback bind without a token.
- **`/api/network` is retained** as an alias of the scan pipeline for the legacy
  UI (same collector/data) but, unlike `/api/scan`, it does not write history.
- **`test/` is the canonical suite**; the three root scripts are now shims.

---

## 7. Requests for Antigravity (UI owner)

Please keep the JS global `NetFaultAnalyzer` and all existing `/api` paths. Then:

1. **Identity / metadata**: show the product name as **NetPulse** (window title,
   header, report/KML document names). Do not rename the `NetFaultAnalyzer`
   global or any `/api` path. Remaining user-visible `NetPlus AI` strings live in
   the UI-owned files (and must be changed by you): `js/app.js` - i18n key
   `home-title` (line ~70), the diagnosis report title/heading/footer
   (lines ~1061-1072), and the survey report title/heading/footer
   (lines ~1222-1238); `js/survey.js` - survey report title/heading/footer
   (lines ~720-737). The one `NetPlusAISpeedTest...` string in `server.js` is an
   internal speedtest byte pattern, not user-visible, and is left as-is.
2. **Preflight first**: call `GET /api/preflight` before a scan and handle
   `NETPULSE`-relevant fields (platform, `isAdmin`, `wlanAvailable`,
   `locationPermission`). On non-Windows, show that the live scan is
   unavailable instead of calling `/api/scan`.
3. **Scan + dataQuality**: prefer `POST /api/scan`. If the response is **501**
   `UNSUPPORTED_PLATFORM`, switch to Simulation Lab. If `data.analysis.insufficientData`
   is true, show the "Insufficient data to diagnose" state (not a fault list).
4. **Findings**: render the new fields - `finding.id`, `evidenceRefs`,
   `disproveIf` - and the top-level `contradictions` array when present.
5. **Verify-fix loop**: add a "Verify fix" action that compares two history ids
   with `POST /api/verify { beforeId, afterId }` and renders `verdict`, `metrics`
   (with `direction`), `resolvedFindingIds`, `newFindingIds`, `reasons`.
6. **Destructive actions**: send `confirm: true` on `/api/action` calls (the
   server returns **400** `CONFIRM_REQUIRED` otherwise). Surface **403**
   `ADMIN_REQUIRED` for `restore-dns-dhcp`.
7. **Remote access**: if you ever change `bindHost` off loopback, set
   `authToken` in `config.json` and send `X-NetPulse-Token` on every `/api`
   request; the server will not start without a token and will answer **401**
   `AUTH_REQUIRED` for missing/wrong tokens.

---

## 8. Remaining risks

- **Historical exposure**: if `data/`, `reports/`, `Surveys/` or
  `fixtures/private/` were ever committed, emailed, or zipped before the
  `.gitignore` existed, those copies still contain real SSID/BSSID/MAC/GPS.
  `.gitignore` cannot recall them (see `docs/PRIVACY_CLEANUP.md`).
- **Heuristic thresholds** (interference 60 ms spread, congestion bands) may
  misfire on unusual links; they are documented as heuristics.
- **`pctToDbm` is an approximation**, not a measured RSSI.
- **Live scan reliability** depends on Windows tools, admin rights, and locale;
  missing/garbled output intentionally degrades to `insufficientData`.
- **Mobile RSRP** cannot be measured on a PC; Mobile mode stays simulation-based.
- **No non-Windows CI**: the 501 path is unit-tested, but real diagnostics cannot
  be verified off Windows.
- **Report PDF** is produced by a minimal hand-rolled writer; complex HTML may
  render imperfectly (the HTML report path is the source of truth).
- Tests spawn real child servers; on a very slow/loaded machine the readiness
  probe could time out (20 s) - it fails loudly rather than hanging.

---

## 9. First 3 integration tests to add when the UI lands

1. **Boot & identity**: load `index.html`, assert `GET /api/health` returns
   `name === "netpulse"`, and that `GET /api/preflight` returns a platform and
   the three booleans (`isAdmin`, `wlanAvailable`) plus a `locationPermission`
   value. Fail the test if the page shows any error banner.
2. **Run Full Diagnostics end-to-end**: from the UI, click "Run Full Diagnostics"
   and assert the resulting `POST /api/scan` response has `ok === true`,
   `data.analysis` with a `status`, and a `data.dataQuality.commands` array. If
   `data.analysis.insufficientData` is true, assert the UI shows the
   "Insufficient data" state instead of a fault list.
3. **Fix + verify loop**: run a scan, perform a fix action with `confirm: true`
   (assert no `CONFIRM_REQUIRED`), run a second scan, then call
   `POST /api/verify { beforeId, afterId }` and assert the UI renders one of the
   five verdicts with at least one metric row and its `direction`.

