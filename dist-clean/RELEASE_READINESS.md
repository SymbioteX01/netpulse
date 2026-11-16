# NetPulse — Release Readiness Audit

Independent integration / release review, performed **after** the OpenCode
(backend, engine, collector, tests) and Antigravity (UI) sessions. Every claim in
`HANDOFF_OPENCODE.md`, `HANDOFF_ANTIGRAVITY.md`, `README.md` and `docs/*` was
treated as **unverified** until reproduced here. Where a claim could not be
reproduced in this environment it is labelled **NOT VERIFIED** — it is not called
a failure, and not called a pass.

- Auditor role: independent integration / release engineer.
- Scope: reconcile the two sessions, reproduce their claims, fix integration
  bugs minimally, and produce this report.
- Repository: `C:\Users\Admin\Desktop\NETPLUS 20-08\Netplus`
- **Not a git repository** — there is no VCS, so no `git diff`/`git log` baseline
  exists and nothing was (or could be) committed. Comparisons were made against
  the working tree only. If the owner has a pre-change zip, that is the only way
  to produce a byte-level diff.

---

## 1. Verdict

**READY WITH CAVEATS.**

The application starts, serves the UI, passes its automated suite, and the
security/privacy controls behave as documented. Four genuine integration bugs
were found and fixed (see §5). The remaining open items are **environment /
manual** checks that this sandbox could not perform (Excel, Google Earth, a PDF
reader, an elevated prompt on the user's machine, and a live scan against the
real network), plus cosmetic documentation drift that was corrected.

There are **no P0 blockers**. See §9 for the defect list and §8 for the items the
owner must still check by hand.

<!-- FINAL_TEST_COUNTS -->

---

## 2. Environment and baseline

| Item | Value |
|---|---|
| Platform | `win32`, Windows 10.0.19045 (22H2) |
| Node.js | v24.19.0 |
| Package manager | npm (via `cmd /c npm.cmd`; PowerShell blocks `npm.ps1` on this host) |
| Project | single folder `Netplus\` under the working directory |
| VCS | none (not a git repository) |
| Browser available for smoke test | yes (desktop browser tool used) |
| Admin/elevation available | no (audit ran unelevated) |

**Handoffs present:** `HANDOFF_OPENCODE.md` **and** `HANDOFF_ANTIGRAVITY.md` both
exist, so the agreed stop-condition ("both handoffs missing → ask for consent")
did not apply and the audit proceeded.

**Contract authority:** `docs/API_CONTRACT.md` was treated as authoritative over
the handoffs wherever they disagreed (see §4, item 7).

### Syntax check — every JS file

```
node --check  on every .js file in js/, scripts/, test/ and test/helpers/  -> exit 0 for all
```

Result: **all files parse** (verified before and after the edits in §5).

---

## 3. Commands run and observed results

All commands were run from `C:\Users\Admin\Desktop\NETPLUS 20-08\Netplus`. The
suite uses the Node built-in test runner only; no new dependency was added.

| # | Command | Observed |
|---|---|---|
| 1 | `node --check <each .js>` | exit 0 for every file |
| 2 | `npm test` (`node --test "test/*.test.js"`) | see §4 |
| 3 | `NETPULSE_NO_OPEN=1 node server.js` | prints `Server running: http://localhost:3000`, listens on PID |
| 4 | security probe (`audit-probe.js`) | 19/19 checks pass (§6) |
| 5 | auth/refuse-start probe (`auth-probe.js`) | 4/4 checks pass (§6) |
| 6 | `node scripts/make-clean-package.js --force` | `dist-clean/` with no data/reports/backups/private (§7) |
| 7 | browser pass against a **temp** data dir | escaped SSID, no XSS, 0 console errors (§6) |

Test-run commands themselves are the pitfall: `node --test test/` (bare
directory) is rejected by Node 24. `package.json` correctly uses the glob form
`node --test "test/*.test.js"`, so `npm test` works.

---

## 4. Automated test results

