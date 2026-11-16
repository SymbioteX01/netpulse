# NetPulse
### Network Fault Diagnosis, Root Cause Analyzer & Wi-Fi Site Survey
#### Data Communication Project (3 Credits / 30 Marks)

---

## What is this?

This application scans your **real network** - WiFi signal strength, ping latency,
packet loss, DNS, traceroute path - then analyzes the data to identify the fault
and its **ROOT CAUSE** (with OSI layer, severity, confidence % and a fix).

The **Simulation Lab** covers 3 modes: **WiFi Hotspot**, **LAN Cable**, and
**Mobile Internet (4G/5G)**. The **live** scanner reports `wifi` or `lan`; a live
cellular/mobile mode is not implemented, so Mobile is simulation-only.
It includes 15 pre-built scenarios for demos and viva preparation.

**Wi-Fi Site Survey (Tab 3):** capture GPS-located survey points with live WiFi details,
real internet speed tests (download/upload/ping/jitter), save/edit/delete survey history,
visualize the coverage on a map and heatmap (with optional floor-plan image), signal timeline,
and export everything to CSV / Excel / JSON / PDF / **KML** under `Surveys/<project>/`.

---

## How to Run (2 steps)

```
Step 1:  double-click start.bat   (or in cmd: node server.js)
Step 2:  Your browser opens automatically (or go to http://127.0.0.1:3000)
```

Requirement: Node.js (v18+) only - **no npm install, no external packages**. The
automated test suite uses Node's built-in `node:test` runner (v18+):

```bat
npm test        :: engine + parsers + collector + API + history + survey + privacy
```

(`npm`'s `.ps1` shim can be blocked by a PowerShell execution policy; if so use
`npm.cmd test` or `cmd /c npm test`.) The three original scripts still work:
`node test_engine.js`, `node test_history.js`, `node test_survey.js` - each now
starts its own throwaway server on a free port with a temp data dir, so no manual
`node server.js` step and no writes to the real `data/`.

### What you will see

- **Troubleshoot (primary tab — start here):** Guided 5-step flow: **Scan → Diagnose → Fix → Verify → Report**.
  - **Preflight banners:** non-blocking alerts for unsupported platform, Location permission
    blocked (Windows 11 24H2 — shows exact Settings path), not running as Administrator, and
    per-scan data-quality warnings.
  - **Source badge:** every result shows exactly one badge — `LIVE` (real scan), `SIMULATED`
    (Simulation Lab), or `REPLAY` (history). Simulated results can never look live.
  - **Evidence panel per finding:** evidence text, collapsible raw evidence, `disproveIf` note,
    and `evidenceRefs` chips linking back to exact scan fields.
  - **Fix confirmation modal:** plain-language explanation, connection-drop warning for DHCP
    renew, undo instructions, and an explicit Confirm click. Admin-required message shown
    verbatim; action never retried automatically.
  - **Before/after verification:** re-scan + `/api/verify` → verdict (resolved / improved /
    unchanged / worse / inconclusive), per-metric table, resolved/new findings. Icon + text —
    never color alone.
  - **Evidence report with redaction:** Redact toggle (default ON) masks SSID, BSSID, MAC and
    GPS before report is generated in the browser.
- **Live Scan:** Click "Run Full Diagnostics" → real commands execute →
  topology diagram, signal gauge, traceroute graph, fault panel (root cause + evidence).
  Plus: **Scan History** (auto-saved, compare two scans, fault-stats pie chart),
  **Fix Actions** (DHCP renew / DNS flush), **Diagnosis PDF**, copy evidence, topology PNG,
  gateway vendor (OUI lookup).
- **Simulation Lab:** Select connection type (WiFi/LAN/Mobile) → pick one of
  15 scenarios → run. Results are badged `SIMULATED` and never stored as live history.
- **Survey & Mapping:** "Scan & Measure" → live WiFi details + internet speed test
  (opt-in one-time disclosure — contacts speed.cloudflare.com) + GPS position →
  "Save Survey Point" → history, colored map, signal heatmap, timeline, compare, export
  to CSV/XLSX/JSON/PDF/KML.
- **Report:** Full diagnosis report (summary + findings with evidence + before/after table
  when present + neighbors + traceroute). Print, Save to File, Save PDF, Redact toggle.
- **Theory:** OSI mapping, RSSI concept, engine rules, viva questions.

Extra: **English / Hindi** language toggle and **Light / Dark** theme toggle in the top bar.
See `docs/DEMO.md` for the 3-minute demo walkthrough and pre-flight checklist.

---

## Real Diagnostics (Live Scan)

