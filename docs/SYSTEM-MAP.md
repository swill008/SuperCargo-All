# SuperCargo system map

Snapshot of v0.8.3 (commit 1764380), 2026-10-14. See [AUDIT.md](AUDIT.md) for findings and [OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md) for the Other mode on `features`.

Electron 33 + React 18 + zustand + react-three-fiber, built with electron-vite. About 20k lines
of TypeScript. No test suite; `npm run typecheck` and `npm run build` both pass.

## Processes

```
 Game.log ──poll 200ms──► main/logWatcher ─► logParser ─┐
 Localization .ini ─────► main/contractData ────────────┤ enrich
 GitHub raw data/uex ───► main/dataSync ─► main/uex ─────┤
 Screen ─► main/capture ─► main/ocr (tesseract | onnx) ─┤
                                                         ▼
                                    main/index.ts (windows + all IPC handlers)
                                     │  ▲            │ writes JSON: settings, manifest,
                         evt:* push  │  │ invoke     │ history, window-state (main/store)
                                     ▼  │            ▼
                         preload/index.ts → window.supercargo
                                     │
              renderer/state/store.ts (one zustand store) ─► pages / components
                                     │ uses
                         src/shared (route, hold, packer, ocrParse, ...)
 Supabase ◄── main/usageStats, main/boxReports, main/telemetry (OCR samples)
 GitHub Releases ◄── main/updater
```

The compact overlay is the same renderer bundle at `#compact`, in a second always-on-top window.

## Main process (`src/main`)

| File | Role | Talks to |
|---|---|---|
| `index.ts` | App lifecycle, main and compact windows, CSP (packaged only), all IPC handlers (`registerIpc`), OCR auto-capture and hotkey, hourly update check | everything below |
| `logWatcher.ts` | Polls Game.log every 200 ms, handles rotation, emits contract events | `logParser` |
| `logParser.ts` | Regex parse of one log line into accepted, objective, ended, paid and share events | `shared/contract` |
| `scanLog.ts` | One-shot full log read to recover contracts accepted while the app was closed | fs |
| `contractData.ts` | Title, blueprint and box-size index from the game's `global.ini` and `contracts.ini`, plus overrides | fs, `shared/fuzzy` |
| `dataSync.ts` | Copies bundled `data/uex` into userData; refreshes from `raw.githubusercontent.com/AquatikJustice/SuperCargo/main/data/uex`, verified by `hashes.json` | GitHub |
| `uex.ts` | Loads the cached ships, locations, commodities, grid faces and contract overrides | userData |
| `store.ts` | JSON persistence: settings, manifest, history, window state | userData |
| `capture.ts` | `desktopCapturer` grabs, crop, upscale and grayscale | Electron |
| `ocr/` | Engine selection (`tesseractEngine`, `onnxEngine`), `runOcr`, sample stash | jsdelivr (tess data), userData/ocr-model |
| `telemetry.ts` | Opt-in OCR sample upload queue (5 min retry) | Supabase Storage `ocr-samples` |
| `usageStats.ts` | Daily anonymous ping (**on by default**) | Supabase `usage_pings` |
| `boxReports.ts` | Box-size correction report when a contract ends (same flag) | Supabase `box_size_reports` |
| `updater.ts` | electron-updater wrapper | GitHub Releases |
| `installDetect.ts` | Finds Star Citizen installs (Windows: powershell + drive scan) | OS |

### IPC (names in `src/shared/channels.ts`, handlers in `src/main/index.ts:429-625`)

- **invoke (renderer → main, returns a value):**
  - settings: get / set
  - installs:detect, dialog:pickLogFile / exportRunFile
  - manifest: load / save; history: load / save
  - compact: show / hide / resize
  - uex: getShips / Locations / Commodities / GridFaces
  - watcher: scanSession / status / restart; contractData: status / rescan; data:refresh
  - telemetry:status
  - window: control / isMaximized / setAlwaysOnTop
  - ocr: listDisplays / engineInfo / preview / run / saveSample
  - app:version, updater: check / quitAndInstall
- **send (renderer → main, one-way):** loading:set, telemetry:boxReport, ocr:requestCapture, ocr:reportAccuracy.
- **events (main → renderer):**
  - evt:watcher:status, evt:contract:{accepted, ended, paid, share}, evt:objective
  - evt:ships / locations / commodities / gridFaces
  - evt:window:state, evt:ocr:result / status, evt:update
  - broadcast to every window: evt:manifest:changed, evt:compact:state, evt:loading:state, evt:settings
  - `evt:openCapture` is declared but never sent.

### Network calls

| Call | When | Data |
|---|---|---|
| Supabase `usage_pings` | Launch, every 20 h or more, if `shareUsageStats` (default **on**) | Client UUID, version, platform, OCR engine and accuracy, resolutions, ships, toggles |
| Supabase `box_size_reports` | Contract ends, same flag | Mission id, contract title and name, objectives (full report) |
| Supabase Storage `ocr-samples` | Only if `contributeTrainingData` | Grayscale crop plus OCR text and corrections |
| GitHub raw `data/uex` | Launch and manual refresh | – |
| GitHub Releases | 4 s after launch, then hourly | – |
| jsdelivr tesseract data | First Tesseract use | – |

## Shared logic (`src/shared`)

| File | Role |
|---|---|
| `types.ts` | All data types (`HaulingContract` → `DeliveryObjective` → `BoxAllocation`, history, settings, OCR) |
| `box.ts`, `boxGeometry.ts` | SCU to box split (greedy largest-first); box sizes in cells |
| `cargoGrids.ts` | Generated per-ship bay geometry; exits and floors; mutable grid-face markup |
| `packer.ts` | Greedy 3D packer, one wall per stop, peel proof |
| `hold.ts` | Main hold model: time-windowed slots, step-by-step rule relaxing, `planHold`, `holdOracle` |
| `walkPack.ts`, `loadout.ts` | Older per-step re-pack and loose-box helpers (partly dead) |
| `route.ts` | Pickup-and-delivery route planner with a capacity limit: exact DP (Held-Karp) up to 30 nodes, then greedy + 2-opt/or-opt, then multi-trip using `holdOracle`; `pullForward` merges repeat visits |
| `ocrParse.ts`, `fuzzy.ts` | Contract-screen text → objectives, reward and max box size; edit distance that allows for OCR misreads; location resolving |
| `contract.ts`, `logLocation.ts`, `markerResolve.ts` | Title parsing, pickup-bug workaround, log address → location, destination backfill |
| `ships.ts`, `shipModules.ts`, `uexMap.ts` | Ship roster, modular cargo, UEX API mapping |
| `payout.ts`, `run.ts`, `legal.ts`, `channels.ts` | Payout factors, run ids, legal text, IPC names |

## Renderer (`src/renderer/src`)

- **Entry.** `App.tsx` renders `CompactWindowApp` for `#compact`, otherwise `MainApp`. Views are switched on
  `store.view` (manifest, contracts, grid, history, settings); there is no router.