<!-- TEST_TABLE -->

Existing suite files: `engine.test.js`, `collector.test.js`, `parsers.test.js`,
`api.test.js`, `history.test.js`, `survey.test.js`, `privacy.test.js`,
`verify.test.js`. New files added by this audit: `rules.test.js`,
`integration.test.js`, `startup.test.js`, `clean-package.test.js` (see §5).

**Honest counting rules applied:**

* A skipped test is reported as skipped and the reason is stated inline in the
  test file. The only intentional skip is the live Windows scan
  (`POST /api/scan on Windows (live)`), which requires `NETPULSE_LIVE_SCAN=1`.
* `npm test` is required to **exit 0** on success and **non-zero** on failure.
  `test/startup.test.js` proves the failure path: when the server cannot bind,
  `startServer()` resolves `ready === false` with a non-zero child exit, and every
  suite's `before()` asserts `srv.ready`, so `npm test` fails. That test was run
  and passes.

---

## 5. Integration bugs found and fixed

Only four genuine code/privacy bugs were found. Each was fixed minimally and is
covered by a new test.

### 5.1 P1 — Troubleshoot metrics table read the wrong field (UI ↔ engine)

`js/app.js` `renderVerifyResult()` rendered the metric name from `m.metric`, but
the server and `docs/API_CONTRACT.md` §3.5 send metric objects as
`{ key, label, unit, before, after, direction }`. The report builder already used
`m.label` correctly, so the two views of the same data disagreed. Every row in
the Troubleshoot before/after table showed `--` for the metric name.

* Fix: `m.metric || '--'` → `m.label || m.key || '--'`.
* Tests: `test/integration.test.js` locks the fix statically; `test/api.test.js`
  asserts the `/api/verify` metric shape (`key`+`label`+`unit`+`direction`, and
  explicitly that no `metric` field exists).

### 5.2 P1 — Oversized request body reset the socket instead of returning 413

`server.js` called `req.destroy()` as soon as a body exceeded its cap, in three
places: `readJsonBody` (25 MB), `POST /api/speedtest/upload` (64 MB) and
`POST /api/report` (2 MB). The client therefore saw `ECONNRESET` instead of the
documented clean `413`.

* Fix: stop accumulating/buffering past the cap but keep draining the request, and
  answer `413` from the existing `end` path. No socket is destroyed.
* Test: `test/api.test.js` posts a 3 MB body to `/api/report` and asserts a `413`
  JSON response (the regression guard).

### 5.3 P2 — History 404 omitted the `code` field

`GET`/`DELETE /api/history/:id` returned `{ ok:false, error:'Scan not found' }`
with no `code`, although `docs/API_CONTRACT.md` §6 lists `NOT_FOUND` for unknown
history ids and other endpoints (e.g. `/api/verify`) already send it.

* Fix: add `code: 'NOT_FOUND'` to both history 404 responses.
* Test: `test/api.test.js` asserts `code === 'NOT_FOUND'` on `GET` and `DELETE`.

### 5.4 P1 (privacy) — Clean package did **not** exclude `fixtures/private/`

`scripts/make-clean-package.js` states in its header and console output that
`fixtures/private/` is not copied, but `EXCLUDE_DIRS` never contained it, so the
directory **was** copied. Today `fixtures/private/` holds only `.gitkeep`, so
nothing leaked — but that directory exists specifically to hold **raw, unmasked
captures** on the owner's machine. Running the tool after capturing raw data
would have copied real SSID/BSSID/MAC/GPS into the shareable package.

* Fix: exclude by relative path (`fixtures/private`), not by the generic directory
  name; keep every existing exclusion; add `backups` as a name too.
* Also refactored the script into an importable `buildCleanPackage()` and made the
  output directory overridable via `NETPULSE_CLEAN_OUT` so it can be tested
  without writing `dist-clean/` into the repo. Default behaviour is unchanged.