| Command | Real Data |
|---|---|
| `netsh wlan show interfaces` | Signal %, SSID, channel, auth, radio type, rates |
| `netsh wlan show networks mode=bssid` | Signal scan of neighboring networks |
| `netsh interface show interface` | Link up/down status |
| `ipconfig /all` | IP, gateway, subnet, DHCP, MAC, APIPA detection |
| `ping` gateway / 8.8.8.8 / 1.1.1.1 | Real RTT, loss %, jitter (computed) |
| `nslookup google.com` + 8.8.8.8 + 1.1.1.1 | Real DNS server, lookup time + per-server DNS latency |
| `tracert -d -h 15 8.8.8.8` | Real hop-by-hop path + per-hop latency/loss |
| `arp -a` | ARP table, gateway MAC (+ **vendor via OUI lookup** - a small built-in table; unknown vendors show as Unknown) |
| `route print 0.0.0.0` | Default gateway (fallback) |
| `ping -f -l 1472` gateway | **MTU discovery** (binary-probes down to 500; needs a reachable gateway) |
| `ping -6 ::1` / IPv6 ping | **IPv6 stack test** |
| `ipconfig /flushdns`, `/release`, `/renew` | **Fix Actions** from the UI |

---

## Architecture

```
Browser UI (index.html + js/)
    │  HTTP/JSON
    ▼
server.js (Node.js - core modules only)
    │  execFile (Windows commands)
    ▼
Real Network Diagnostics
```

| File | Role |
|---|---|
| `server.js` | Command runner + parsing + static file server + survey CRUD/export + speedtest + scan history + fix actions + report/PDF/KML API |
| `js/analyzer.js` | **Root Cause Engine** - signature extraction + rules + confidence % |
| `js/scenarios.js` | 15 simulation scenarios (LAN 5 / WiFi 5 / Mobile 5) |
| `js/survey.js` | Wi-Fi Survey client - GPS, speed test, history, map, heatmap, floor plan, timeline, export, HTML report |
| `js/app.js` | UI logic + Canvas topology/gauge/traceroute + history UI + i18n (EN/HI) + themes + report builder |
| `css/style.css` | Dark theme UI + light theme |
| `config.json` | Settings: port, bind host (`bindHost`), `authToken`, ping count, DNS servers, history limit |
| `start.bat` | One-click launcher |
| `Surveys/` | Auto-generated survey exports (CSV / XLSX / JSON / PDF / KML), one folder per project |
| `reports/` | Auto-generated diagnosis reports (HTML + PDF) |
| `data/` | Runtime data: `surveys.json`, `history.json` (+ `data/backup/`) |
| `docs/API_CONTRACT.md` | Frozen HTTP/JSON contract for the UI build |
| `docs/PRIVACY_CLEANUP.md` | How the real SSID/BSSID/MAC/GPS data stays out of shares |
| `docs/EVALUATION.md` | Blank template for controlled-fault runs (`scripts/eval-faults.js`) |
| `docs/MANUAL_WINDOWS_CHECKLIST.md` | Step-by-step checklist for the Windows demo laptop |
| `RELEASE_READINESS.md` | Independent release audit (environment, commands, findings, verdict) |
| `test/*.test.js` | Automated suite (`npm test`): engine, rules, parsers/collector, API, integration, startup, history, survey, privacy, verify |
| `fixtures/commands/` | Hand-written, sanitized command output for parser tests |
| `scripts/capture-fixtures.js` | Windows-only: run real commands and store **sanitized** fixtures |
| `scripts/make-clean-package.js` | Build a shareable copy with no private data (`--force` only removes `dist-clean/`) |
| `test_engine.js` / `test_history.js` / `test_survey.js` | Legacy entry points that now run the matching `test/*.test.js` suite |
| `structur.txt` | Project roadmap & documentation |

---

## Backend API (what the UI calls)

The server is the only process that runs Windows commands; the UI is pure
HTTP/JSON. Every response has `ok`, and errors add a stable `code` string. The
full contract is in `docs/API_CONTRACT.md`. The endpoints a UI build needs:

| Method + path | Purpose |
|---|---|
| `GET /api/health` | Liveness + identity (`name: "netpulse"`). |
| `GET /api/preflight` | Environment probe: platform, Node version, admin, WLAN availability, Location permission. Call this before a scan. |
| `GET/POST /api/network` | Legacy alias of the scan pipeline (same collector and data, but it does **not** write history). Kept for the existing UI. |
| `GET/POST /api/scan` | Run the full collector (Windows only; non-Windows returns **501** `UNSUPPORTED_PLATFORM`). Saves to history and returns `{ ok, data }`. `POST` is preferred. |
| `GET /api/history`, `GET/DELETE /api/history/:id` | Scan history list/item/delete. |
| `POST /api/verify` | Compare two stored scans (`{ beforeId, afterId }`) and return a `verdict` (`resolved` / `improved` / `unchanged` / `worse` / `inconclusive`) plus per-metric directions. |
| `POST /api/action` | Fix actions (`flush-dns`, `dhcp-renew`, admin-only `restore-dns-dhcp`). Requires `confirm: true` (otherwise **400** `CONFIRM_REQUIRED`). |
| `GET/POST/PUT/DELETE /api/surveys...`, `POST /api/export` | Survey CRUD + CSV/XLSX/JSON/PDF/KML export. |
| `POST /api/report` | Write a diagnosis HTML/PDF report. |

