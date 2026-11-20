# Privacy Cleanup

NetPulse collects **real** network data on the machine that runs it. Some of that
data identifies the user or their location:

| Where | What it can contain |
|---|---|
| `data/history.json` | SSID, BSSID, MAC addresses, IP/gateway addresses, timestamps |
| `data/surveys.json` | Wi-Fi survey points: SSID, BSSID, RSSI, latitude/longitude (GPS) |
| `data/backup/` | Timestamped copies of the two files above |
| `reports/` | Diagnosis HTML/PDF reports (SSID, IPs, traceroute path, vendor) |
| `Surveys/` | Exported CSV / XLSX / JSON / PDF / KML (KML contains GPS) |
| `fixtures/private/` | Anything manually captured that was not sanitized |

None of these are needed to run or grade the app - they are runtime output only.

## Protection already in place

`.gitignore` (project root) excludes all of the above plus build/test output:

```
node_modules/
dist-clean/
data/*.json
data/backup/
reports/
Surveys/
fixtures/private/
*.log
```

The committed fixtures under `fixtures/commands/` are **hand-written**, use only
documentation/test address ranges (`192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24`, link-local `169.254.0.0/16`, masks `255.*`, `127.0.0.1`,
`0.0.0.0`) and invented names (`ExampleNet`, `Neighbor-*`). Every MAC uses the
locally-administered `02:` prefix or the broadcast address. `test/privacy.test.js`
enforces all of this on every `npm test` run.

## If the project was ever committed with real data

`.gitignore` only stops *future* commits. If `data/`, `reports/` or `Surveys/`
were committed before, they are still in the git history. To remove them **from
the index** (untrack but keep the local file):

```bat
git rm -r --cached data reports Surveys fixtures/private
git rm --cached data/history.json data/surveys.json
git commit -m "Stop tracking private runtime data"
```

> Warning: this does **not** erase the content from earlier commits. Anyone who
> already cloned, downloaded a ZIP, or received the project in an email may still
> hold copies with real SSID / BSSID / MAC / GPS values. Treat those values as
> disclosed. If that matters, rewrite history (`git filter-repo` or the BFG tool)
> and rotate anything sensitive - and remember that already-shared copies cannot
> be recalled.

## Build a clean, shareable copy

`npm run clean-package` **copies** the project into `dist-clean/` and skips
`node_modules/`, `data/`, `reports/`, `Surveys/`, `fixtures/private/`, `dist-clean/`
and `.git/`. The copy gets fresh empty `data/surveys.json` and `data/history.json`
(`[]`). The original files are never deleted or edited.

```bat
npm run clean-package          :: fails if dist-clean/ already exists
npm run clean-package -- --force   :: removes ONLY the generated dist-clean/ first
```

Share `dist-clean/` (never the working folder) as a ZIP.

## Re-capture sanitized command fixtures (Windows only)

```bat
npm run capture-fixtures
```

It runs the real diagnostic commands, masks SSID / BSSID / MAC / every IPv4 with
invented documentation values (identical input always maps to the identical
invented value, so correlations survive), and **refuses to write a file** if any
MAC or non-documentation IPv4 remains. Review `fixtures/scans/` before sharing.

## Verify

- `npm test` includes `test/privacy.test.js` (no RFC1918 IPs, only `02:`/broadcast
  MACs, only invented SSIDs in committed fixtures, sanitizer behaviour, and that
  tests use temp dirs).
- Before sharing, confirm the private folders are absent from the copy:

```bat
dir dist-clean
```

The listing must **not** contain `data\history.json`, `data\surveys.json`,
`reports\`, `Surveys\` or `fixtures\private\` with content.