* Test: `test/clean-package.test.js` builds a fake project containing a private
  marker in `fixtures/private/`, `data/`, `data/backup/`, `reports/` and
  `Surveys/`, then asserts none of it appears in the output and that the copied
  `data/history.json`/`surveys.json` are exactly `[]`.

---

## 6. Contract conformance

`docs/API_CONTRACT.md` was checked against the running server. Every stable rule
id and every documented error code was reproduced. Discrepancies, and how each
was reconciled:

| # | Area | Discrepancy | Resolution |
|---|---|---|---|
| 1 | §3.5 UI metrics | UI read `m.metric`; server sends `key`/`label` | Code fixed (§5.1); contract unchanged |
| 2 | Oversized body | Server reset socket instead of 413 | Code fixed (§5.2) |
| 3 | §6 history 404 | Server omitted `code: NOT_FOUND` | Code fixed (§5.3) |
| 4 | §0.2 env table | Missing `NETPULSE_BIND`, `NETPULSE_AUTH_TOKEN`, `NETPULSE_SURVEYS_DIR`, `NETPULSE_REPORTS_DIR`, `NETPULSE_LIVE_SCAN` | Doc updated |
| 5 | §6 error index | Missing `SCAN_BUSY`; §3.1 409 sample lacked `code` | Doc updated |
| 6 | §4 elevation | Wording implied **all** actions need admin; only `restore-dns-dhcp` does (`flush-dns`/`dhcp-renew` run unelevated) | Doc clarified |
| 7 | Antigravity R6 | Requested `SCAN_NOT_FOUND`; contract says `NOT_FOUND` | **Contract wins** — the UI only renders `j.error`, so no breakage |

All other contract items reproduced: request guards (host allow-list, same-origin,
`Sec-Fetch-Site: cross-site`, optional token), `dataQuality`, the full `analysis`
object (`findings`, `osiLayer`, `healthScore`, `status`, `headline`,
`topFindingId`, `contradiction`, `insufficientData`, `evidenceRefs`,
`disproveIf`), and all 25 stable finding ids.

---

## 7. Security review (observed)

### 7.1 Request-guard probe — 19/19 pass

| Check | Expected | Observed |
|---|---|---|
| `GET /api/health` | 200 `name=netpulse` | 200 |
| `GET /api/preflight` | 200 with `platform,nodeVersion,isAdmin,locationPermission,wlanAvailable` | 200, all fields |
| `GET /`, `/index.html`, `/css/style.css`, `/js/app.js` | 200 | 200 |
| Forged `Host` header | 403 `HOST_NOT_ALLOWED` | 403 |
| Cross-origin `Origin` | 403 `ORIGIN_NOT_ALLOWED` | 403 |
| `Sec-Fetch-Site: cross-site` | 403 | 403 |
| `POST /api/action` without `confirm:true` | 400 `CONFIRM_REQUIRED` | 400 |
| `restore-dns-dhcp` with bad adapter | 400 `INVALID_ADAPTER`, no command run | 400, `outputs` undefined |
| Path traversal (`/../server.js`, `/..%2fserver.js`, `/%2e%2e/server.js`, `/js/../server.js`, `/../data/history.json`, `/..%5cserver.js`) | 404, no file content | 404, no leak |
| Malformed JSON body | 400 | 400 |
| Oversized `/api/report` (>2 MB) | 413 | **413** (was ECONNRESET before §5.2) |

### 7.2 Auth / refuse-to-start probe — 4/4 pass

| Check | Expected | Observed |
|---|---|---|
| Non-loopback bind with no token | refuse to start (exit 1, mentions `authToken`) | exit 1, message present |
| Missing `X-NetPulse-Token` | 401 `AUTH_REQUIRED` | 401 |
| Wrong `X-NetPulse-Token` | 401 `AUTH_REQUIRED` | 401 |
| Correct token | 200 | 200 |

Token comparison is constant-time (`crypto.timingSafeEqual`); the token is never
logged, and `README.md` no longer recommends `0.0.0.0` without a token.

### 7.3 SSID escaping / XSS — verified in a real browser

