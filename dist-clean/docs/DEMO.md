# NetPulse — 3-Minute Demo Script

**Scenario: DNS Failure Diagnosis, Fix, and Verification**

This script walks a live or simulated DNS-failure end-to-end through the
Troubleshoot tab in approximately 3 minutes. Adapt the timing to your audience.

> **Engine note:** Producing a real DNS-failure finding requires the diagnostic
> engine to detect it (Ping OK, DNS fails) — which needs a **genuine DNS
> misconfiguration on the test PC**. The Simulation Lab has **no DNS scenario**,
> so use it with any scenario (e.g. WiFi → Channel Interference) to demo the
> evidence panel, and reserve the DNS narrative for a live run. Both paths use
> the same UI walkthrough below.

---

## Pre-flight Checklist

Run through this list **before** the audience arrives.

| # | Check | How to verify |
|---|---|---|
| 1 | Node.js v18+ installed | `node --version` in cmd |
| 2 | Server running | `node server.js` (or double-click `start.bat`); browser opens to `http://127.0.0.1:3000` |
| 3 | Server status chip shows **Server Online** | Top-right of the page |
| 4 | No preflight error banners (or only the expected "not running as admin" warning) | Reload the page and check the banner area below the nav |
| 5 | **For simulation demo:** Simulation Lab tab loads and the WiFi scenarios are listed (e.g. "Channel Interference") | Click Simulation Lab, confirm the WiFi scenario list is populated |
| 6 | **For live demo:** DNS is genuinely broken on this machine (e.g. `nslookup google.com` fails) | Run `nslookup google.com` in cmd — it should time out or return an error |
| 7 | Report folder writable | Previous HTML file exists in `reports/`, or the folder is empty and writable |
| 8 | Browser zoom at 100% | Ctrl+0 |

---

## Demo Walkthrough (~3 min)

### Minute 0 — Open NetPulse

1. Open `http://127.0.0.1:3000` in the browser.
2. Point out: **"This is NetPulse — an evidence-backed network troubleshooter."**
3. Note the **server status chip** (top right): "Server Online".
4. If a preflight banner appears (e.g., "Not running as Administrator"), explain:
   > "This banner tells us upfront that fix actions requiring admin rights won't
   > run automatically. It doesn't block diagnosis."

---

### Minute 0:20 — Navigate to Troubleshoot

5. Click the **Troubleshoot** tab in the sidebar (first tab above Live Scan).
6. Show the **5-step stepper**: Scan → Diagnose → Fix → Verify → Report.
   > "Every step is visible. You always know where you are in the process."

---

### Minute 0:40 — Step 1: Scan

#### Live demo path
7. Click **Run Full Diagnostics**.
8. Narrate the progress steps as they appear (WiFi, interfaces, ping, DNS, traceroute…).
9. Wait ~20–25 s for the scan to complete.

#### Simulation path (offline / safe demo)
7. *(In a new tab)* Go to the **Simulation Lab** tab.
8. Select **WiFi** mode, choose **Channel Interference** (any scenario works — there is no DNS scenario), click **Run Simulation**.
9. Come back to **Troubleshoot** and note: the scan runs live; the simulation result is in the Live Scan tab for reference.  
   *Alternatively:* Use the "Start Troubleshooting" button on the Home tab which goes to Troubleshoot step 1.

---

### Minute 1:10 — Step 2: Diagnose

10. The stepper moves automatically to **Diagnose** after the scan completes.
11. Show the **source badge** (LIVE or SIMULATED) — explain:
    > "This badge tells you where this data came from. LIVE means real Windows
    > commands ran on this machine. SIMULATED means it came from the Simulation Lab."
12. Point to the **fault card** (live example: "DNS Resolution Failure").
    - Show the **OSI layer indicator** (Layer 7 — Application).
    - Show the **severity** (e.g. Critical).
13. Expand the **evidence panel**:
    > "Here is the raw evidence: what we actually measured, what would disprove
    > this diagnosis, and where the data came from."
    - Show `disproveIf`: *"If nslookup to 8.8.8.8 also fails, this is not a DNS config issue."*
    - Show `evidenceRefs` chips (source → key → value from real scan data).
    - Click **Show raw evidence** to reveal the actual parsed scan fields.