- **State.** `state/store.ts` is a single zustand store holding UI state, the persisted manifest, the
  derived `route`, history, settings, UEX rosters and OCR state. `persist()` sends the full manifest to
  main on every change. Main writes it and broadcasts to the other window. No localStorage is used.
- **Event flow.**
  1. The main process emits an `evt:contract:*` event.
  2. A store listener runs `commit()`, then `persist()`.
  3. `scheduleReroute()` (250 ms) runs `computeRoutePlan` in `state/route.ts`, which calls `shared/route` and `shared/hold`.
  4. The pages read the result through atomic selectors.
- **State helpers.** `state/manifest.ts` (stops, totals, history entries), `state/loading.ts` (the
  loading-walk steps), `state/layout.ts` (frozen layout and reconcile).
- **Pages.** `ManifestPage`, `ContractsPage` (inline edit), `CargoGridPage` (3.5k lines: R3F hold,
  loading walk, drag and drop, Stor-All crates), `HistoryPage`, `SettingsPage`.
- **Components.** TopBar, BottomNav, CaptureModal and OcrCalibrator (OCR), ScanReviewModal, TurnInModal,
  BoxEditModal, Typeahead, Onboarding, UpdateBanner, PrivacyPolicy.

## Tooling, data and backend

| Item | What it does |
|---|---|
| `scripts/gen-uex-snapshots.mjs` | UEX API + scunpacked → `data/uex/*.json` + `hashes.json` (committed; pulled by installed apps) |
| `scripts/gen-cargo-grids.mjs` | `ships.ts` + `scripts/data/*.json` → `src/shared/cargoGrids.ts` |
| `scripts/gen-icon.mjs` | `resources/icon.svg` → app icons |
| `scripts/build-glyph-atlas.mjs`, `gen-training-data.mjs` | Synthetic OCR training data |
| `scripts/train/` | `drain_supabase.mjs` (pulls uploaded samples with the secret key) → `train.py` (CRNN + CTC) → `export_onnx.py`; `auto/` sets up the Windows scheduled tasks; the trained model is deployed by hand to userData/ocr-model |
| `db/usage_pings.sql`, `db/box_size_reports.sql` | Supabase tables (insert-only RLS) and owner views |
| `.github/workflows/release-linux.yml` | Tag push → Linux AppImage draft release. Windows releases are built locally. **No CI on PRs or pushes.** |

## Other mode: WHERE AM I and start modes (`features`, 2026-10-14)

