# NetPulse API Contract

Status: **frozen for the Antigravity UI build** (backend owner: OpenCode).
Base URL: `http://127.0.0.1:<port>` (default port `3000`).
All request/response bodies are `application/json; charset=utf-8`.
All responses carry `ok: true|false`. Errors additionally carry a stable
machine-readable `code` and a human `error` string (and sometimes `hint`).

```
{ "ok": false, "code": "SOME_CODE", "error": "human readable", "hint": "optional" }
```

This contract lists every endpoint the UI may use. Paths and the JS global
`NetFaultAnalyzer` are unchanged from the legacy build; only some user-visible
metadata changed to **NetPulse**.

---

## 0. Conventions

| Term | Meaning |
|---|---|
| `scan` | One full diagnostic data set (result of the collector). |
| `analysis` | Root-cause engine output for a scan (`NetFaultAnalyzer.analyze(data)`). |
| `dataQuality` | Per-scan collector health block (see 3.2). Never confuse a collector failure with a network fault. |
| `finding` | One diagnosis entry (see 3.4). |
| `insufficientData` | Set by the engine when there is not enough evidence to diagnose. |

### 0.1 Request guards (apply to EVERY `/api/*` request)

1. **Host allow-list.** The `Host` header must be one of
   `localhost[:port]`, `127.0.0.1[:port]`, `[::1][:port]` on the configured
   port, plus the configured `bindHost` when it is a concrete (non-wildcard)
   address. Anything else -> **403** `HOST_NOT_ALLOWED`.
2. **Origin.** When the `Origin` header is present it must be same-origin
   (`localhost` / `127.0.0.1` / `[::1]` on the configured port). Otherwise ->
   **403** `ORIGIN_NOT_ALLOWED`. (`Sec-Fetch-Site: cross-site` is also
   rejected with 403.)
3. **Authentication.** Only active when `config.bindHost` is not loopback.
   Then `config.authToken` **must** be set (the server refuses to start
   otherwise) and every `/api` request must send
   `X-NetPulse-Token: <authToken>` (constant-time compare). Missing/wrong ->
   **401** `AUTH_REQUIRED`. The token is never logged.
4. Static files keep the strict allow-list (`/`, `/index.html`, `/css/*`,
   `/js/*`, root `.png`/`.ico`) and the path-traversal guard.

### 0.2 Test/ops environment overrides

| Env var | Effect |
|---|---|
| `NETPULSE_PORT` | Override `config.port` (tests use a free port). |
| `NETPULSE_DATA_DIR` | Override the `data/` directory (tests use a temp dir). |
| `NETPULSE_NO_OPEN=1` | Do not open a browser on startup. |
| `NETPULSE_FORCE_PLATFORM` | Test-only seam: pretend `process.platform` is this value (used to exercise the non-Windows 501 path). |
| `NETPULSE_BIND` | Override `config.bindHost`. A non-loopback value without `NETPULSE_AUTH_TOKEN`/`config.authToken` refuses to start. |
| `NETPULSE_AUTH_TOKEN` | Override `config.authToken` (non-loopback binds). |
| `NETPULSE_SURVEYS_DIR` | Override the `Surveys/` directory (tests use a temp dir). |
| `NETPULSE_REPORTS_DIR` | Override the `reports/` directory (tests use a temp dir). |
| `NETPULSE_LIVE_SCAN=1` | Run the real Windows scan in tests (otherwise the live-scan test is skipped). |

---

## 1. `GET /api/health`

Liveness + identity.

```json
{ "ok": true, "name": "netpulse", "version": "1.0.0" }
```

---

## 2. `GET /api/preflight`

Cheap environment probe (no full scan, a few hundred ms).

```json
{
  "ok": true,
  "platform": "win32",
  "nodeVersion": "v24.19.0",
  "isAdmin": false,
  "locationPermission": "ok",
  "wlanAvailable": true
}
```

