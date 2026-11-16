# NetPulse — Controlled-Fault Evaluation (TEMPLATE)

**Status: NO RESULTS RECORDED.** Every result cell below is intentionally empty.
Do not fill a row unless you personally injected the fault on a real machine and
observed the scan. Never copy an expected value into the "Top finding id" or
"Match" column.

## Purpose

Prove, with evidence, that the diagnostic engine identifies each fault you can
actually inject on the demo laptop. This is a **record of observed runs**, not a
feature list and not a test report.

## Method

1. Start from a healthy baseline scan (`node server.js`, run Full Diagnostics).
2. Inject exactly one fault (see the table). Change nothing else.
3. Run a fresh full scan.
4. Read the top finding id from the UI (Diagnose step) or from a saved scan:
   `node scripts/eval-faults.js analyze --scan <saved-scan.json> --expect <id>`
5. Record: the run number, the observed top finding id, Y/N match, and notes
   (e.g. "engine returned insufficientData — collector failed first").
6. Restore the baseline before the next fault.

The `Expected id` column is an a-priori prediction from
`docs/API_CONTRACT.md` §3.4. It is filled in; the result columns are not.

## Generate a fresh blank table

```
node scripts/eval-faults.js template      # prints a blank table
node scripts/eval-faults.js expected      # prints fault -> expected id
```

## Results

| Fault injected | Run # | Top finding id | Expected id | Match (Y/N) | Notes |
|---|---|---|---|---|---|
| Unplug the LAN cable |  |  | gateway-link-down |  |  |
| Damaged / duplex-mismatched cable |  |  | gateway-unstable |  |  |
| DHCP server off (APIPA 169.254.x.x) |  |  | dhcp-unreachable |  |  |
| Disable the WiFi adapter |  |  | no-interface |  |  |
| Wrong WiFi password / not associating |  |  | wifi-connection-failed |  |  |
| Move far from the AP (<25%) |  |  | critical-weak-signal |  |  |
| Move to mid range (25-50%) |  |  | weak-signal |  |  |
| Co-channel interference |  |  | wifi-interference |  |  |
| Crowded channel (2+ strong neighbours) |  |  | channel-overlap |  |  |
| Saturate the uplink (loss + latency) |  |  | network-congestion |  |  |
| Severe loss on the WAN path |  |  | severe-degradation |  |  |
| High-latency path (both pings >=200 ms) |  |  | high-latency |  |  |
| Unplug the WAN / ISP down |  |  | internet-unreachable |  |  |
| Point DNS at an unreachable server (192.0.2.1) |  |  | dns-default-failing |  |  |
| Block UDP/TCP port 53 |  |  | dns-all-failing |  |  |
| Break name resolution (no per-server data) |  |  | dns-resolution-failure |  |  |
| Slow resolver (>500 ms) |  |  | slow-dns |  |  |
| Drop a router hop (no later hop answers) |  |  | router-link-down |  |  |
| Filter ICMP on a middle hop (later hops answer) |  |  | icmp-filtered |  |  |
| Reduce the path MTU below 1400 |  |  | mtu-reduced |  |  |
| No cellular service (airplane mode) |  |  | cellular-outage |  |  |
| Disconnect the wired NIC while on WiFi |  |  | lan-cable-not-connected |  |  |
| Turn off the Location permission |  |  | location-permission-blocked |  |  |
| Healthy baseline (control) |  |  | no-fault |  |  |

## Faults that cannot be injected in a normal demo

Some rules are exercised by the automated suite (`test/rules.test.js`) but are
hard to reproduce on a lab machine. Mark them in the Notes column as
`NOT INJECTED` rather than leaving them blank:

- `collector-warning` — requires a collector command to fail without failing
  the whole scan.
- `high-latency` — requires a path where *both* public resolvers average
  >=200 ms (satellite/geographic).
- `channel-overlap` — needs 2+ strong neighbouring APs on the same channel,
  which you do not control in a lab.
- `mtu-reduced` — needs a tunnel/PPPoE link with a reduced path MTU.