Not part of upstream v0.8.3; lives under `src/other/` with the re-tie points listed in
[STANDALONE.md](../src/other/STANDALONE.md) (rules 9-20 and re-tie points 9-15). Map and display-info
facts are in [OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#where-am-i-and-start-modes).

| File | Owns | Entry points |
|---|---|---|
| `src/other/otherGeo.ts` | Travel distance between two star-frame points: same system, other system via gateways (`jumps`), or over a body's surface | `travel()`, `compareTravel()`, `formatTravel()`; `explainTravel(a, b, locations)` (diagnostics: aSystem, bSystem, sameSystem, gatewayOut/In, surface, body, meters, jumps; type `TravelExplain`); types `GeoPoint`, `Travel` |
| `src/other/otherWhere.ts` | The `Where` model and its sources; parsing and resolving the map bottom line and the r_DisplayInfo text against the location roster | `parseMapLine()`, `parseDisplayInfo()` (whole panel: zones, positions, radius/altitude, player location, ServerTime, tracked mission, `checks`), `resolveMapLine()`, `resolveDisplayInfo()`, `ACCURACY`, `whereAccuracy()` (fades 1 per 5 min, min 1), `accuracyWord()`; types `Where`, `WhereSource`, `MapLine`, `DisplayInfo`, `WhereRunResult` |
| `src/other/main/whereAmI.ts` | Main side of WHERE AM I: global hotkey, one screen capture, OCR of zone 2 then zone 1, parse/resolve, broadcast; calibration preview and per-zone test; test seam `SC_WHERE_TEXT_FILE` (JSON `{zone1?, zone2?}` used instead of capture + OCR) | `registerOtherWhereHotkey(getSettings)` (re-exported by `main/register.ts`, called from upstream `registerHotkey()`); `registerOtherWhereIpc(getSettings)` (called by `registerOther()`) for IPC `otherWhere:run`, `otherWhere:calPreview`, `otherWhere:calTest`; `runWhere()` (a second run while one is running returns `error: 'busy'`, not broadcast); sends `evt:other:where`; `WHERE_FAIL_MESSAGE`; `getRecentWhereRuns()` for diagnostics; `getWhereDiag()` (`{ history, capture, live, hotkeys }`: last 10 reads with per-read `timings`, last capture details, live stats, hotkey state) and `getWhereImages()` (last zone 1 / zone 2 crops, unscaled PNG, kept in memory) for the export |
| `src/other/renderer/components/OtherMapCalibrator.tsx` | Settings UI (shown in `renderer/settingsBlock.tsx`, Other block) to set the two capture zones (`otherWhereZone1`, `otherWhereZone2`) on a preview grab and test each | `window.supercargo.otherWhereCalPreview()`, `otherWhereCalTest(zone)` |
| `test/replay/where_checks.mjs` | Parse/resolve checks for `otherWhere.ts`: map bottom lines and r_DisplayInfo 3 blocks transcribed from real screenshots, OCR-noisy variants and garbage, against the roster `data/uex/other-positions.json` | `node test/replay/where_checks.mjs` (bundles with esbuild; no build needed; separate from `run_all.mjs`) |
| `src/other/otherAfk.ts` | AFK button shared state and pure cycle: `AfkState`, key names → scan codes, which key each press sends, start / press / skip / stop steps, limits (`AFK_LAST_KEYS_MAX` 5, interval 5-600 s, a WHERE AM I read about once a minute ~2 s after a press) | `afkConfig()`, `afkStart()`, `afkPressed()`, `afkSkipped()`, `afkStopReason()`, `afkStopped()`, `afkKeyForPress()`, `afkScanCode()`, `normaliseAfkKey()`; type `AfkState` |
| `src/other/main/afk.ts` | Main side of AFK: timer, bring the Star Citizen window to the front, press the key through a persistent PowerShell child running an Add-Type C# helper (SendInput with scan codes); Windows only (other systems: `lastError: 'Windows only'`); test seam `SC_AFK_DRYRUN=1` (no focus, no keys, presses recorded; `SC_AFK_INTERVAL_MS` sets the interval) | `registerOtherAfkIpc(getSettings)` (called by `registerOther()`) for IPC `otherAfk:start`, `otherAfk:stop`, `otherAfk:get`; broadcasts `evt:other:afk`; `stopOtherAfk()` (on `will-quit`); `getAfkState()`; `getAfkDiag()` (`{ state, presses[] (last 50), stderr[] (last 20), startupMs, restarts }`) for the export |
| `src/other/renderer/components/AccuracyMeter.tsx` | Position accuracy as colour: red (0) → amber (5) → green (10) from the theme; number and word always shown | `AccTag` (overlay `ACC n` tag + 10-segment bar), `AccSlider` (Next tab, under STARTING AT), `TrackedTag`, `accuracyColor()` |
| `src/other/renderer/components/HotkeyRecorder.tsx` | Click-to-record hotkey field producing an Electron accelerator ('' = off); pauses all app global hotkeys while recording; warns on clashes; shows "in use by another app" after a failed registration | default `HotkeyRecorder({ value, onChange, conflicts })`; helpers `keyFromCode()`, `accelFromEvent()`, `normAccel()`; uses `otherHotkeysPause()`, `otherHotkeysResume()`, `otherHotkeyCheck(accel)`. Used for WHERE AM I (Other settings block) and for the upstream OCR hotkey (`SettingsPage.tsx`, re-tie 14) |
| `test/replay/afk_checks.mjs` | Checks the AFK pure cycle (`otherAfk.ts`) with a fake clock and sanity-checks the PowerShell / C# helper text in `main/afk.ts` (it can only run on Windows) | `node test/replay/afk_checks.mjs` (bundles with esbuild; no build needed) |
| `src/other/otherNext.ts` (diagnostics addition) | Explains how a step's place text was matched to the roster | `explainPlaceLookup(raw, locations)` → `{ raw, cleaned, method: 'exact' \| 'contains' \| 'address' \| 'folded' \| 'none', match?, hasCoords, candidates (≤5) }` (type `PlaceLookupExplain`) |
| `src/other/renderer/state/otherJobs.ts` (diagnostics addition) | Ring of the last 30 `where` changes (applied, older ignored, cleared) | `whereHistory()`; type `WhereHistoryEntry` |
| `src/other/renderer/state/otherDiag.ts` | Main window's Other snapshot for the export: adds `locationHistory`, per-row `lookup` and `travel`, `places` summary (per system / per source, with and without coords) | `otherDiagSnapshot()` |
| `src/other/renderer/state/otherOverlayDiag.ts` | What the overlay window last rendered (place-list size, start, stop, distance text, last read message, AFK, tracked id, settings) | `setOverlayDiag(partial)`, `overlayDiag()`; read by the overlay's `onDiagSnapshotRequest` responder in `OtherOverlay.tsx` (overlay window only, `#compact`) |
| `src/main/diagnostics.ts` (upstream file, batch 3 additions) | Export: `## NOTE`, `## OVERLAY` (overlay window snapshot), Other sections, `## GAME LOG HEALTH`, `## IMAGES` (opt-in PNGs next to the export) | `setOtherDiagSource({ sections, images })` (called by `registerOther()`; each `sections()` key becomes `## <KEY>`, JSON, sanitised); `setDiagSource({ …, overlayWindow })`; `buildDiagnostics({ note?, includeImages? })` → `{ ok, path, bytes, images? }` |
| `test/replay/diag_checks.mjs` | Checks `explainPlaceLookup` / `explainTravel` against `findRosterLocation` / `travel` | `node test/replay/diag_checks.mjs` (bundles with esbuild; no build needed) |

Settings (`src/other/workMode.ts`, defaults in `OTHER_SETTING_DEFAULTS`): `otherStartMode` ('auto' | 'fixed',
replaces `otherAutoStart`), `otherWhereHotkey` (CommandOrControl+Shift+L), `otherWhereZone1`, `otherWhereZone2`,
`otherWhereUseZone2`, `otherWhereLive` (false), `otherWhereLiveSec` (45, 30-120), `otherAfkIntervalSec` (15),
`otherAfkFirstKey` (F2), `otherAfkCycleKey` (F1), `otherAfkMaxMin` (120, 0 = no limit), `otherAfkWhereRead` (true).
Doc fields: `where` (replaces `currentLocation` / `currentLocationAt`; carries `accuracy` 0-10), `startTypedAt`,
`trackedMissionId` (+ `trackedAt`).

IPC added for the hotkey recorder: `otherHotkeys:pause`, `otherHotkeys:resume` (re-runs upstream `registerHotkey()`
through the `reregisterHotkeys` callback), `otherHotkeys:check` (accelerator → `{ ok, reason?: 'invalid' | 'in-use' }`).
In `whereAmI.ts`: `syncWhereLive()` / `stopWhereLive()` (live timer, called by `registerOther()` and by
`onOtherSettingsChanged(patch)` from the upstream settings-set handler), `runLiveWhere()`, `getWhereLiveStats()`.

**Data flow (WHERE AM I).**

```
hotkey otherWhereHotkey ──┐
overlay WHERE AM I button ┴─► otherWhere:run ─► main/whereAmI: one capture + Tesseract (or SC_WHERE_TEXT_FILE)
   ─► OCR zone 2 (if otherWhereUseZone2) ─► parseDisplayInfo ─► resolveDisplayInfo ─┐
   └► else / fallback OCR zone 1 ─► parseMapLine ─► resolveMapLine ─────────────────┤
                                                    WhereRunResult {ok, where, zone, raw, ms}
   ─► evt:other:where to ALL windows
        main window store: applyWhere(where) ─► doc.where ─► saveOtherJobs ─► jobsChanged
        overlay: shows the message only, reloads on jobsChanged
   ─► resolveOrigin({typed, typedAt, where, mode}) ─► listOpenStops(origin) ─► overlay card / Next page
```

**Data flow (live reads).**

```
settings otherWhereLive / otherWhereLiveSec ─► settings-set handler ─► onOtherSettingsChanged(patch) ─► syncWhereLive()
   timer every N s (skipped while a read runs, a hotkey is being recorded, or Work mode is not Other)
   ─► runLiveWhere() ─► runWhere({ zones: 2, why: 'live' }) ─► same parse / resolve as above (+ checks, accuracy, info)
   ─► evt:other:where to ALL windows ─► main window: applyWhere only when ok (sets trackedMissionId from info.trackedMission)
        overlay: silent, except one quiet message after 3 live failures in a row
   ─► getWhereLiveStats() ─► diagnostics SNAPSHOT (reads, ok, failed, skipped)
```

**Data flow (AFK).**

```
overlay AFK button ─► otherAfk:start ─► main/afk.ts (Windows; SC_AFK_DRYRUN = record only, any OS)
   every otherAfkIntervalSec: game window to front ─► PowerShell helper SendInput (scan code)
        press 1 = otherAfkFirstKey (F2, map), later presses = otherAfkCycleKey (F1)
        about once a minute, ~2 s after a press (otherAfkWhereRead): runWhere({ why: 'live' }) as above
   ─► evt:other:afk (AfkState) to ALL windows ─► overlay "AFK ON · next key in N s"; diagnostics SNAPSHOT (on, presses, lastError)
   stops: button (otherAfk:stop), game window gone, otherAfkMaxMin, app will-quit; leaves the game focused
```

Other clues take the same last step: a tick or a log Objective Complete sets `where` to that step's place;
inventory log events set or clear it. None of them moves the log watermark (`lastLogEventAt` / `lastLogEventCount`).

**Data flow (diagnostics export, batch 3).**

```
Settings / Debug EXPORT DIAGNOSTICS (note, "Include images" off by default) ─► diagExport IPC ─► buildDiagnostics(opts)
   ├► main window: diagSnapshotRequest ─► SNAPSHOT { other: otherDiagSnapshot() (+ locationHistory, lookup, travel, places), haul }
   ├► overlay window (overlayWindow()): diagSnapshotRequest, own reqId ─► { overlay: overlayDiag() } ─► ## OVERLAY
   ├► setOtherDiagSource.sections() ─► ## WHERE AM I HISTORY, CAPTURE, LIVE, HOTKEYS (getWhereDiag), ## AFK LOG (getAfkDiag)
   ├► trace parse records + Game.log stat ─► ## GAME LOG HEALTH
   └► sanitiser over every text line ─► save dialog ─► <file>.txt
        includeImages: getWhereImages() (zone1/zone2 crops) + overlay capturePage() ─► <base>-zone1/-zone2/-overlay.png ─► ## IMAGES
```

Replay scenarios (`test/replay/replay.mjs`): `diag-sections-new`, `diag-images` (the save dialog is answered through
the main-process inspector, `--inspect=<port>`; both fail on the batch-2 build 0fcf528).

**Known limits.**
- Zone 2 needs `r_DisplayInfo 3` on in game, and both zones need recalibrating after a resolution or UI-scale change.
- Surface positions use a fixed snapshot of place coordinates in each body's own (turning) frame; the game's solar
  `Pos` line is rotated by the body's spin and is not used near a body.
- The map on a planet or moon gives only the body centre (its bottom line has no surface position).
- Map coordinates `0.00° 0.00°` are ignored as a position (not a real direction; the name is used instead); the
  distance is truncated to 0.01 Gm, so map positions are good to about 5-10 Mm.
- Quantum travel and ATC log lines are not used: none names the place.
- AFK sends keys only on Windows and has not been run against the game here (Linux build; dry run only).
- A real zone 2 OCR read takes about 5 s, so live reads are spaced 30 s or more.

## Other mode: places from markers, pickup order, clipboard (batch 4, 2026-10-14)

Rules 21-25 in [STANDALONE.md](../src/other/STANDALONE.md) (re-tie point 17 for the clipboard); case and audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#places-from-markers-pickup-order-clipboard-batch-4).

| File | Owns (batch 4) | Entry points |
|---|---|---|
| `src/other/otherMarkers.ts` | Body-frame calibration (F1): radius estimate per body, candidate bodies within ±3% of the marker's distance, centre + position within 10 km of a body place, exactly one body | `bodyCentre(body, locations)`, `bodyRadius(body, locations, lookup?)` (lookup = planet table, else median distance of the body's places), `bodyFrameMatch(marker, locations, lookup?)` → `{ match, why, candidates, accepted }`; `calibrateZone(...)` change `'body'`; types `BodyRadiusLookup`, `BodyFrameMatch`, `BodyFrameResult` |
| `src/other/renderer/state/otherJobs.ts` | Calls `calibrateZone` with the merged roster (`mergeLocations`); clears the current build's zone table on `session`, `disconnect`, `quit` (F3) | internal `resetZones(d, why)`; decide trace `marker zones reset: <why>` |
| `src/other/otherNext.ts` | `near` on marker-placed rows (F2); pickup before same-item delivery (F4) | `NEAR_MAX_M` (25 km), `nearestRosterPlace(point, locations)`, `formatPlaceNear(place, near, locations)`, `stepWorkOrder(steps)`, `nextLiveStep()`, `listOpenStops()` (rows and groups carry `near?`); type `PlaceNear` |
| `src/other/renderer/components/OtherOverlay.tsx`, `src/other/renderer/pages/NextPage.tsx` | "<place> · near <roster place> (<dist>)" instead of "Not found in UEX" when a marker distance exists | — |
| `src/main/diagnostics.ts`, `src/shared/trace.ts`, `src/main/index.ts` (upstream) | Clipboard copy after a UI export (C); never for `--export-diagnostics` | `buildDiagnostics({ ..., copyToClipboard })` → `{ ..., copied? }`; `diagResultLine(r)`, `fmtDiagBytes(n)`; Settings / Debug result line |
| `test/replay/marker_checks.mjs` | F1 on the real J74 marker and the roster: lands ≈4 km from HDPC-Cassillo; a microTech-radius marker with no near place stays uncalibrated; the ambiguity rule | `node test/replay/marker_checks.mjs` (bundles with esbuild; no build needed) |