| Field | Meaning |
|---|---|
| `platform` | `process.platform`. |
| `isAdmin` | `true` when `net session` exits 0 (elevated). `false` otherwise. |
| `locationPermission` | `"ok"` / `"blocked"` / `"unknown"`. `blocked` when `netsh wlan` returns the *need location permission* message. |
| `wlanAvailable` | `true` when the WLAN service returned a parseable interface list. |

---

## 3. Scan endpoints

### 3.1 `POST /api/scan` (preferred) and `GET /api/scan` (legacy)

Both run the **same collector**. The POST form is preferred because GET must
not have side effects; the GET form is kept for backward compatibility and
still writes history (deprecated).

* `POST /api/scan` — collects, saves to history, returns the scan.
* `GET /api/scan` — same, kept for the legacy UI.
* `GET /api/network` — same collector, returns the scan **without** writing
  history (used by the survey tab).
* A single global scan lock prevents concurrent scans.

**200**

```json
{
  "ok": true,
  "data": {
    "id": "Smvcg9i02ecwb",
    "timestamp": "2026-10-17T13:00:00.000Z",
    "mode": "wifi",
    "wifi": { "available": true, "connected": true, "data": { "ssid": "...", "signalPct": 84, "channel": "6", "band": "2.4 GHz" } },
    "neighbors": [],
    "interfaces": [],
    "ipconfig": [],
    "arp": [],
    "dns": { "server": "dns.google", "address": "8.8.8.8", "status": "ok", "lookupMs": 28, "tests": [] },
    "mtu": { "payload": 1472, "mtu": 1500, "note": null },
    "ipv6": { "enabled": true, "loopbackOk": true, "internetOk": false },
    "trace": { "hops": [] },
    "connectivity": {
      "gateway": "192.168.1.1",
      "hasGateway": true,
      "gatewayReachable": true,
      "internetReachable": true,
      "pings": { "gateway": { "...": "see 3.3" } },
      "activeIface": { "name": "Wi-Fi", "ipv4": "192.168.1.5", "mac": "...", "apipa": false }
    },
    "scanDurationMs": 21000,
    "dataQuality": { "...": "see 3.2" },
    "analysis": { "...": "see 3.4" }
  }
}
```

**Non-Windows host -> 501**

```json
{
  "ok": false,
  "code": "UNSUPPORTED_PLATFORM",
  "error": "Live network diagnostics require Windows (process.platform = linux).",
  "hint": "Run NetPulse on Windows, or use the Simulation Lab scenarios."
}
```

**Concurrent scan -> 409** `{ "ok": false, "code": "SCAN_BUSY", "error": "A scan is already running" }`

**Collector crash -> 500** `{ "ok": false, "code": "SCAN_FAILED", "error": "..." }`

### 3.2 `dataQuality`

Present on every scan (`/api/scan` and `/api/network`).

```json
{
  "platform": "win32",
  "commands": [
    { "name": "netsh wlan show interfaces", "ok": true, "emptyParse": false, "error": null },
    { "name": "ipconfig /all", "ok": true, "emptyParse": false, "error": null }
  ],
  "warnings": [],
  "locationPermissionBlocked": false,
  "coreCommandsFailed": []
}
```

| Field | Meaning |
|---|---|
| `commands[].ok` | Process exited 0. |
| `commands[].emptyParse` | The collector could not parse anything meaningful from stdout. |
| `warnings[]` | Human strings, e.g. location-permission blocked, missing gateway. |
| `locationPermissionBlocked` | `netsh wlan` was refused because Location permission is off. |
| `coreCommandsFailed[]` | Names of essential commands (`ipconfig`) that failed AND parsed empty. |

The engine returns `insufficientData: true` when `coreCommandsFailed` is
non-empty, or when there is no gateway evidence and no ping was sent.

### 3.3 Ping object

```json
{
  "sent": 5, "received": 5, "lost": 0, "lossPct": 0,
  "unreachable": 0, "timeouts": 0,
  "min": 2, "max": 4, "avg": 3,
  "jitter": 0.8,
  "rttRange": 2,
  "times": [2, 3, 3, 2, 4],
  "durationMs": 2600
}
```