Each scan carries a **`dataQuality`** block describing the collector itself: the
per-command list, any `warnings`, whether the Location permission blocked the
WLAN commands, and `coreCommandsFailed`. This is how a *collector* failure is
told apart from a *network* fault - when the core commands fail (or there is no
usable evidence) the engine returns `insufficientData: true` with
`findings: []` instead of guessing.

### Access control

Requests are checked before anything runs:

- **Host allow-list** - the `Host` header must be `localhost` / `127.0.0.1` /
  `[::1]` (on the configured port) or the configured concrete `bindHost`;
  anything else is **403** `HOST_NOT_ALLOWED` (this stops DNS-rebinding).
- **Origin** - a cross-site `Origin` (or `Sec-Fetch-Site: cross-site`) is
  **403** `ORIGIN_NOT_ALLOWED`.
- **Auth only when exposed** - when `bindHost` is *not* loopback, `config.json`
  **must** set `authToken` (the server refuses to start without it) and every
  `/api` request must send `X-NetPulse-Token: <authToken>`; missing/wrong is
  **401** `AUTH_REQUIRED`. The token is never logged.
- **Destructive actions** need an explicit `confirm: true`.

---

## Diagnosis Engine (How root cause is found)

1. **Data collection** - diagnostic JSON from real commands
2. **Signature extraction** - loss %, jitter, signal %, APIPA, DNS status, hop loss
3. **Rule matching** - each signature has rules, weighted for a confidence score
4. **OSI layer mapping** - each root cause is mapped to a layer (L1 Physical to L7 Application)
5. **Ranking + severity** - Critical/High/Medium/Low/Healthy + health score %

### Key rules (analyzer.js)

- APIPA 169.254 IP + no gateway → **DHCP server unreachable** (L3)
- 100% gateway loss → **Physical link down** (L1)
- Internet fails + gateway OK → **ISP / WAN issue** (L3)
- Ping OK + DNS fails → **DNS misconfiguration** (L7)
- Signal < 25% → **Critical weak signal / range** (L2)
- Signal OK + RTT spread (range, else jitter) > 60 ms (WiFi) → **Interference / channel congestion** (L2) - heuristic threshold
- Traceroute: 100% loss at hop N → **Fault on that router/link** (L3)
- Internet loss 1-40% **and** average RTT > 150 ms → **Congestion** (L3)
- 40-89% gateway loss → **Gateway unstable - possible duplex mismatch or bad cable** (L2; duplex is *not* measured)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Server does not start | Check: `node --version` (v18+ required) |
| Signal % is missing | Run `netsh wlan show interfaces` manually to verify |
| Scan is slow (~25s) | Normal - pings + DNS tests + traceroute run sequentially |
| Scan returns 501 `UNSUPPORTED_PLATFORM` | The live collector is Windows-only. On another OS use the Simulation Lab; the UI still loads. |
| Ethernet disconnected | Connect the LAN cable or use WiFi (both are reported) |
| Mobile RSRP | Not available directly from a PC - Mobile mode is simulation-based (attach a phone hotspot over WiFi for a real signal) |
| Diagnosis says "Insufficient data" | The collector could not get usable evidence (see the scan's `dataQuality` block) - not necessarily a network fault |
| Port busy | Change `port` in config.json |
| Server should be LAN-accessible | Set `bindHost` in config.json to a concrete address (default `127.0.0.1`), and you **must** also set a strong `authToken` - the server refuses to start on a non-loopback bind without one, and the UI must then send `X-NetPulse-Token` |
| Data not showing | Try a different browser, or hard refresh (Ctrl+Shift+R) |
| Tests fail | Use Node 18+; run `npm test` (or `cmd /c npm test`). Live-scan tests are Windows-only and skip as `requires win32` elsewhere |

---

## Viva Preparation

- Read the Theory tab and `docs/theory.txt`
- Signal 84% = adapter RSSI (dBm) mapped by Windows to a 0-100 scale - not compared to any device
- Demo sequence: Live Scan first, then Simulation Lab, then save the report
- To run the project: only `node server.js`