Code audit found every SSID render path escaped (`esc`/`escHtml` covering
`& < > " '`; modal titles set via `textContent`; canvas labels are text). This was
then verified at runtime:

* Seeded a **temporary** data dir (never the real `data/`) with a history entry
  whose SSID and neighbour SSID were `<img src=x onerror="window.__xss=1">`.
* Loaded the UI, opened History, and evaluated in the page.
* Observed: `xssExecuted=false`, `imgXCount=0`, `containsRawInject=false`,
  `containsEscaped=true`, **0 console errors**.

### 7.4 Response headers

`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: no-referrer`, and a strict `Content-Security-Policy` are sent as
**response headers** (not a `<meta>` tag). The CSP uses `script-src 'self'` with
no `unsafe-eval`, and `index.html` contains no inline `<script>`. Locked by tests
in `test/api.test.js` and `test/integration.test.js`.

---

## 8. Privacy review

* `.gitignore` excludes `node_modules/`, `dist-clean/`, `data/*.json`,
  `data/backup/`, `reports/`, `Surveys/`, `fixtures/private/`, `*.log` (asserted by
  `test/privacy.test.js`).
* `node scripts/make-clean-package.js --force` produced `dist-clean/` with **no**
  `reports/`, **no** `Surveys/`, **no** `data/backup/`, **no**
  `fixtures/private/`, and fresh `[]` data files. Verified after fixing §5.4.
* Live real `data/` was **not** modified by this audit. Only names/sizes were
  listed (never contents). No value from `data/`, `reports/`, `Surveys/` or
  `fixtures/private/` was opened, copied or published.
* Test isolation: the suite sets `NETPULSE_DATA_DIR` (+ surveys/reports dirs) to
  temp dirs and `api.test.js` asserts the real `data/` signature is unchanged
  across the run.
* **Caution for the owner:** `data/` currently contains real history (with
  backups). It must never be committed or shared; use `make-clean-package` for any
  hand-off.

---

## 9. Documentation claim audit

| Claim (source) | Verdict | Action |
|---|---|---|
| "supports 3 modes: WiFi / LAN / Mobile" (README) | Overstated — the **live** collector emits only `wifi`/`lan`; Mobile exists only in the Simulation Lab | Reworded (live reports wifi/lan; Mobile is simulation-only) |
| "15 simulation scenarios" (README) | Verified (LAN 5 / WiFi 5 / Mobile 5) | none |
| "duplex mismatch / bad cable" (README rules) | Overstated — duplex is **not** measured | Reworded to "gateway unstable — possible duplex mismatch or bad cable"; duplex not measured |
| "20-40% loss + high RTT → congestion" (README) | Inaccurate thresholds | Reworded to "loss 1-40% **and** avg RTT > 150 ms" |
| "DNS-failure demo" (README + DEMO.md) | **Contradicted** — `js/scenarios.js` has **no** DNS scenario (5 wifi/lan/mobile each) | DEMO.md corrected: use an existing scenario for the offline path; a DNS finding requires a live fault. README link reworded |
| `arp -a` "vendor via OUI lookup" (README) | Partial — small built-in table, unknown vendors show as Unknown | Caveat added |
| `ping -f -l 1472` "MTU discovery" (README) | Partial — binary-probes down to 500 and needs a reachable gateway | Caveat added |
| Speed test "contacts speed.cloudflare.com" (README / index.html) | Verified — downloads/uploads to `speed.cloudflare.com`, with a local-server fallback | none |
| SSID "can exceed signal %" / dBm is a mapped estimate (README) | Verified — dBm shown as a mapped estimate, not compared to truth | none |
| `start.bat` title "NetPlus AI" | Stale brand, user-visible | Changed to NetPulse |

---

## 10. Files changed by this audit

Integration fixes:
* `server.js` — oversized-body handling (3 sites); history 404 `code: NOT_FOUND`.
* `js/app.js` — verify metrics table reads `m.label || m.key`.
* `scripts/make-clean-package.js` — exclude `fixtures/private/`; add testable
  `buildCleanPackage()` + `NETPULSE_CLEAN_OUT` (default output unchanged).