* `rttRange` = `max - min` (kept as a separate, explicit field).
* `jitter` = mean absolute difference of consecutive RTT samples
  (RFC 3550-style). **Changed**: it used to be the range. `rttRange` keeps the
  old meaning for anyone who relied on it.

### 3.4 `analysis` (engine output)

```json
{
  "findings": [
    {
      "id": "gateway-link-down",
      "title": "Gateway Link Down",
      "rootCause": "100% packet loss to the default gateway ...",
      "layerNum": 1,
      "layer": { "name": "Physical", "label": "Layer 1 - Physical" },
      "severity": "Critical",
      "confidence": 94,
      "evidence": "ping ...",
      "evidenceRefs": [ { "source": "pings.gateway", "key": "lossPct", "value": 100 } ],
      "disproveIf": "Any ping to the gateway succeeds.",
      "fix": "..."
    }
  ],
  "osiLayer": { "name": "Physical", "label": "Layer 1 - Physical" },
  "healthScore": 55,
  "status": "Critical",
  "headline": "Gateway Link Down",
  "topFindingId": "gateway-link-down",
  "contradictions": [],
  "unusedEvidence": [ { "key": "mtu", "reason": "..." } ],
  "insufficientData": false,
  "generatedAt": "2026-10-17T13:00:20.000Z"
}
```

Rules the UI can rely on:

* `status` is one of `Critical|High|Medium|Low|Healthy|Insufficient Data`.
* When `status === "Healthy"`, `headline === "No fault detected"` and
  `topFindingId === "no-fault"` even if informational Low findings exist.
* When `insufficientData === true`: `findings` is **empty** (zero faults),
  `healthScore` is `null`, `status === "Insufficient Data"`,
  `headline === "Insufficient data to diagnose"`.
* `findings[].id` is a stable slug (safe to switch on).
* Every finding has `evidenceRefs` (`{source,key,value}`) and a one-sentence
  `disproveIf`.

Stable finding ids: `no-fault`, `gateway-link-down`, `gateway-unstable`,
`dhcp-unreachable`, `no-interface`, `wifi-connection-failed`,
`critical-weak-signal`, `weak-signal`, `wifi-interference`,
`channel-overlap`, `network-congestion`, `severe-degradation`,
`high-latency`, `internet-unreachable`, `dns-resolution-failure`,
`dns-default-failing`, `dns-all-failing`, `slow-dns`,
`router-link-down`, `icmp-filtered`, `mtu-reduced`, `cellular-outage`,
`lan-cable-not-connected`, `location-permission-blocked`,
`collector-warning`.

### 3.5 `POST /api/verify`

Compare two history scans.

Request:

```json
{ "beforeId": "S...", "afterId": "S..." }
```

**200**

```json
{
  "ok": true,
  "beforeId": "S...",
  "afterId": "S...",
  "verdict": "improved",
  "resolvedFindingIds": ["gateway-unstable"],
  "newFindingIds": [],
  "metrics": [
    { "key": "healthScore",   "label": "Health score",        "before": 80, "after": 95, "unit": "%",  "direction": "better" },
    { "key": "signalPct",     "label": "WiFi signal",         "before": 62, "after": 84, "unit": "%",  "direction": "better" },
    { "key": "gatewayLossPct","label": "Gateway packet loss", "before": 45, "after": 0,  "unit": "%",  "direction": "better" },
    { "key": "internetLossPct","label":"Internet packet loss","before": 30, "after": 0,  "unit": "%",  "direction": "better" },
    { "key": "internetAvgMs", "label": "Internet average RTT","before": 140,"after": 45, "unit": "ms", "direction": "better" },
    { "key": "jitterMs",      "label": "Internet jitter",     "before": 35, "after": 8,  "unit": "ms", "direction": "better" },
    { "key": "dnsLookupMs",   "label": "DNS lookup time",     "before": 60, "after": 30, "unit": "ms", "direction": "better" }
  ],
  "reasons": []
}
```

