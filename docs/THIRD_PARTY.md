# NetPulse — Third-Party Software

## Leaflet

| Field        | Value |
|---|---|
| **Name**     | Leaflet |
| **Version**  | 1.9.4 |
| **License**  | BSD 2-Clause ("Simplified BSD") |
| **Source**   | `npm pack leaflet@1.9.4` (registry: https://registry.npmjs.org/) |
| **Obtained** | 2026-10-18 via `npm pack leaflet@1.9.4` in a temporary directory; tarball NOT added to `package.json` dependencies |
| **sha256 (leaflet.js)** | `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` |

### Files vendored

| Source path in tarball | Destination in repo |
|---|---|
| `dist/leaflet.js` | `js/vendor/leaflet/leaflet.js` |
| `dist/leaflet.css` | `css/vendor/leaflet/leaflet.css` |
| `dist/images/layers-2x.png` | `css/vendor/leaflet/images/layers-2x.png` |
| `dist/images/layers.png` | `css/vendor/leaflet/images/layers.png` |
| `dist/images/marker-icon-2x.png` | `css/vendor/leaflet/images/marker-icon-2x.png` |
| `dist/images/marker-icon.png` | `css/vendor/leaflet/images/marker-icon.png` |
| `dist/images/marker-shadow.png` | `css/vendor/leaflet/images/marker-shadow.png` |

### referrerPolicy note

Leaflet 1.9.4's `TileLayer` exposes a `referrerPolicy` option (confirmed by
grepping `leaflet.js` — the string `referrerPolicy` is present). NetPulse sets
`referrerPolicy: 'no-referrer-when-downgrade'` in `NPMap.init()` so that
tile requests sent to `tile.openstreetmap.org` carry a Referer header on
HTTPS→HTTPS navigations. The global `Referrer-Policy: no-referrer` header
sent by `server.js` governs navigation, but Leaflet's per-request option
overrides it for tile `<img>` elements, satisfying OSM's tile usage policy.

### BSD 2-Clause License text

```
Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

---

## OpenStreetMap tiles

Tile images are fetched at runtime from `https://tile.openstreetmap.org/`
and are **not** bundled in this repository.

| Field | Value |
|---|---|
| **Data** | © OpenStreetMap contributors |
| **License** | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) (map data); [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) (rendered tiles) |
| **Usage policy** | https://operations.osmfoundation.org/policies/tiles/ |
| **Attribution shown** | Yes — Leaflet attribution control displays "© OpenStreetMap contributors" with a link to the copyright page |
| **Privacy** | Tile requests expose the area being viewed and the user's IP address to the OSMF tile servers. NetPulse shows a one-time consent notice before loading any tiles; tiles are only requested after the user accepts. |
