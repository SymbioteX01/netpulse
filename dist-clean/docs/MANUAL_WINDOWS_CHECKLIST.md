# NetPulse — Manual Windows Demo Checklist

For the owner to run on the Windows 10/11 demo laptop. Tick each box in order.
None of these steps is automated and none of the boxes is pre-ticked.

Environment assumed: Windows 10/11, Node.js v18+, a WiFi adapter and an Ethernet
adapter, and an Administrator cmd/PowerShell window available.

---

## A. Before you start

- [ ] `node --version` prints v18 or newer.
- [ ] The real `data/`, `reports/` and `Surveys/` folders exist (the app creates
      them on first run). Do **not** delete or empty them.
- [ ] Note the **exact adapter name** you will fault, e.g.
      `netsh interface show interface` lists `Wi-Fi` and `Ethernet`.
      Copy it character-for-character; the app matches it exactly.
- [ ] Close any VPN. A VPN changes the whole path and makes the demo results
      meaningless.

## B. Location permission (needed for WiFi SSID/signal)

- [ ] Settings → Privacy & security → Location → **Location services = On**.
- [ ] "Let desktop apps access your location" = **On**.
- [ ] Confirm: `netsh wlan show interfaces` prints an SSID (not a
      "needs location permission" message).

## C. Administrator shell (needed for `restore-dns-dhcp`)

- [ ] Open **cmd as Administrator** (Start → type `cmd` → right-click → Run as
      administrator).
- [ ] `cd` to the project folder.
- [ ] Start the server: `node server.js` (or `start.bat`).
- [ ] Open `http://127.0.0.1:3000` in the browser.
- [ ] Top-right chip says **Server Online**.
- [ ] Preflight banners: the only acceptable one is "Not running as
      Administrator". If it appears, fix actions that need elevation
      (`restore-dns-dhcp`) will return `ADMIN_REQUIRED`.

## D. Healthy baseline scan

- [ ] Troubleshoot tab → **Run Full Diagnostics**.
- [ ] Wait ~20-25 s.
- [ ] Diagnose step shows a **LIVE** source badge.
- [ ] Top finding is **No Fault Detected** (green), or only a Low informational
      finding (e.g. "LAN Cable Not Connected" while on WiFi).
- [ ] `docs/EVALUATION.md`: record the baseline row (Run #, top finding id).

## E. Inject a DNS fault (using the documentation address 192.0.2.1)

> `192.0.2.1` is TEST-NET-1 (RFC 5737), reserved for documentation. It is never
> a real resolver, so pointing DNS at it makes every name lookup fail without
> touching the internet path.

- [ ] In the Administrator shell (replace `<adapter>` with your exact name):
      `netsh interface ip set dns name="<adapter>" static 192.0.2.1 primary`
- [ ] Confirm the fault: `nslookup google.com` should time out / fail.
- [ ] Confirm IP still works: `ping 8.8.8.8` should succeed.
- [ ] Back in NetPulse: **Run Full Diagnostics** again.
- [ ] Diagnose step top finding should be a DNS rule: `dns-default-failing`
      (a public resolver still works) or `dns-all-failing`.
- [ ] Expand the evidence panel: check `evidence`, `evidenceRefs`,
      `disproveIf`, and "Show raw evidence".
- [ ] `docs/EVALUATION.md`: record this run.

## F. Fix + verification

- [ ] Step 3 (Fix): show the confirmation modal; click **Flush DNS Cache**.
- [ ] Step 4 (Verify): click **Re-scan & Verify Fix**.
- [ ] The verdict banner appears with an icon **and** text (never colour alone).
- [ ] The before/after metrics table shows metric names (not `--`) and a
      direction arrow for each row.
- [ ] If the verdict is *Resolved*, the resolved-findings list appears.
- [ ] `docs/EVALUATION.md`: record the before/after finding ids.

## G. Restore DNS to DHCP

- [ ] In the Administrator shell:
      `netsh interface ip set dns name="<adapter>" dhcp`
- [ ] Or use the app's **Restore DNS + DHCP** action (admin-gated). If you are
      not elevated it must return `ADMIN_REQUIRED` and run nothing.
- [ ] Confirm recovery: `nslookup google.com` resolves again.
- [ ] Run one final scan; the top finding returns to **No Fault Detected**.
- [ ] If a DNS action used an invalid adapter name, confirm the app returns
      `INVALID_ADAPTER` and runs no command.

## H. Evidence report + redaction

- [ ] Step 5 (Report): **Redact SSID, BSSID, MAC and GPS** is checked by
      default. Leave it checked.
- [ ] Click **Generate Evidence Report**.
- [ ] Search the report (Ctrl+F) for the real SSID / BSSID / MAC / coordinates —
      none should be present.
- [ ] Click **Save to File (reports/)** and confirm a new HTML file appears in
      `reports/`.
- [ ] Un-redacted check (optional, on-screen only): toggle redaction off and
      confirm the values *do* appear, then toggle it back on. Do not save an
      un-redacted report outside your own machine.

## I. Survey + Excel + Google Earth

- [ ] Survey tab → **Scan & Measure**. Grant Location when prompted.
- [ ] Save at least 3 survey points; give each a location name.
- [ ] Export **XLSX** and open it in Excel: the header row and points are
      readable.
- [ ] Export **KML** and open it in Google Earth: the placemarks appear at the
      recorded coordinates.
- [ ] Export **CSV / JSON / PDF** and confirm each opens.
- [ ] Confirm the exports landed under `Surveys/<project>/` and are **not**
      tracked by git (see `.gitignore`).

## J. Shut down

- [ ] Stop the server (Ctrl+C in its window).
- [ ] Confirm no stale listeners remain:
      `Get-NetTCPConnection -LocalPort 3000 -State Listen` returns nothing.
- [ ] Leave `data/`, `reports/` and `Surveys/` in place.

---

### Result summary (fill in by hand)

| Section | Passed? (Y/N) | Notes |
|---|---|---|
| D Healthy baseline |  |  |
| E DNS fault injection |  |  |
| F Fix + verification |  |  |
| G Restore to DHCP |  |  |
| H Report redaction |  |  |
| I Survey / Excel / Earth |  |  |