14. Show the **Network Topology** canvas and **Traceroute** graph.
    > "Green hops = OK. Red = packet loss at that hop."
15. Click **Proceed to Fix →**.

---

### Minute 1:50 — Step 3: Fix

16. Show the two fix buttons: **Renew DHCP** and **Flush DNS Cache**.
17. Click **Flush DNS Cache**.
18. The **confirmation modal** opens. Walk through it:
    - *What this does:* runs `ipconfig /flushdns`.
    - *Effect:* no connection drop expected.
    - *How to undo:* cache rebuilds automatically.
19. Click **Flush DNS** (confirm button).
20. The status line updates: *"DNS cache flushed. Click Re-scan & Verify Fix to confirm."*
21. The **Re-scan & Verify Fix** button is now enabled.

---

### Minute 2:20 — Step 4: Verify

22. Click **Re-scan & Verify Fix →**.
23. NetPulse runs a second full scan, then calls `/api/verify` comparing before and after.
24. Show the **verdict banner**:
    - ✅ *Resolved* — DNS is fixed.
    - 📈 *Improved* — better but not fully resolved.
    - ⏸ *Unchanged* — no change.
    - 📉 *Worse* — something got worse.
    - ❓ *Inconclusive* — not enough data.
    > "Color is never the only signal — there is always an icon and text label."
25. Show the **before/after metrics table** (latency, DNS response time, etc.).
26. If findings are resolved, the **Resolved findings** list appears in green.
27. Click **Go to Report →**.

---

### Minute 2:45 — Step 5: Report

28. The **Redact SSID, BSSID, MAC and GPS coordinates** checkbox is checked by default.
    Explain:
    > "Redaction happens in your browser before the report is generated. NetPulse
    > never sends your personal network identifiers to any server."
29. Click **Generate Evidence Report**.
30. The iframe shows the full report:
    - **LIVE** source badge at the top.
    - Findings with evidence, `disproveIf`, and raw evidence.
    - Before/after metrics table.
    - Redaction notice at the bottom.
31. Click **Save to File (reports/)** — confirm the file appears in `reports/`.
32. Optional: Ctrl+F in the iframe, search for the actual SSID name — it should
    not appear (redaction working).

> **Total time: ~3 minutes.**

---

## Key Talking Points

- **Evidence-backed:** every finding shows *what we measured*, *why we concluded this*, and *what would disprove it*.
- **No guessing:** if there is insufficient scan data, NetPulse shows an "Insufficient data" state — it never invents a fault card.
- **Honest badges:** LIVE vs. SIMULATED vs. REPLAY. Simulated results can never look live.
- **Prove the fix worked:** the re-scan + verify loop produces a verdicted before/after comparison, not a "try this and hope" approach.
- **Privacy by default:** redaction is on by default. Users control what goes into the shareable report.

---

## Fallback if Live Demo Fails

If the live scan returns an error or `UNSUPPORTED_PLATFORM`:
1. Switch to the **Simulation Lab** tab.
2. Select WiFi → a scenario (e.g. Channel Interference) → Run Simulation.
   (The Simulation Lab has no DNS scenario; a DNS finding needs a live fault.)
3. Explain: *"The engine is Windows-only. On this machine we use the simulation.
   The UI, evidence panels, fix modal, verify flow, and report are identical."*

---

## Engine notes (implemented)

The DNS rules produce `dns-resolution-failure` (no per-server tests),
`dns-default-failing` (the default server fails but a public resolver works) or
`dns-all-failing` (every tested resolver fails). Each finding carries
`evidence`, `evidenceRefs` (e.g. `connectivity.pings.internet.received`,
`dns.status`, `dns.tests`), a `disproveIf` sentence and a `fix` that mentions
`ipconfig /flushdns`. See `docs/API_CONTRACT.md` §3.4 for the full schema and
`test/rules.test.js` for fire/no-fire coverage of every rule.