* `verdict` ∈ `resolved | improved | unchanged | worse | inconclusive`.
* `direction` ∈ `better | worse | same` (metric-level, not verdict-level).
* `reasons: string[]` explains an `inconclusive` verdict.

`inconclusive` is returned when either scan has `dataQuality` problems
(any failed core command, `locationPermissionBlocked`, or non-win32) or when
the two scans were taken on different adapters or different SSIDs.

**Errors:** `400 BAD_REQUEST` (missing ids), `404 NOT_FOUND` (unknown id).

---

## 4. `POST /api/action`

```json
{ "action": "flush-dns", "confirm": true }
```

`confirm` **must** be `true` -> otherwise **400** `CONFIRM_REQUIRED`.

| `action` | Extra field | Command(s) |
|---|---|---|
| `dhcp-renew` | — | `ipconfig /release`, `ipconfig /renew` |
| `flush-dns` | — | `ipconfig /flushdns` |
| `restore-dns-dhcp` | `adapter` (exact adapter name from a fresh `ipconfig`) | `netsh interface ip set dns name=<adapter> dhcp` |

All commands run via `execFile` with an **argument array** (never a shell
string). The adapter name is validated against a fresh `ipconfig` parse and
must match exactly, else **400** `INVALID_ADAPTER` and no command runs.

**200**

```json
{ "ok": true, "action": "flush-dns", "label": "DNS cache flush",
  "outputs": [ { "cmd": "ipconfig /flushdns", "ok": true, "out": "..." } ] }
```

**Not elevated -> 403** (elevation is required only for `restore-dns-dhcp`; `dhcp-renew` and `flush-dns` run unelevated)

```json
{ "ok": false, "code": "ADMIN_REQUIRED",
  "error": "This action needs Administrator rights.",
  "hint": "Restart the terminal as Administrator." }
```

Other error codes: `CONFIRM_REQUIRED`, `UNKNOWN_ACTION`, `INVALID_ADAPTER`.

---

## 5. Unchanged endpoints (still supported)