**Data flow (marker → place).**

```
Game.log CreateMarker (zoneHostId, position) ─► otherLogParse 'marker' ─► otherJobs reducer (main window)
   zone table d.markerZones[build] ─► calibrateZone(table, marker, mergeLocations(roster))
        root / small / z-match with a UEX place ─► as before
        else bodyFrameMatch: radius ±3% and a body place within 10 km, exactly one body ─► zone centre = body centre
   ─► resolveMarker ─► step.position (system frame)
   ─► listOpenStops: distance from the start; near = nearestRosterPlace(point) within 25 km
   ─► overlay / Next: "Security Compound · near HDPC-Cassillo (4 km)"
'session' (Log started) / 'disconnect' / 'quit' ─► resetZones: delete d.markerZones[build] (step positions kept)
```

Replay scenarios (`test/replay/replay.mjs`, all fail on the batch-3 build e46aba2 except the CLI guard):
`j74-near-place` (J74 from its real lines, pickup done: overlay and Next show a distance and "near HDPC-Cassillo",
the table distance matches Hurston centre + marker position), `j74-pickup-first` (first open stop is the Farnesway
pickup), `j74-session-resets-zones` (session line and disconnect empty the zone table; a later marker
recalibrates; step position kept), `diag-clipboard` (UI export: clipboard text equals the saved file, `copied`
true), `diag-cli-no-clipboard` (guard: the command line export leaves a sentinel on the clipboard; passes on the old
build too, since it never copied). `REPLAY_ROOT=<folder>` runs the scenarios against another build (a copy of the
old `out/` with its `package.json` and `data/`).

**Known limits.**
- A body's radius is estimated from its roster places (median distance from the centre); a body with no places
  with coordinates can't be matched. The local planet table (src/other/otherBodies.ts, main/bodies.ts, userData/other-bodies.json) refines it with the panel's exact `Radius:` once read; marker points take their body from the nearest place within 25 km so same-body legs are measured over the surface.
- Hurston and microTech are both ~1000 km: only the 10 km place check tells them apart; a marker with no place near
  it on either stays uncalibrated ("Not found in UEX").
- `near` is a label only: the stop's distance comes from the marker point, not from the near place.
- A zone table is reset on every session line, disconnect and quit, so the first marker after a server change must
  calibrate again (from a z-match or a body frame).

## Other mode: REFRESH and the sanitiser user-name fix (batch 5, 2026-10-14)