Documentation (claims/contract reconciliation):
* `docs/API_CONTRACT.md` (§0.2, §3.1, §4, §6).
* `docs/DEMO.md` (removed the non-existent DNS simulation scenario).
* `README.md` (3-modes, duplex, congestion, OUI, MTU, demo link; new doc rows).
* `start.bat` (brand).

New tests / tooling:
* `test/rules.test.js`, `test/integration.test.js`, `test/startup.test.js`,
  `test/clean-package.test.js`.
* `test/api.test.js` — added oversized-413, history-NOT_FOUND, verify-metric-shape
  and security-header tests.
* `scripts/eval-faults.js`, `docs/EVALUATION.md`,
  `docs/MANUAL_WINDOWS_CHECKLIST.md`, `RELEASE_READINESS.md`.

Both tools' work was preserved; conflicts were reconciled, not reverted.

---

## 11. NOT VERIFIED / untested (owner must check)

These were **not** reproduced here and are **not** claimed to pass:

1. **Real live scan end-to-end** — the skipped test
   (`POST /api/scan on Windows (live)`, needs `NETPULSE_LIVE_SCAN=1`) and a real
   scan against the owner's actual network (real SSID/BSSID/MAC/GPS).
2. **Excel / Google Earth / PDF reader** — the Survey XLSX, KML, CSV, JSON and the
   diagnosis PDF were not opened in those applications.
3. **Elevation flow** — `restore-dns-dhcp` under a real elevated prompt was not
   executed (audit ran unelevated; only the `ADMIN_REQUIRED` path is covered).
4. **Location permission denied state** — `locationPermission` was `ok` on this
   host; the `blocked` banner path was not observed live.
5. **Speed test against Cloudflare** — network egress to `speed.cloudflare.com`
   was not exercised; only the code path was inspected.
6. **Git baseline** — impossible: the project is not under version control.

Use `docs/MANUAL_WINDOWS_CHECKLIST.md` and `docs/EVALUATION.md` to close these.

---

## 12. Remaining defects

| Severity | Item | Notes |
|---|---|---|
| P0 | none | — |
| P1 | none open | fixed: metrics field, oversized-body reset, clean-package private leak |
| P2 | History 404 lacked `code` | fixed |
| P3 | Cosmetic: `HANDOFF_OPENCODE.md` §7 still lists app.js/survey.js `NetPlus AI` strings that Antigravity has since fixed; `stitch_ui_prompt.txt` retains historical "NetPlus AI" | Left as historical record; noted here so it is not mistaken for an open brand bug |
| P3 | `docs/PRIVACY_CLEANUP.md` lists `data/history.json`/`surveys.json` as "must not contain … with content"; the clean package intentionally ships them empty | Wording could be clearer; behaviour is correct |

---

## 13. Manual review items for the owner

* Run `npm test` and `NETPULSE_LIVE_SCAN=1 npm test` on the real demo laptop.
* Work through `docs/MANUAL_WINDOWS_CHECKLIST.md` (elevated shell, DNS fault via
  `192.0.2.1`, fix + verify, restore to DHCP, report redaction, Survey exports).
* Confirm the Troubleshoot before/after table now shows metric names (the §5.1
  fix) after a real two-scan verify.
* Record controlled-fault runs in `docs/EVALUATION.md` — every result cell is
  intentionally empty; only fill it from your own observations.
* Keep `data/`, `reports/`, `Surveys/` and `fixtures/private/` out of any share;
  use `node scripts/make-clean-package.js` for hand-offs.

---

## 14. Reproduce this audit

```
node --version
node --check server.js
cmd /c "npm test"                       # must exit 0
node scripts/make-clean-package.js --force
node scripts/eval-faults.js template    # blank results table
```

The security probes and the auth probe were one-off scripts run from the approved
temp directory; their checks are summarised in §7.