| Method(s) | Path | Notes |
|---|---|---|
| `GET` | `/api/history` | `{ok:true, list:[summary]}`; summary now also includes `status`, `healthScore`, `headline`. |
| `DELETE` | `/api/history` | clear all |
| `GET`/`DELETE` | `/api/history/:id` | full scan (`data.analysis` present) |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/surveys[/:id]` | survey CRUD (validated; see §5.1) |
| `POST` | `/api/surveys/batch` | live-survey batch save, one write (see §5.1) |
| `GET` | `/api/wifi/signal` | connected-AP Wi-Fi signal for the live tick (see §5.1) |
| `POST` | `/api/export` | csv/xlsx/json/pdf/kml |
| `POST` | `/api/report` | html/pdf report |
| `GET` | `/api/speedtest/data` | download bytes |
| `POST` | `/api/speedtest/upload` | upload + Mbps |

`/api/report`: `html` content is client-supplied and written to
`reports/report_*.html`. It is **not** executed by the server and is only
reachable by opening the local file; the write is size-limited (2 MB). See the
handoff for the trust analysis. The `pdf` branch serialises server-side fields
with PDF escaping.

### 5.1 Survey validation, batch save and live Wi-Fi signal

These extend the survey endpoints above. Validation is shared between the
server and the browser through `js/geo-core.js` (`window.NPGeo` /
`module.exports`), so the client and the wire enforce identical rules.

**Validated writes** — `POST /api/surveys` and `PUT /api/surveys/:id` run
`NPGeo.validateSurveyInput`. On failure: `400 { "ok": false, "code": "BAD_REQUEST", "error": "..." }`.

| Field | Rule |
|---|---|
| `lat` / `lng` | both finite numbers in range (`-90..90` / `-180..180`) and **not** exactly `0,0`, or both `null`. One without the other is rejected. |
| `signalPct` | number `0..100`, or `null`. A missing signal is **never** coerced to `0`. |
| `gpsAccuracyM` | finite number `>= 0`, or `null`. |
| `locationSource` | `"browser-geolocation"` / `"manual-map"` / `"manual-entry"` / `null`. |
| `timestamp` | a parseable ISO date string. |

Unknown/legacy fields are preserved. `PUT` is a **partial patch**: only the
supplied fields are validated and applied, so a patch carrying just
`locationName` leaves coordinates untouched, while an explicit
`{ "lat": null, "lng": null }` clears them. A `404 NOT_FOUND` is returned for an
unknown id.

**`POST /api/surveys/batch`** — one write for a whole live session.

* Request: `{ "sessionId": "...", "sessionName": "...", "points": [ ... ] }`.
* `200`: `{ "ok": true, "saved": <n>, "rejected": [ { "index": <i>, "errors": [ ... ] } ] }`.
* The whole request is `400` when `points` is not an array or exceeds **2000**
  points.
* Valid points are persisted with **exactly one** `writeSurveys()` call (one
  backup). `sessionId`/`sessionName` from the body fill in points that lack them.

**New survey fields** (written by the live survey; exports ignore them):

| Field | Meaning |
|---|---|
| `gpsAccuracyM` | GPS accuracy in metres (from the geolocation fix). |
| `locationSource` | `browser-geolocation` / `manual-map` / `manual-entry`. |
| `measurementMode` | `live-signal` for live-survey points. |
| `signalSource` | `netsh-wlan`. |
| `sessionId`, `sessionName` | live-survey session linkage. |

The CSV/XLSX/JSON/PDF/KML exports keep their frozen column order; these fields
do **not** add columns.

**`GET /api/wifi/signal`** — connected-access-point signal for the live tick.

```json
{
  "ok": true,
  "available": true,
  "connected": true,
  "ssid": "ExampleNet",
  "bssid": "02:11:22:33:44:55",
  "band": "2.4 GHz",
  "channel": "6",
  "signalPct": 82,
  "source": "netsh",
  "measuredAt": "2026-01-01T00:00:00.000Z",
  "reason": null
}
```

Runs **only** `netsh wlan show interfaces`. `reason` is one of `null`,
`"unsupported-platform"`, `"wlan-unavailable"`, `"location-blocked"`,
`"not-connected"`. `signalPct` is the CONNECTED AP's signal percentage (parsed
from `netsh`), `null` when it is not connected/known; `rssiDbm` and `distanceM`
are **derived** values, not reported by this endpoint. Nothing is fabricated on
non-Windows. Real invocations are spaced by at least 1&nbsp;second.

**Security headers** — `img-src` additionally allows
`https://tile.openstreetmap.org` (map tiles); `script-src` stays `'self'`. A
`Permissions-Policy: geolocation=(self)` header is sent.

---

## 6. Error-code index

| Code | HTTP | Meaning |
|---|---|---|
| `UNSUPPORTED_PLATFORM` | 501 | Live scan requested on non-Windows. |
| `SCAN_FAILED` | 500 | Collector threw. |
| `SCAN_BUSY` | 409 | A scan is already running. |
| `HOST_NOT_ALLOWED` | 403 | Bad `Host` header (DNS-rebinding guard). |
| `ORIGIN_NOT_ALLOWED` | 403 | Cross-origin request. |
| `AUTH_REQUIRED` | 401 | Missing/invalid `X-NetPulse-Token`. |
| `CONFIRM_REQUIRED` | 400 | `/api/action` without `confirm:true`. |
| `UNKNOWN_ACTION` | 400 | Unknown action name. |
| `INVALID_ADAPTER` | 400 | Adapter not in a fresh `ipconfig` parse. |
| `ADMIN_REQUIRED` | 403 | Action needs elevation. |
| `BAD_REQUEST` | 400 | Malformed body / missing fields. |
| `NOT_FOUND` | 404 | Unknown history id or survey point id. |