Rules 26-28 in [STANDALONE.md](../src/other/STANDALONE.md#refresh-user-2026-10-14); case and audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#refresh-and-the-sanitiser-user-name-fix-batch-5).

| File | Owns (batch 5) | Entry points |
|---|---|---|
| `src/other/main/scanLog.ts` | Re-scan for REFRESH: newest `logbackups` file + Game.log, no watermark, only `session` lines and `marker` events of the given missions, in log order | `scanMarkersFor(logPath, missionIds)` → `{ events, files, ms }`, `pickRefreshEvents(events, ids)`, `resetLocationRoster()` |
| `src/other/main/jobs.ts` | IPC handlers; `refreshedForVersion` in doc validation | `otherJobs:refreshScan` (missionIds → scan result), `otherPlaces:refresh` (re-pull places, reset the roster) |
| `src/shared/channels.ts`, `src/preload/index.ts` | Channels and bridge | `IPC.otherJobsRefreshScan`, `IPC.otherPlacesRefresh`; `window.supercargo.refreshScanOther(ids)`, `refreshOtherPlaces()` |
| `src/other/otherJob.ts` | Doc field | `OtherJobsDoc.refreshedForVersion?: string` (app version + commit the automatic refresh last ran for) |
| `src/other/renderer/state/otherJobs.ts` | Refresh-only apply path in the main window: reset the build's zone table, `calibrateZone` from the returned markers, `placeSteps` over all jobs; never the watermark, status, done flags, history; automatic run once per version after the start-up scan | `refreshJobs(opts?: { silent?: boolean }): Promise<RefreshResult>` (`{ jobs, markers, placed, zones, message }`); decide trace `refresh`, `auto refresh: new version` |
| `src/other/renderer/state/otherDiag.ts` | Last refresh result and `refreshedForVersion` in SNAPSHOT | `lastRefresh`, `refreshing` |
| `src/other/renderer/pages/NextPage.tsx`, `JobsPage.tsx` | REFRESH button (Next next to STARTING AT, Jobs header), disabled while running, result line ~6 s | `RefreshButton` |
| `src/main/sanitize.ts` (upstream) | OS user name → `%USERNAME%` only in home paths and as a whole value; never inside words or JSON keys; common-word names (`root`, `admin`, ...) never as a bare word | `makeSanitizer(id, user)` → `Clean(s, isKey?)`; `sanitizeDeep` cleans keys with `isKey` |
| `test/replay/refresh_checks.mjs`, `test/replay/sanitize_checks.mjs` | Unit-level checks for the refresh filter / apply path and the sanitiser user-name rules (name `root` keeps `"root"` keys and the word; home paths cleaned) | `node test/replay/<file>` |
| `test/replay/replay.mjs`, `test/replay/run_all.mjs` | Scenarios `refresh-places-j74`, `refresh-auto-once`; each app gets its own Xvfb display (`-displayfd`), every started app/X server is killed on exit; `--log` exits 3 when the app never became ready and `run_all` retries only that, once | `node test/replay/replay.mjs refresh-places-j74 refresh-auto-once` |

**Data flow (REFRESH).**

```
REFRESH button / first start of a new version (main window only)
  ─► refreshOtherPlaces (main: re-pull UEX/starmap, reset roster) ─► loadOtherPlacesFromMain (place list version bump)
  ─► refreshScanOther(active mission ids) ─► main scanMarkersFor: logbackups newest + Game.log, NO watermark
        keep: session lines + markers of those missions (log order)
  ─► renderer: markerZones[build] = {} ─► calibrateZone per marker (root / small / z-match / body frame)
        ─► placeSteps over all jobs ─► step.position ─► overlay / Next "near HDPC-Cassillo"
  untouched: lastLogEventAt / lastLogEventCount, job status, done flags, history; no job created or ended
  ─► result line (~6 s), decide trace 'refresh', debug log; auto run stores refreshedForVersion
```


## Other mode: pickup distance, bad reads, copy buttons (batch 6, 2026-10-14)

Rules 29-33 in [STANDALONE.md](../src/other/STANDALONE.md#pickup-distance-and-bad-reads-batch-6-user-2026-10-14)
(re-tie point 18 for the copy buttons); case and audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#pickup-distance-bad-reads-copy-buttons-batch-6).

| File | Owns (batch 6) | Entry points |
|---|---|---|
| `src/other/otherNext.ts` | A1: last lookup tier on folded names with doubled zeros collapsed ("S1DCO06" = "S1DC06"), exact only; A2: an open pickup is never measured from the step's marker (the drop-off on a combined step) | `findRosterLocation()`, `explainPlaceLookup()` (method `folded`), internal `foldZeros()`, `stepPointWithSource()` (marker only when `!stepIsPickup(step)`), `stepIsPickup()` |
| `src/other/otherWhere.ts` | B1: `knownSystem()` returns '' for unknown names (display info); the map line keeps its title-cased word (internal `systemWord()`, `titleSystem()`); B2: the body is looked up in the read system, then in every system; B3: near a body with a failed body position → `null` with a `position` check, no SolarSystem / Root fallback (that path is for space only) | `knownSystem()`, `resolveDisplayInfo()` |
| `src/main/diagnostics.ts` (upstream) | C: keeps the last UI export (`path`, `images`, combined picture); stitches the saved pictures into `<base>-all.png` with Electron `nativeImage` (bitmap in, bitmap out, no new packages); the copy handlers | `registerDiagCopy()` (IPC `diag:copyText`, `diag:copyImages`), `copyLastExportText()` → `{ ok, bytes?, error? }`, `copyLastExportImages()` → `{ ok, width?, height?, error? }`; `buildDiagnostics()` → `{ ..., combinedImage? }` |
| `src/shared/trace.ts`, `src/shared/channels.ts`, `src/preload/index.ts` (upstream) | Types, channels and bridge for the copy buttons; the pure stitcher | `DiagCopyTextResult`, `DiagCopyImagesResult`, `diagCopyTextLine()`, `diagCopyImagesLine()`, `Bitmap`, `stitchBitmaps()`; `IPC.diagCopyText`, `IPC.diagCopyImages`; `window.supercargo.diagCopyText()`, `diagCopyImages()` |
| `src/renderer/src/pages/SettingsPage.tsx`, `DebugPage.tsx` (upstream, export area) | COPY TEXT / COPY IMAGES next to the result line after a successful export; feedback for ~4 s | — |
| `test/replay/next_order.mjs`, `where_checks.mjs`, `diag_checks.mjs` | Unit-level checks: the S1DCO06 lookup and the J82 pickup distance; the real Covalex raw reads; stitch sizes, gaps and pixels | `node test/replay/<file>` |
| `test/replay/replay.mjs` | Scenarios `j82-pickup-here`, `where-covalex-garbled`, `diag-copy-buttons`, `diag-copy-none` (real app path) | `node test/replay/replay.mjs j82-pickup-here where-covalex-garbled diag-copy-buttons diag-copy-none` |

**Data flow (pickup distance).**

```
listOpenStops(origin) ─► per row stepPointWithSource(step)
   pickup open (stepIsPickup): findRosterLocation(pickupLocation) ─► exact / contains / folded (doubled zeros) ─► place point
        not found ─► no distance (no-distance text); step.position (the drop-off marker) is NOT used
   pickup done / plain step: place point, else step.position (marker) ─► near = nearestRosterPlace (rule 22)
```

**Data flow (copy buttons).**

```
EXPORT DIAGNOSTICS ─► buildDiagnostics ─► <file>.txt (+ pictures when ticked)
   pictures ─► nativeImage.toBitmap ─► stitchBitmaps (side by side, top-aligned, 16 px black gaps) ─► <base>-all.png
   main keeps the last export { path, images, combined }
COPY TEXT   ─► diag:copyText   ─► read <file>.txt ─► clipboard.writeText ─► "Text copied · 1.1 MB"
COPY IMAGES ─► diag:copyImages ─► clipboard.writeImage(<base>-all.png) ─► "Picture copied (3 in one)"
   no export yet ─► { ok: false, error: 'no export yet' }
```

Replay scenarios (all fail on the batch-5 build f45af9f): `j82-pickup-here` (J82's real step with the doubled-O
pickup and the real drop-off marker point, start from the real planet-line read at Covalex: table row ~0.3 km and not
from the marker, overlay "from you" ~0.3 km with no "near", Next tab the same), `where-covalex-garbled` (the user's
real "Open space" reads give Covalex S1DC06 ~250-320 m, accuracy 10; the planet-line read is unchanged; the "Rappel"
read gives no position, says why in `## WHERE AM I HISTORY` and leaves the start alone), `diag-copy-buttons` (export with
pictures: `<base>-all.png` saved and listed, size = side by side + 16 px gaps; COPY TEXT replaces a sentinel on the
clipboard with the saved file; COPY IMAGES puts an image of the combined size there), `diag-copy-none` (both buttons
before an export: "no export yet"). The where reads have their ServerTime line set to the test time (otherwise −3 for
"maybe stale"); the rest of each text is verbatim.

**Known limits.**
- The doubled-zero tier is exact-match only; other OCR doublings ("S11DC06") still find nothing.
- A pickup place that can't be found shows no distance until it is found or the pickup is done.
- A read near a body whose body can't be placed gives no position at all (the start is kept), even where the
  star-frame line would have been close.
- The test seam captures nothing, so in replay `<base>-all.png` holds only the overlay picture; stitching several
  pictures is checked in `diag_checks.mjs`.

## Other mode: one stop-place resolver (batch 7, 2026-10-14)

Rules 34-41 in [STANDALONE.md](../src/other/STANDALONE.md#one-stop-place-resolver-batch-7-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#one-stop-place-resolver-batch-7). Replaces the batch 4/6 lookup chain above
(`stepPointWithSource`, `withNearBody`, the folded / doubled-zero tiers): every screen, the route sort and diagnostics
read one `StopPlace` per stop.

| File | Owns (batch 7) | Entry points |
|---|---|---|
| `src/other/otherResolve.ts` (new, pure) | The one normaliser and the evidence-weighing resolver; generic sites and their parent place | `placeKey()`, `resolveStopPlace(step, ctx)`, `resolvePlaceText(text, ctx, marker?)`, `matchWord(status)`, `NEAR_MAX_M`; types `MatchStatus`, `Evidence`, `Candidate`, `StopPlace` (`site?` for generic sites), `ResolveCtx` |
| `src/other/otherNext.ts` | Stop rows, distances and route order read the resolver (one call per step per `listOpenStops` run); `findRosterLocation` (typed starts) uses `placeKey`; re-exports `NEAR_MAX_M` | `listOpenStops()` (`originIsRead?` opt; rows and groups carry `match`), `explainPlaceLookup()` (wrapper over `resolvePlaceText`) |
| `src/other/renderer/state/otherJobs.ts`, `src/other/otherJob.ts` | Markers stored for every step whose objective has one (evidence); "learned" only for status `marker` | `placeSteps()` |
| `src/other/renderer/state/otherDiag.ts`, `src/main/diagnostics.ts` (upstream) | SNAPSHOT row `match`; `other.matches`; `## MATCHES` after `## SNAPSHOT` ("(all exact)" when none) | `matchesText()` |
| `src/other/renderer/components/MatchTag.tsx` (new), `OtherOverlay.tsx`, `pages/NextPage.tsx`, `pages/JobsParts.tsx` | The match tag (word + confidence colour, evidence tooltip); "<site> · at <place>" labels; "not sure: A or B?" line | `MatchTag` |
| `test/replay/resolve_checks.mjs`, `test/replay/fixtures/stop_cases.json` (new) | The real-case table and a check per scoring / decision rule | `node test/replay/resolve_checks.mjs` |
| `test/replay/replay.mjs` | Scenarios `match-j82-corrected`, `match-j82-dropoff-site`, `match-j74-marker`, `match-lookalike-other-body`, `match-two-equal`, `match-all-exact`; helper `matchRun()`; `MATCHES` added to the required export sections; the J74 / REFRESH checks accept "at HDPC-Cassillo" | see the command below |

**Data flow.**

```
listOpenStops(origin) ─► per open step resolveStopPlace(step, { locations, useMarker, here: origin if read })
   active text (pickup place while stepIsPickup, else step.location) ─► placeKey + address hints (body / system)
   marker = step.position, except while the pickup is open (it belongs to the drop-off)
   roster candidates ─► name / body / system / marker / here evidence ─► scores
      clear winner (>= 5, +3 over runner-up) ─► exact / corrected / guess   (> 10 km from marker ─► mismatch, marker point)
      no name candidate (generic site) ─► site: contract-named place within 25 km of marker, else nearest place to marker
      no winner + marker ─► marker (conf 8)   no marker: tie ─► unsure   else ─► none (no distance)
   ─► StopPlace { label, point, source, status, confidence, evidence, candidates, near, site }
   ─► rows / groups / route sort ─► overlay header + Next + Jobs (MatchTag) ─► SNAPSHOT match + ## MATCHES
```

Run only the batch 7 app scenarios (after `npm run build`):
`node test/replay/replay.mjs match-j82-corrected match-j82-dropoff-site match-j74-marker match-lookalike-other-body match-two-equal match-all-exact`

**Known limits.**
- A generic site with no marker and no place named in the contract shows no distance ('none').
- Two equal candidates with no marker stay 'unsure' until the game gives a marker.
- Address hints only come from "... on <body>" style text; a body named elsewhere in the text isn't used.

## Other mode: match memory (batch 8, 2026-10-14)

Rules 42-49 in [STANDALONE.md](../src/other/STANDALONE.md#match-memory-batch-8-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#match-memory-batch-8). The resolver (batch 7) now also reads a local memory
of past matches: what it saw, what the game proved (Objective Complete + a fresh position read) and what the user set.

| File | Owns (batch 8) | Entry points |
|---|---|---|
| `src/other/otherMemory.ts` (new, pure) | The memory doc: entries, changes (before/after, last 50), caps (500 entries, user entries kept), proof counting, disputed rule, labels | `memoryKey()`, `lookupMemory()`, `recordSeen()`, `recordProof()`, `setUserPlace()`, `forgetEntry()`, `undoChange()`, `learnedPlace()`, `memoryLabel()`, `emptyMemoryDoc()`; `MEMORY_MAX`, `CHANGES_MAX`, `PROOF_WINDOW_MS`, `PROOF_METERS`; types `MemoryEntry`, `MemoryChange`, `MemoryDoc`, `MemoryWhere`, `MemoryOrigin` |
| `src/other/main/matchMemory.ts` (new) | `userData/other-matches.json` (atomic write, saves coalesced to 1 per second, doc validation); IPC handlers; broadcast to every window; `## MATCH MEMORY` diagnostics section | registered from `src/other/main/register.ts` |
| `src/shared/channels.ts`, `src/preload/index.ts` (Other blocks) | `otherMemory:get` / `:seen` / `:proof` / `:set` / `:forget` / `:undo`, `evt:other:memory` | `otherMemoryGet/Seen/Proof/Set/Forget/Undo`, `onOtherMemory` |
| `src/other/otherResolve.ts` | `ResolveCtx.memory`; statuses `user` ("✓ you set") and `learned` ("✓ learned"); user entry wins outright (10, disputed 6); learned +4, proven wrong −4; `StopPlace.memoryKey` and `memory` | `resolveStopPlace()` |
| `src/other/otherNext.ts` | `ListOpenStopsOpts.memory` passed into the resolver (also the step distance helpers) | `listOpenStops()` |
| `src/other/renderer/state/otherMemoryStore.ts` (new) | Renderer copy of the doc; the main-window-only "seen" reporter (debounced 5 s) | `startOtherMemory()`, `memoryDoc()`, `memoryLookup()`, `useMemory()`, `useMemoryLookup()`, `startMemorySeenReporter()` |
| `src/other/renderer/state/otherJobs.ts` | Game proof on Objective Complete, read before `where` moves to the step (main window only) | the `objective` case |
| `src/other/renderer/state/otherDiag.ts` | Memory passed to `listOpenStops`; SNAPSHOT memory counts (entries, user, learned, disputed) | |
| `src/other/renderer/components/MatchTag.tsx`, `MatchFix.tsx` (new), `LearnedPlaces.tsx` (new), `src/other/renderer/settingsBlock.tsx` | Tag as a button opening the fix panel (✓ Right / ✗ Wrong → pick / Forget); LEARNED PLACES table, filter, search, Change / Forget, Recent changes with Undo | `MatchFix`, `LearnedPlaces` |
| `OtherOverlay.tsx`, `pages/NextPage.tsx`, `pages/JobsParts.tsx` | Pass `memory: useMemoryLookup()` into the resolver | |
| `test/replay/memory_checks.mjs` (new) | Pure checks of every `otherMemory` function, caps, undo, disputed and learned thresholds | `node test/replay/memory_checks.mjs` |
| `test/replay/replay.mjs` | Scenarios `memory-wrong-pick`, `memory-undo`, `memory-proof-learned`, `memory-disputed`, `memory-diag-section`; helpers `memLaunch()`, `memRead()`, `memSetVia()`, `uiWrongPick()`, `memFile()`; `MATCH MEMORY` added to the required export sections | see the command below |

**Data flow.**

```
main window: listOpenStops (debounced 5 s) ─► non-exact stops ─► otherMemory:seen ─► recordSeen ─► other-matches.json
Objective Complete (main window) ─► prev where (displayinfo/map/inventory, acc >= 7, <= 10 min)
   ─► resolve the step's place ─► within 1.5 km? ─► otherMemory:proof ─► recordProof (confirmed / wrong + where you were)
tag click / LEARNED PLACES ─► otherMemory:set / :forget / :undo ─► new doc returned + evt:other:memory to every window
every window: useMemoryLookup() ─► resolveStopPlace ctx.memory
   user entry ─► status user (10; disputed 6, "⚠ the game disagrees")   learned entry ─► +4 (status learned if it wins)
   wrong >= 2 ─► −4   ─► tags, Next, Jobs, overlay ─► SNAPSHOT + ## MATCHES + ## MATCH MEMORY
```

Run only the batch 8 app scenarios (after `npm run build`):
`node test/replay/replay.mjs memory-wrong-pick memory-undo memory-proof-learned memory-disputed memory-diag-section`

**Known limits.**
- Proof needs a position read near the completion (within 10 minutes, accuracy 7+); without one nothing is learned.
- A stop the resolver gets exactly right is not remembered (exact matches are left out of the log).
- The memory is per PC (`userData`); it is not shared or exported other than in diagnostics.

## Other mode: data sources, OCR typo matching, OCR tune-up (batch 8 addendum 2, 2026-10-14)

Rules 50-56 in [STANDALONE.md](../src/other/STANDALONE.md#data-sources-ocr-typo-matching-ocr-tune-up-batch-8-addendum-2-user-2026-10-14);
audit in [OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#data-sources-ocr-typo-matching-ocr-tune-up-batch-8-addendum-2). No new data
source: the roster is still UEX plus the bundled starmap file, now tagged by source with a switch for the starmap.

| File | Owns (addendum 2) | Entry points |
|---|---|---|
| `src/shared/types.ts` (upstream, re-tie 20) | `Location.source?` and `Location.coordsFrom?` (`'uex' \| 'starmap'`) | |
| `src/other/main/uex.ts` | Sets the tags: `fillFromPositions` -> `coordsFrom: 'starmap'`, `addStarmapPlaces` -> `source: 'starmap'` | `loadOtherPlaces()`, `refreshOtherPlaces()` |
| `src/other/workMode.ts` | Setting `otherSourceStarmap` (default on) in `OTHER_SETTING_DEFAULTS` | `otherSetting()` |
| `src/other/renderer/state/otherPlaces.ts` | Off: drops starmap-only places and strips starmap-filled coordinates (and the body that came with them); `useMergedLocations` re-computes on the setting. Body fill: a place with coordinates but no body takes the body of the same place (same name or Center/Centre spelling) within 1 km | `mergeLocations()`, `useMergedLocations()` |
| `src/other/renderer/components/DataSources.tsx` (new), `src/other/renderer/settingsBlock.tsx` | Settings → OTHER MODE → DATA SOURCES: one row per source with counts and its switch (UEX: "base list", always on) | `DataSources` |
| `src/other/renderer/components/LearnedPlaces.tsx` | "(place's source is off)" on entries whose place isn't in the active sources | `LearnedPlaces` |
| `src/other/renderer/state/otherDiag.ts` | `placeSource` uses the tags; SNAPSHOT shows the enabled sources | |
| `src/other/otherResolve.ts` | Confusion-folded keys (`corrected` +5); weighted Damerau-Levenshtein "close spelling" (+4 / +3); code words must fold equal; "· from starmap data" on starmap candidates | `resolveStopPlace()`, `placeKey()` |
| `src/other/main/whereAmI.ts` | Own tesseract.js worker for zone 2 only (page mode 6, interword spaces, Sauvola `thresholding_method` 2); zone 1 keeps the shared engine; falls back to it when the worker won't load; `zone2-prepped` picture in `## IMAGES` | `SC_WHERE_TEXT_FILE` seam unchanged |
| `src/other/main/ocrPrep.ts` (new, pure JS on the BGRA bitmap) | Grey, invert, scale to ~30 px text (capped ~4 Mpx); `OCR_PARAMS`, `ZONE_PSM`. No global Otsu (it dropped text over bright sky/glare); Tesseract thresholds locally | `prepForOcr()` |
| `test/replay/sources_checks.mjs` (new) | `mergeLocations` on/off: starmap-only places gone, filled coordinates stripped, UEX coordinates kept | `node test/replay/sources_checks.mjs` |
| `test/replay/resolve_checks.mjs`, `test/replay/fixtures/stop_cases.json` | A row per typo rule; the OCR-misread rows re-decided (right place or `none`, never a wrong place) | `node test/replay/resolve_checks.mjs` |
| `test/replay/ocr_bench.mjs` (new) | Old (3×, page mode 3) vs new pipeline on a real zone 2 crop: ms and parsed fields | `node test/replay/ocr_bench.mjs` |
| `test/replay/replay.mjs` | Scenarios `sources-starmap-off`, `typo-close-spelling`; helpers `sourcesText()`, `sourcesToggle()`, `sourceCounts()`, `J82_PICKUP_STEP` | see the command below |

**Data flow.**

```
main/uex.ts: UEX places (source uex) ─► fillFromPositions (coordsFrom starmap) ─► addStarmapPlaces (source starmap) ─► getOtherPlaces
renderer: mergeLocations(haul, places, otherSourceStarmap)
   off ─► drop source starmap, strip coordsFrom starmap ─► resolver / distances / LEARNED PLACES / SNAPSHOT
resolver: exact (+6) ─► placeKey equal (+5) ─► confusion-folded equal (+5, corrected) ─► close spelling (+4 / +3, code words must fold equal)
WHERE AM I zone 2: capture ─► ocrPrep (grey, invert, scale ~30 px) ─► own Tesseract (psm 6, Sauvola) ─► parseDisplayInfo
WHERE AM I zone 1: capture ─► shared engine as before (until a map-line crop is benchmarked)
```

Run only the addendum 2 app scenarios (after `npm run build`):
`node test/replay/replay.mjs sources-starmap-off typo-close-spelling`

**Known limits.**
- With the starmap off, places only it knows (aid shelters, wrecks, small outposts) and coordinates it filled are gone: those stops show no distance.
- Close spelling can't tell apart two places whose names differ only by a code word; those stay "? not sure" or "✗ not found".
- The OCR prep scales from the crop height and the game resolution; a panel font size far from the default needs the calibrator.
- Bench (`ocr_bench.mjs`, real 5120×2160 zone 2 crop): old 26.5 s, 20/26 fields; new 13.4 s, 21/26.

## Other mode: Star Citizen Wiki game data (batch 8 addendum 3, 2026-10-14)

Rules 57-60 in [STANDALONE.md](../src/other/STANDALONE.md#star-citizen-wiki-game-data-batch-8-addendum-3-user-2026-10-14).
The scunpacked-data project (Star Citizen Wiki) already fed the bundled starmap positions; its `trade_locations.json` now
gives the site codes (which place has a Security Compound, Storehouse, …). One switch (`otherSourceStarmap`) covers both.

| File | Owns (addendum 3) | Entry points |
|---|---|---|
| `scripts/gen-site-codes.mjs` (new) | Builds `data/uex/site-codes.json` from `trade_locations.json` | `node scripts/gen-site-codes.mjs` |
| `data/uex/site-codes.json` (new, bundled) | `{ generatedAt, sites: [{ code, name, parentCode?, parentName? }] }` | |
| `src/other/otherSiteCodes.ts` (new, pure) | Site table lookups and the builders shared by the script and the updater | `siteByCode()`, `sitesNamed()`, `gameDataPlace()`, `parentForCode()`, `tradeCodeForPanel()`, `codeFromText()`, `stripCode()`, `buildSiteCodes()`, `buildStarmapPlaces()`, `normalizeSiteCodesDoc()`, `setSiteCodes()`, `siteCodesDoc()`; types `SiteCode`, `SiteCodesDoc`, `GameDataStatus`, `GameDataReply` |
| `src/other/main/gameData.ts` (new) | Bundled or `userData/game-data/` copy; UPDATE download (raw.githubusercontent.com, timeout, 10 MB cap, shape check) and rebuild; IPC; `## GAME DATA` | `registerOtherGameDataIpc()`, `getGameDataStatus()`, `getSiteCodes()`, `gameDataPositionsFile()`, `onGameDataUpdated()`, `updateGameData()`; `GAME_DATA_BASE`, `GAME_DATA_CREDIT` |
| `src/other/main/uex.ts` | Prefers the `userData/game-data/` positions over the bundled file | |
| `src/other/main/register.ts`, `src/shared/channels.ts`, `src/preload/index.ts` (re-tie 21) | `otherGameData:get` / `:update`, `evt:other:gameData`; `'GAME DATA'` diagnostics section | `otherGameDataGet()`, `otherGameDataUpdate()`, `onOtherGameData()` |
| `src/other/renderer/state/otherGameDataStore.ts` (new) | Renderer copy of the site table; imported from `otherJobs.ts` so both windows have it | `startGameData()`, `updateGameData()`, `useGameData()` |
| `src/other/renderer/components/DataSources.tsx` | Row "Star Citizen Wiki game data (scunpacked-data)": counts, bundled/downloaded date, UPDATE, credit, switch | `DataSources` |
| `src/other/otherResolve.ts` | Generic site at the contract parent: "game data: <parent> has a <site> ✓" +2 / "has no" −2; "[CODE]" -> exact parent ("game code <code> ✓", confidence 10); nothing when the switch is off | `resolveStopPlace()` |
| `test/replay/sitecodes_checks.mjs` (new) | Pure checks of the site table, code parsing and parents | `node test/replay/sitecodes_checks.mjs` |

**Data flow.**

```
scunpacked-data trade_locations.json ─► gen-site-codes.mjs ─► data/uex/site-codes.json (bundled)
UPDATE ─► otherGameData:update ─► download starmap_positions + trade_locations ─► userData/game-data/ ─► evt:other:gameData
main/gameData ─► otherGameData:get ─► otherGameDataStore (both windows) ─► otherSiteCodes ─► resolver (+2 / −2, [CODE] exact)
```

**Known limits.**
- An UPDATE doesn't remove starmap-only places from the earlier positions file until the next REFRESH rebuilds the place list.
- `data/uex/site-codes.json` is not in the `data/uex` hash sync; it changes only with a release or an UPDATE.
