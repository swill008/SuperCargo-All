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
| `index.ts` | App lifecycle, main and compact windows, CSP (packaged only), all IPC handlers (`registerIpc`), OCR auto-capture and hotkey, start-up data check, start-up update check | everything below |
| `logWatcher.ts` | Polls Game.log every 200 ms, handles rotation, emits contract events | `logParser` |
| `logParser.ts` | Regex parse of one log line into accepted, objective, ended, paid and share events | `shared/contract` |
| `scanLog.ts` | One-shot full log read to recover contracts accepted while the app was closed | fs |
| `contractData.ts` | Title, blueprint and box-size index from the game's `global.ini` and `contracts.ini`, plus overrides | fs, `shared/fuzzy` |
| `dataSync.ts` | Copies bundled `data/uex` into the data folder; refreshes from `raw.githubusercontent.com/AquatikJustice/SuperCargo/main/data/uex`, verified by `hashes.json` | GitHub |
| `uex.ts` | Loads the cached ships, locations, commodities, grid faces and contract overrides | data folder |
| `store.ts` | JSON persistence: settings (default folder), manifest, history, window state | data folder (`paths.ts`) |
| `capture.ts` | `desktopCapturer` grabs, crop, upscale and grayscale | Electron |
| `ocr/` | Engine selection (`tesseractEngine`, `onnxEngine`), `runOcr`, sample stash | jsdelivr (tess data), userData/ocr-model |
| `telemetry.ts` | Opt-in OCR sample upload queue (5 min retry) | Supabase Storage `ocr-samples` |
| `usageStats.ts` | Daily anonymous ping (**on by default**) | Supabase `usage_pings` |
| `boxReports.ts` | Box-size correction report when a contract ends (same flag) | Supabase `box_size_reports` |
| `updater.ts` | electron-updater wrapper: start-up / by-hand check, asks before download, skip, updated notice (batch 12) | GitHub Releases |
| `releaseNotes.ts` | "What's new" text for every version between the running and the offered one (batch 12) | GitHub API releases |
| `dataCheck.ts` | Damaged-data check and "Moved for Repair" (batch 12) | data folder |
| `installDetect.ts` | Finds Star Citizen installs (Windows: powershell + drive scan) | OS |
| `logger.ts` | Main-process debug log: memory ring + log file (`logger`, `getRecent`, `getProblems`, `onEntry`) | data folder (`paths.ts`), `shared/debugLog` |
| `trace.ts` | Diagnostics trace: memory ring + `logs/trace.jsonl` (rotated at 20 MB), 30 s perf sampler (`trace()`, `writeTrace()`) | data folder, `shared/trace` |
| `crash.ts` | Crash and window-health hooks; everything goes to the debug log, nothing exits | `logger` |
| `debugWindow.ts` | Debug window and the copy-paste bug report | `logger`, `store`, `shared/debugLog` |
| `crew.ts` | Crew sessions: one row per crew, the leader writes, members watch (realtime) | Supabase `crew_sessions` |
| `env.d.ts`, `assets.d.ts` | Type declarations: build-time constants `__APP_COMMIT__` / `__APP_BRANCH__` (from `electron.vite.config.ts`) and `?asset` imports | |

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
  - app:version, updater: check / quitAndInstall / download / skip / state / updatedNotice
  - refData: get / check; dataFolder: get / choose / reset / open / restart / repair
- **send (renderer → main, one-way):** loading:set, telemetry:boxReport, ocr:requestCapture, ocr:reportAccuracy.
- **events (main → renderer):**
  - evt:watcher:status, evt:contract:{accepted, ended, paid, share}, evt:objective
  - evt:ships / locations / commodities / gridFaces
  - evt:window:state, evt:ocr:result / status, evt:update, evt:refData
  - broadcast to every window: evt:manifest:changed, evt:compact:state, evt:loading:state, evt:settings (every settings change goes to the other windows, so the overlay follows the work mode and the Other-mode settings; R1 1.0.1)
  - `evt:openCapture` is declared but never sent.

### Network calls

| Call | When | Data |
|---|---|---|
| Supabase `usage_pings` | Launch, every 20 h or more, if `shareUsageStats` (default **on**) | Client UUID, version, platform, OCR engine and accuracy, resolutions, ships, toggles |
| Supabase `box_size_reports` | Contract ends, same flag | Mission id, contract title and name, objectives (full report) |
| Supabase Storage `ocr-samples` | Only if `contributeTrainingData` | Grayscale crop plus OCR text and corrections |
| GitHub raw `data/uex` | Launch and manual refresh | – |
| GitHub Releases | At launch when "Check for updates at start-up" is on (default), and on CHECK FOR UPDATES | – |
| GitHub API `repos/swill008/SuperCargo-All/releases` | With an update check that finds a new version (release notes) | – |
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
| `pickups.ts` | Per-pickup SCU amounts (the game shows only a total; the last unknown stop is found by subtraction) |
| `debugLog.ts` | Debug log contract shared by main, preload and both windows (levels, categories, `LogEntry`, `formatEntry`) |
| `release.ts` | Release naming (line "R1", product, owner/repo, `releaseLabel`), shared by the updater, the version line and `release_checks.mjs` |

## Preload (`src/preload`)

| File | Role |
|---|---|
| `src/preload/index.ts` | The context bridge: exposes `window.supercargo` (`SuperCargoApi`), one method per IPC channel |
| `src/preload/index.d.ts` | Type declarations for the preload API: declares `window.supercargo: SuperCargoApi` on the global `Window` for the renderer |

## Renderer (`src/renderer/src`)

- **Entry.** `App.tsx` renders `CompactWindowApp` for `#compact`, otherwise `MainApp`. Views are switched on
  `store.view` (manifest, contracts, grid, history, settings); there is no router.
- **State.** `state/store.ts` is a single zustand store holding UI state, the persisted manifest, the
  derived `route`, history, settings, UEX rosters and OCR state. `persist()` sends the full manifest to
  main on every change. Main writes it and broadcasts to the other window. No localStorage is used (the remembered
  Settings tab is in settings.json, `otherSettingsTab`, batch 10).
- **Event flow.**
  1. The main process emits an `evt:contract:*` event.
  2. A store listener runs `commit()`, then `persist()`.
  3. `scheduleReroute()` (250 ms) runs `computeRoutePlan` in `state/route.ts`, which calls `shared/route` and `shared/hold`.
  4. The pages read the result through atomic selectors.
- **State helpers.** `state/manifest.ts` (stops, totals, history entries), `state/loading.ts` (the
  loading-walk steps), `state/layout.ts` (frozen layout and reconcile).
- **Pages** (`pages/`). `ManifestPage.tsx`, `ContractsPage.tsx` (inline edit), `CargoGridPage.tsx` (3.5k lines:
  R3F hold, loading walk, drag and drop, Stor-All crates), `HistoryPage.tsx`, `SettingsPage.tsx`.
- **Components** (`components/`). `TopBar.tsx`, `BottomNav.tsx`, `CaptureModal.tsx` and `OcrCalibrator.tsx` (OCR),
  `ScanReviewModal.tsx`, `TurnInModal.tsx`, `BoxEditModal.tsx`, `Typeahead.tsx`, `Onboarding.tsx`, `UpdateBanner.tsx`,
  `PrivacyPolicy.tsx`; the overlay entry `CompactGate.tsx` (Other mode's checklist card, else stock
  `CompactWindowApp.tsx`); `CrashGuard.tsx` (render-crash boundary); `LoadBar.tsx` (aboard / peak / Stor-All reserve
  bar); `PageHeader.tsx`, `Placeholder.tsx`, `Toast.tsx`, `ui.tsx` (shared page header, empty-page text, toast,
  hover helpers).
- **Window-side helpers** (`state/`). `state/log.ts` (debug log lines batched to main), `state/trace.ts`
  (diagnostics trace batched to main), `state/haulDiag.ts` (Haul-mode snapshot for EXPORT DIAGNOSTICS),
  `state/useViewport.ts` (`useNarrow()` width hook).
- **Shell.** `src/renderer/index.html` (page shell, loads `main.tsx`), `src/renderer/src/main.tsx` (bundled fonts,
  React root), `global.css`, `theme.ts` (colours and fonts `C`, `F`), `vite-env.d.ts` (Vite client and font-import
  types).

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
| `src/other/renderer/components/OtherMapCalibrator.tsx` | Settings UI (Settings → OTHER MODE → Where Am I; batch 10) to set the two capture zones (`otherWhereZone1`, `otherWhereZone2`) on a preview grab and test each | `window.supercargo.otherWhereCalPreview()`, `otherWhereCalTest(zone)` |
| `test/replay/where_checks.mjs` | Parse/resolve checks for `otherWhere.ts`: map bottom lines and r_DisplayInfo 3 blocks transcribed from real screenshots, OCR-noisy variants and garbage, against the roster `data/uex/other-positions.json` | `node test/replay/where_checks.mjs` (bundles with esbuild; no build needed; separate from `run_all.mjs`) |
| `src/other/otherAfk.ts` | AFK button shared state and pure cycle: `AfkState`, key names → scan codes, which key each press sends, start / press / skip / stop steps, limits (`AFK_LAST_KEYS_MAX` 5, interval 5-600 s) | `afkConfig()`, `afkStart()`, `afkPressed()`, `afkSkipped()`, `afkStopReason()`, `afkStopped()`, `afkKeyForPress()`, `afkScanCode()`, `normaliseAfkKey()`; type `AfkState` |
| `src/other/main/afk.ts` | Main side of AFK: timer, bring the Star Citizen window to the front, press the key through a persistent PowerShell child running an Add-Type C# helper (SendInput with scan codes); Windows only (other systems: `lastError: 'Windows only'`); test seam `SC_AFK_DRYRUN=1` (no focus, no keys, presses recorded; `SC_AFK_INTERVAL_MS` sets the interval) | `registerOtherAfkIpc(getSettings)` (called by `registerOther()`) for IPC `otherAfk:start`, `otherAfk:stop`, `otherAfk:get`; broadcasts `evt:other:afk`; `stopOtherAfk()` (on `will-quit`); `getAfkState()`; `getAfkDiag()` (`{ state, presses[] (last 50), stderr[] (last 20), startupMs, restarts }`) for the export |
| `src/other/renderer/components/AccuracyMeter.tsx` | Position accuracy as colour: red (0) → amber (5) → green (10) from the theme; number and word always shown | `AccTag` (overlay `ACC n` tag + 10-segment bar), `AccSlider` (Next tab, under STARTING AT), `TrackedTag`, `accuracyColor()` |
| `src/other/renderer/components/HotkeyRecorder.tsx` | Click-to-record hotkey field producing an Electron accelerator ('' = off); pauses all app global hotkeys while recording; warns on clashes; shows "in use by another app" after a failed registration | default `HotkeyRecorder({ value, onChange, conflicts })`; helpers `keyFromCode()`, `accelFromEvent()`, `normAccel()`; uses `otherHotkeysPause()`, `otherHotkeysResume()`, `otherHotkeyCheck(accel)`. Used for WHERE AM I (Settings → OTHER MODE → Where Am I) and for the upstream OCR hotkey (`SettingsPage.tsx`, re-tie 14) |
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
`otherAfkFirstKey` (F2), `otherAfkCycleKey` (F1), `otherAfkMaxMin` (120, 0 = no limit). (`otherAfkWhereRead` was removed in batch 13: AFK takes no position reads; an old saved value is ignored.)
Doc fields: `where` (replaces `currentLocation` / `currentLocationAt`; carries `accuracy` 0-10), `startTypedAt`,
`trackedMissionId` (+ `trackedAt`).

IPC added for the hotkey recorder: `otherHotkeys:pause`, `otherHotkeys:resume` (re-runs upstream `registerHotkey()`
through the `reregisterHotkeys` callback), `otherHotkeys:check` (accelerator → `{ ok, reason?: 'invalid' | 'in-use' }`).
In `whereAmI.ts`: `syncWhereLive()` / `stopWhereLive()` (live timer, called by `registerOther()` and by
`onOtherSettingsChanged(patch)` from the upstream settings-set handler), `runLiveWhere()`, `getWhereLiveStats()`.

**Data flow (WHERE AM I).**

```
hotkey otherWhereHotkey ──┐
overlay WHERE AM I button ┴─► otherWhere:run ─► main/whereAmI: one capture + own Tesseract worker for both zones (or SC_WHERE_TEXT_FILE)
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
  with coordinates can't be matched. The local planet table (src/other/otherBodies.ts, main/bodies.ts, <data folder>/other-bodies.json) refines it with the panel's exact `Radius:` once read; marker points take their body from the nearest place within 25 km so same-body legs are measured over the surface.
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
| `src/other/otherWhere.ts` | B1: `knownSystem()` returns '' for unknown names (display info); the map line keeps its title-cased word (internal `systemWord()`, `titleSystem()`); B2: the body is looked up in the read system, then in every system; B3: near a body with a failed body position → `null` with a `position` check, no SolarSystem / Root fallback (that path is for space only); place naming (2026-10-14, rules 16/32): station (panel `playerLocationCode` or a hangar / rest-stop / station zone via the site-code table, `inHangar` → "(hangar)") → POI ("<name> · <body>") → planet (within 100 km, "Hurston · N km up") → "Open space"; unknown codes keep the old wording; the naming is recorded in `checks`; new `Where.placeKind` | `knownSystem()`, `resolveDisplayInfo()`; `DisplayInfo.playerLocationCode`, `DisplayInfo.inHangar`, `Where.placeKind` |
| `src/main/diagnostics.ts` (upstream) | C: keeps the last UI export (`path`, `images`, combined picture); stitches the saved pictures into `<base>-all.png` with Electron `nativeImage` (bitmap in, bitmap out, no new packages); the copy handlers | `registerDiagCopy()` (IPC `diag:copyText`, `diag:copyImages`), `copyLastExportText()` → `{ ok, bytes?, error? }`, `copyLastExportImages()` → `{ ok, width?, height?, error? }`; `buildDiagnostics()` → `{ ..., combinedImage? }` |
| `src/shared/trace.ts`, `src/shared/channels.ts`, `src/preload/index.ts` (upstream) | Types, channels and bridge for the copy buttons; the pure stitcher | `DiagCopyTextResult`, `DiagCopyImagesResult`, `diagCopyTextLine()`, `diagCopyImagesLine()`, `Bitmap`, `stitchBitmaps()`; `IPC.diagCopyText`, `IPC.diagCopyImages`; `window.supercargo.diagCopyText()`, `diagCopyImages()` |
| `src/renderer/src/pages/SettingsPage.tsx`, `DebugPage.tsx` (upstream, export area) | COPY TEXT / COPY IMAGES next to the result line after a successful export; feedback for ~4 s | — |
| `test/replay/next_order.mjs`, `where_checks.mjs`, `diag_checks.mjs` | Unit-level checks: the S1DCO06 lookup and the J82 pickup distance; the real Covalex raw reads; stitch sizes, gaps and pixels; `where_checks.mjs` place-naming cases (station, station hangar, POI, planet, open space, unknown code) | `node test/replay/<file>` |
| `test/replay/replay.mjs` | Scenarios `j82-pickup-here`, `where-covalex-garbled`, `where-station-hangar`, `diag-copy-buttons`, `diag-copy-none` (real app path; `where-station-hangar`: a read in a Seraphim Station hangar starts from "Seraphim Station (hangar)", not "Open space") | `node test/replay/replay.mjs j82-pickup-here where-covalex-garbled where-station-hangar diag-copy-buttons diag-copy-none` |

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
| `src/other/otherNext.ts` | Stop rows, distances and route order read the resolver (one call per step per `listOpenStops` run); `findRosterLocation` (typed starts) uses `placeKey` (batch 9: removed, see [Name and place resolution](#name-and-place-resolution)); re-exports `NEAR_MAX_M` | `listOpenStops()` (`originIsRead?` opt; rows and groups carry `match`), `explainPlaceLookup()` (wrapper over `resolvePlaceText`) |
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
| `src/other/main/matchMemory.ts` (new) | `<data folder>/other-matches.json` (atomic write, saves coalesced to 1 per second, doc validation); IPC handlers; broadcast to every window; `## MATCH MEMORY` diagnostics section | registered from `src/other/main/register.ts` |
| `src/shared/channels.ts`, `src/preload/index.ts` (Other blocks) | `otherMemory:get` / `:seen` / `:proof` / `:set` / `:forget` / `:undo`, `evt:other:memory` | `otherMemoryGet/Seen/Proof/Set/Forget/Undo`, `onOtherMemory` |
| `src/other/otherResolve.ts` | `ResolveCtx.memory`; statuses `user` ("✓ you set") and `learned` ("✓ learned"); user entry wins outright (10, disputed 6); learned +4, proven wrong −4; `StopPlace.memoryKey` and `memory` | `resolveStopPlace()` |
| `src/other/otherNext.ts` | `ListOpenStopsOpts.memory` passed into the resolver (also the step distance helpers) | `listOpenStops()` |
| `src/other/renderer/state/otherMemoryStore.ts` (new) | Renderer copy of the doc; the main-window-only "seen" reporter (debounced 5 s) | `startOtherMemory()`, `memoryDoc()`, `memoryLookup()`, `useMemory()`, `useMemoryLookup()`, `startMemorySeenReporter()` |
| `src/other/renderer/state/otherJobs.ts` | Game proof on Objective Complete, read before `where` moves to the step (main window only) | the `objective` case |
| `src/other/renderer/state/otherDiag.ts` | Memory passed to `listOpenStops`; SNAPSHOT memory counts (entries, user, learned, disputed) | |
| `src/other/renderer/components/MatchTag.tsx`, `MatchFix.tsx` (new), `LearnedPlaces.tsx` (new), `src/other/renderer/OtherSettingsPage.tsx` (was settingsBlock.tsx, removed in batch 10) | Tag as a button opening the fix panel (✓ Right / ✗ Wrong → pick / Forget); LEARNED PLACES table, filter, search, Change / Forget, Recent changes with Undo | `MatchFix`, `LearnedPlaces` |
| `OtherOverlay.tsx`, `pages/NextPage.tsx`, `pages/JobsParts.tsx` | Pass `memory: useMemoryLookup()` into the resolver | |
| `test/replay/memory_checks.mjs` (new) | Pure checks of every `otherMemory` function, caps, undo, disputed and learned thresholds | `node test/replay/memory_checks.mjs` |
| `test/replay/replay.mjs` | Scenarios `memory-wrong-pick`, `memory-undo`, `memory-proof-learned`, `memory-disputed`, `memory-diag-section`; helpers `memLaunch()`, `memRead()`, `memSetVia()`, `uiWrongPick()`, `memFile()`; `MATCH MEMORY` added to the required export sections | see the command below |

**Data flow.**

```
main window: listOpenStops (debounced 5 s) ─► non-exact stops ─► otherMemory:seen ─► recordSeen ─► other-matches.json
Objective Complete (main window) ─► prev where (displayinfo/map/inventory, acc >= 7, <= 10 min)
   ─► resolve the step's place ─► within 1.5 km? ─► otherMemory:proof ─► recordProof (confirmed / wrong + where you were)
tag click / LEARNED DATA tab ─► otherMemory:set / :forget / :undo ─► new doc returned + evt:other:memory to every window
every window: useMemoryLookup() ─► resolveStopPlace ctx.memory
   user entry ─► status user (10; disputed 6, "⚠ the game disagrees")   learned entry ─► +4 (status learned if it wins)
   wrong >= 2 ─► −4   ─► tags, Next, Jobs, overlay ─► SNAPSHOT + ## MATCHES + ## MATCH MEMORY
```

Run only the batch 8 app scenarios (after `npm run build`):
`node test/replay/replay.mjs memory-wrong-pick memory-undo memory-proof-learned memory-disputed memory-diag-section`

**Known limits.**
- Proof needs a position read near the completion (within 10 minutes, accuracy 7+); without one nothing is learned.
- A stop the resolver gets exactly right is not remembered (exact matches are left out of the log).
- The memory is per PC (the data folder); it is not shared or exported other than in diagnostics.

## Other mode: data sources, OCR typo matching, OCR tune-up (batch 8 addendum 2, 2026-10-14)

Rules 50-56 in [STANDALONE.md](../src/other/STANDALONE.md#data-sources-ocr-typo-matching-ocr-tune-up-batch-8-addendum-2-user-2026-10-14);
audit in [OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#data-sources-ocr-typo-matching-ocr-tune-up-batch-8-addendum-2). No new data
source: the roster is still UEX plus the bundled starmap file, now tagged by source with a switch for the starmap.

| File | Owns (addendum 2) | Entry points |
|---|---|---|
| `src/shared/types.ts` (upstream, re-tie 20) | `Location.source?` and `Location.coordsFrom?` (`'uex' \| 'starmap'`) | |
| `src/other/main/uex.ts` | Sets the tags: `fillFromPositions` -> `coordsFrom: 'starmap'`, `addStarmapPlaces` -> `source: 'starmap'` | `loadOtherPlaces()`, `refreshOtherPlaces()` (one download at a time: overlapping refreshes share it; `test/replay/places_checks.mjs`) |
| `src/other/workMode.ts` | Setting `otherSourceStarmap` (default on) in `OTHER_SETTING_DEFAULTS` | `otherSetting()` |
| `src/other/renderer/state/otherPlaces.ts` | Off: drops starmap-only places and strips starmap-filled coordinates (and the body that came with them); `useMergedLocations` re-computes on the setting. Body fill: a place with coordinates but no body takes the body of the same place (same name or Center/Centre spelling) within 1 km | `mergeLocations()`, `useMergedLocations()` |
| `src/other/renderer/components/DataSources.tsx` (new), `src/other/renderer/OtherSettingsPage.tsx` (was settingsBlock.tsx, removed in batch 10) | Settings → OTHER MODE → DATA SOURCES: one row per source with counts and its switch (UEX: "base list", always on) | `DataSources` |
| `src/other/renderer/components/LearnedPlaces.tsx` | "(place's source is off)" on entries whose place isn't in the active sources | `LearnedPlaces` |
| `src/other/renderer/state/otherDiag.ts` | `placeSource` uses the tags; SNAPSHOT shows the enabled sources | |
| `src/other/otherResolve.ts` | Confusion-folded keys (`corrected` +5); weighted Damerau-Levenshtein "close spelling" (+4 / +3); code words must fold equal; "· from starmap data" on starmap candidates | `resolveStopPlace()`, `placeKey()` |
| `src/other/main/whereAmI.ts` | Own tesseract.js worker for zone 2 (page mode 6, interword spaces, Sauvola `thresholding_method` 2) and, since batch 14, zone 1 too (no second `TesseractEngine`); both fall back to the shared engine when the worker won't load; `zone2-prepped` picture in `## IMAGES` | `SC_WHERE_TEXT_FILE` seam unchanged |
| `src/other/main/ocrPrep.ts` (new, pure JS on the BGRA bitmap) | Grey, invert, scale to ~30 px text (capped ~4 Mpx); `OCR_PARAMS`, `ZONE_PSM`; since batch 14 the full per-zone parameter sets (zone 1: page mode 3, interword spaces, threshold 0, 2× upscale, no prep). No global Otsu (it dropped text over bright sky/glare); Tesseract thresholds locally | `prepForOcr()` |
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
WHERE AM I zone 1: capture ─► 2× upscale ─► same own Tesseract, zone 1 params (psm 3, threshold 0) ─► parseMapLine (batch 14; was a second shared engine)
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
| `src/other/main/gameData.ts` (new) | Bundled or `<data folder>/game-data/` copy; UPDATE download (raw.githubusercontent.com, timeout, 10 MB cap, shape check) and rebuild; IPC; `## GAME DATA` | `registerOtherGameDataIpc()`, `getGameDataStatus()`, `getSiteCodes()`, `gameDataPositionsFile()`, `onGameDataUpdated()`, `updateGameData()`; `GAME_DATA_BASE`, `GAME_DATA_CREDIT` |
| `src/other/main/uex.ts` | Prefers the `<data folder>/game-data/` positions over the bundled file | |
| `src/other/main/register.ts`, `src/shared/channels.ts`, `src/preload/index.ts` (re-tie 21) | `otherGameData:get` / `:update`, `evt:other:gameData`; `'GAME DATA'` diagnostics section | `otherGameDataGet()`, `otherGameDataUpdate()`, `onOtherGameData()` |
| `src/other/renderer/state/otherGameDataStore.ts` (new) | Renderer copy of the site table; imported from `otherJobs.ts` so both windows have it | `startGameData()`, `updateGameData()`, `useGameData()` |
| `src/other/renderer/components/DataSources.tsx` | Row "Star Citizen Wiki game data (scunpacked-data)": counts, bundled/downloaded date, UPDATE, credit, switch | `DataSources` |
| `src/other/otherResolve.ts` | Generic site at the contract parent: "game data: <parent> has a <site> ✓" +2 / "has no" −2; "[CODE]" -> exact parent ("game code <code> ✓", confidence 10); nothing when the switch is off | `resolveStopPlace()` |
| `test/replay/sitecodes_checks.mjs` (new) | Pure checks of the site table, code parsing and parents | `node test/replay/sitecodes_checks.mjs` |

**Data flow.**

```
scunpacked-data trade_locations.json ─► gen-site-codes.mjs ─► data/uex/site-codes.json (bundled)
UPDATE ─► otherGameData:update ─► download starmap_positions + trade_locations ─► <data folder>/game-data/ ─► evt:other:gameData
main/gameData ─► otherGameData:get ─► otherGameDataStore (both windows) ─► otherSiteCodes ─► resolver (+2 / −2, [CODE] exact)
```

**Known limits.**
- An UPDATE doesn't remove starmap-only places from the earlier positions file until the next REFRESH rebuilds the place list.
- `data/uex/site-codes.json` is not in the `data/uex` hash sync; it changes only with a release or an UPDATE.

## Name and place resolution

Batch 9 (2026-10-14, CONTRACT10, user: "streamline ... the entire name/place resolution"). Rules 61-68 in
[STANDALONE.md](../src/other/STANDALONE.md#one-nameplace-resolver-for-all-of-other-mode-batch-9-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#one-nameplace-resolver-batch-9). Every Other-mode name or place lookup goes
through `src/other/otherResolve.ts` (text) or `src/other/otherSiteCodes.ts` (codes). The text as read is always the
input; imports never rename (rule 61). Every text lookup gets the match memory (renderer `currentMemoryLookup()`,
main `matchMemory.getMemory()`). `test/replay/resolver_guard.mjs` fails on a name match done anywhere else.

**Text -> place**

| Lookup | Entry point | Called from | Tag shown |
|---|---|---|---|
| Stop's place (pickup while open, else drop-off; marker, generic site, memory) | `otherResolve.ts:resolveStopPlace(step, ctx, job?)` | `otherNext.ts:listOpenStops` (rows, route sort, overlay, Next), `JobsParts.tsx` (Jobs step), `otherDiag.ts` (SNAPSHOT `match`, `## MATCHES`) | overlay, Next tab, Jobs step (`MatchTag` -> MatchFix) |
| Any place text without a step | `otherResolve.ts:resolvePlaceText(text, ctx, marker?, related?, jobTexts?)` | `resolveStopPlace`, `otherJobs.ts` proof compare, `otherDiag.ts` | via its caller |
| Job import from Game.log | `otherResolve.ts:importPlace(raw, ctx)` | `otherLog.ts:stepFromParse(id, parsed, locations?, ctx?)` (renderer and main scan) | Jobs step (text as read + matched place + tag) |
| Job import from a scan (OCR) | `otherResolve.ts:importPlace(raw, ctx, { ocr: true, label })` | `renderer/state/otherOcr.ts:applyOcrRows`, `OtherCaptureModal.tsx` (confirm screen) | scan confirm screen, then Jobs step |
| Typed start | `otherResolve.ts:resolveStartText(text, ctx)` | `otherNext.ts:resolveOrigin({ typed, memory, ... })` -> `match` | Next tab and overlay, next to STARTING AT |
| Log position clues (Objective Complete place, inventory) | `otherResolve.ts:resolveStartText(text, ctx)` | `renderer/state/otherJobs.ts:whereFromPlace` | where line (source shown) |
| Map line (zone 1) names | `otherResolve.ts:resolveStartText` via the `resolve?` closure | `otherWhere.ts:resolveMapLine(..., resolve?)`, closure built in `main/whereAmI.ts` (main memory + site codes) | WHERE AM I result |
| Marker placement (does the step's place have coordinates) | `otherResolve.ts:resolveStopPlace` | `renderer/state/otherJobs.ts:placeSteps` | |

**Code -> place**

| Lookup | Entry point | Called from |
|---|---|---|
| Wiki site codes, city codes, `RR_<BODY>_L<n>` / LEO | `otherSiteCodes.ts:placeForCode(code, locations)` -> `{ name, via: 'site' / 'city' / 'lagrange' }` | `otherCurrentLocation.ts` (inventory / location lines, parse only), the resolver's code evidence ("game code … ✓"), `otherWhere.ts` panel codes |
| Site code in a text ("[DC_…]", panel style) | `otherSiteCodes.ts:codeFromText()`, `parentForCode()`, `siteByCode()` | `otherResolve.ts` |

**Position -> place**

| Lookup | Entry point | Called from |
|---|---|---|
| Nearest roster place to a point (within `NEAR_MAX_M`, 25 km) | `otherResolve.ts:nearestPlace(point, locations, maxM?)` | `otherNext.ts` (`near` labels), `otherJobs.ts` (proof "you were at", learned report), `otherWhere.ts` (display-info read) |
| Body by name ("Hurston", "OOC_Stanton_1_Hurston") | `otherResolve.ts:findBody(name, locations, system?)` | `otherWhere.ts:resolveDisplayInfo` / `resolveMapLine` |
| Marker zone host -> place | `otherMarkers.ts:locationByZ` (kept: geometry) | marker calibration |

**Special cases (kept outside the resolver, allowlisted in the guard)**

| What | Where | Why |
|---|---|---|
| Jump gateways | `otherGeo.ts:gateway`, `gatewayLocation` | exact jump-point rules |
| Roster build (UEX + starmap merge by name) | `renderer/state/otherPlaces.ts:mergeLocations`, `main/uex.ts` (fill / add starmap positions) | builds the roster every lookup reads |
| Body table | `otherBodies.ts` | planet / moon list by their own names |
| Haul mode | `src/renderer/src/state/store.ts`, `shared/logLocation.ts:resolveLogLocation` | upstream, not Other mode |
| Pass-through texts | `importPlace`: "Neutralize …" targets, "<System> System", "Patrol Coordinates" | not places |

**Data flow.**

```
log line / scan text / typed start / log clue / map line
   ─► text as read (locationRaw, pickupLocationRaw, typed text)            never renamed by an import
   ─► otherResolve (placeKey, OCR folds, address + Lagrange rules, codes via placeForCode, memory, marker, here)
   ─► StopPlace { status, confidence, evidence, candidates, point }
        import: location = roster name only when sure (exact / corrected / user / learned / code, conf >= 8, +3 clear)
   ─► MatchTag (scan confirm, Jobs, Next, overlay, STARTING AT) ─► MatchFix ─► memory ─► every lookup
```

Run (after `npm run build`): `node test/replay/replay.mjs resolver-scan-fix resolver-log-no-rename resolver-typed-start
resolver-memory-everywhere`; pure: `node test/replay/resolve_checks.mjs`, `node test/replay/resolver_guard.mjs`
(`--all` also lists the allowlisted hits).

| File | Owns (batch 9) |
|---|---|
| `test/replay/resolver_guard.mjs` (new) | The guard: name matching outside the allowlist fails, each allowlist entry with its reason |
| `test/replay/replay.mjs` | `resolver-scan-fix`, `resolver-log-no-rename`, `resolver-typed-start`, `resolver-memory-everywhere`; helpers `stubOcr()` (test seam: main's `ocr:run` / `ocr:preview` IPC answered with a fixed text), `scanToConfirm()`; `matchRun()` / `memLaunch()` take `typed` |

## Other mode: OTHER MODE settings tab (batch 10, 2026-10-14)

Rules 69-73 in [STANDALONE.md](../src/other/STANDALONE.md#other-mode-settings-tab-batch-10-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#other-mode-settings-tab-batch-10). Settings is split into a tab bar
GENERAL | OTHER MODE. No setting key or behaviour changed; only where the rows sit and how they read.

| File | Owns (batch 10) | Entry points |
|---|---|---|
| `src/renderer/src/pages/SettingsPage.tsx` (upstream, re-tie 4) | Tab bar GENERAL / OTHER MODE, remembered tab (settings.json `otherSettingsTab`, default GENERAL); GENERAL = the upstream sections with no Other rows (OCR hotkey recorder, re-tie 14, stays) | renders `<OtherSettingsPage rowStyle keyStyle Toggle />` on OTHER MODE |
| `src/other/renderer/OtherSettingsPage.tsx` (new) | The OTHER MODE tab: Haul-mode note, jump list (Jobs · Distances · Where Am I · Places · AFK), five sections with large headings and one-line descriptions: Jobs & Objectives, Distances & Route, Where Am I (position reading), Places & Matching (Data Sources; since batch 11 a line + OPEN LEARNED DATA instead of Learned Places), AFK | default `OtherSettingsPage({ rowStyle, keyStyle, Toggle })` |
| `src/other/renderer/OtherSettingsPage.tsx` (was settingsBlock.tsx, removed in batch 10) | The Other setting rows (one copy of each control), used by the page | as split by the batch (section components or a re-export) |
| `src/other/renderer/components/DataSources.tsx`, `OtherMapCalibrator.tsx`, `HotkeyRecorder.tsx` | Unchanged controls, now under Places & Matching / Where Am I (`LearnedPlaces.tsx` moved to the LEARNED DATA tab in batch 11) | |
| `test/replay/replay.mjs` | Scenario `settings-tabs`; helpers `openSettingsTab(port, tab)` (SETTINGS, then the tab button), `settingsProbe()` (tab buttons, GENERAL title and Other heading font sizes and positions, stored tab), `afkView()`, `clickJumpAfk()`, `clickRowToggle(port, labelRe)`; `sourcesText()` and `memory-undo` now open Settings → OTHER MODE | see the command below |

**Data flow.**

```
SETTINGS ─► tab bar ─► settings.json otherSettingsTab (general | other)
  GENERAL    ─► upstream sections (settings:set as before)
  OTHER MODE ─► OtherSettingsPage ─► section rows ─► updateSettings(patch) ─► settings:set ─► settings.json (same keys)
  jump list  ─► scrollIntoView(section)
```

Run (after `npm run build`): `node test/replay/replay.mjs settings-tabs sources-starmap-off memory-undo`.

## Other mode: LEARNED DATA tab (batch 11, 2026-10-14)

Rules 74-80 in [STANDALONE.md](../src/other/STANDALONE.md#learned-data-tab-batch-11-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#learned-data-tab-batch-11). A main tab (Other mode only) for what the app has
learned: places (match memory), generic sites and planets. Learned places left Settings → OTHER MODE.

| File | Owns (batch 11) | Entry points |
|---|---|---|
| `src/renderer/src/state/store.ts` (upstream, re-tie 8) | `ViewId` adds `learned` | |
| `src/renderer/src/components/BottomNav.tsx` (upstream, re-tie 7) | `OTHER_NAV`: NEXT, JOBS, HISTORY, LEARNED DATA, SETTINGS | |
| `src/renderer/src/App.tsx` (upstream, re-tie 3) | `otherOnly` adds `learned` (Haul mode on that view goes to MANIFEST) | |
| `src/other/renderer/mountApp.tsx` | `OtherPages`: view `learned` → `<LearnedDataPage/>` | `OtherPages({ view })` |
| `src/other/renderer/pages/LearnedDataPage.tsx` (new) | The tab: Places (summary filter buttons, Needs your eye, disputed pinned with KEEP MINE / USE WHERE I WAS, sortable table, RECENT CHANGES + UNDO), Sites and Planets (read-only, `useBodies()`); scroll to / highlight a focused entry | default `LearnedDataPage()` |
| `src/other/renderer/components/LearnedPlaces.tsx`, `NeedsYourEye.tsx` (new), `LearnedBodies.tsx` (new) | Summary (one bucket per entry, `kindOf()`), the places table (sort headers `th[data-sort]`, filters all / you set / game / learned / unproven / disputed, search), disputed rows pinned with KEEP MINE / USE WHERE I WAS, RECENT CHANGES; Needs your eye; Sites and Planets tables | `LearnedPlaces`, `kindOf()`, `NeedsYourEye`, `LearnedSites`, `LearnedPlanets` |
| `src/other/renderer/state/learnedFocus.ts` (new) | Pending focus (memory key, `''` = Needs your eye) and the view switch | `focusLearned(key?)`, `useLearnedFocus()`, `clearLearnedFocus()` |
| `src/other/renderer/components/MatchFix.tsx` | "Open in Learned Data" link → `focusLearned(match.memoryKey)` | |
| `src/other/renderer/OtherSettingsPage.tsx` | Places & Matching: Data Sources + "Learned places are on the LEARNED DATA tab." and OPEN LEARNED DATA | |
| `src/other/otherMemory.ts`, `src/other/main/matchMemory.ts` | `SetInput.reset` (KEEP MINE: wrong 0, no wrongAt, not disputed, confirmed kept; logged as a `set` with before/after) passed through validation | `setUserPlace()` |
| `test/replay/memory_checks.mjs` | `reset` checks, including undo | `node test/replay/memory_checks.mjs` |
| `test/replay/replay.mjs` | Scenario `learned-data-tab`; helpers `openLearnedData(port, want)`, `navButtons()`, `learnedProbe()` (the page through its test ids: `learned-section-*`, `learned-count-*`, `learned-row[data-key][data-kind]`, `learned-needs-row`, `learned-where`, `learned-site`, `learned-planet`), `clickRowButton(port, key, re)`, `clickSel()`, `learnedRowView()`, `memCounts()` / `sameCounts()`; `memLaunch()` takes `files` (seeded data files, e.g. `other-matches.json`, `other-bodies.json`); `memory-undo` opens the LEARNED DATA tab; `settings-tabs` expects the line instead of LEARNED PLACES | see the command below |

**Data flow.**

```
bottom menu LEARNED DATA / Settings OPEN LEARNED DATA / MatchFix "Open in Learned Data" ─► focusLearned(key?) ─► view learned
LearnedDataPage
  Places   ─► useMemory() (other-matches.json) ─► summary, disputed, table ─► otherMemory:set (reset / place) / :forget / :undo
           ─► listOpenStops(+memory) ─► Needs your eye (unsure / guess / mismatch / none) ─► MatchTag ─► MatchFix
  Sites    ─► useBodies().learned  (other-bodies.json)
  Planets  ─► useBodies().bodies   (other-bodies.json)
```

Run (after `npm run build`): `node test/replay/replay.mjs learned-data-tab memory-undo settings-tabs`; pure:
`node test/replay/memory_checks.mjs`.

## Other mode: problem stops highlighted (2026-10-14)

Rule 38 in [STANDALONE.md](../src/other/STANDALONE.md); decision in [DECISIONS.md](DECISIONS.md) section 5. One rule
says which stops have a place problem; every list screen tints those rows, the overlay tints only the words.

| File | Owns | Entry points |
|---|---|---|
| `src/other/renderer/stopIssue.ts` (new) | The shared rule: status `none` red ("no place" / "not found"), `guess` / `unsure` / `mismatch` amber; worst of several (red beats amber, with a count); row style (light tint + 3 px left stripe) and overlay word colour | `stopIssue(match, step?)`, `worstIssue(issues)`, `issueColor(level)`, `issueRowStyle(level)`, `issueTextStyle(level)`; types `IssueLevel`, `StopIssue` |
| `src/other/renderer/pages/JobsParts.tsx`, `pages/NextPage.tsx`, `components/NeedsYourEye.tsx`, `components/OtherOverlay.tsx` | Use the rule: Jobs step rows and the collapsed job row (chip "✗ N step(s) need a place" / "? N step(s) to check"), Next rows/groups, Needs your eye rows tinted; overlay place name, objective text and "Next Location" place words tinted (words only); `MatchTag` unchanged (chip, opens `MatchFix`) | |
| `src/other/renderer/components/OtherCaptureModal.tsx` | SCAN CONTRACT confirm screen: the "→ place" words tinted with `issueTextStyle` (words only, same rule) | |
| `src/other/renderer/components/OtherOverlay.tsx` | Return to first stop (rule 93): OFF keeps the chosen stop (moves only when it is completed/abandoned); ON returns to stop 1 after the set seconds and at once on a real start change (name/kind, or the first stop in the order); live WHERE AM I reads and job-file saves never move the card | |
| `test/replay/stopissue_checks.mjs` (new) | Pure checks of `stopIssue` / `worstIssue` for every match status | `node test/replay/stopissue_checks.mjs` |
| `test/replay/replay.mjs` | Scenario `issue-tint` (real app path: tinted rows on the list screens, words only on the overlay, incl. "Next Location"); scenario `overlay-stays-on-stop` (‹ › to a later stop stays there with the setting OFF through live reads and job-file saves; ON returns to stop 1); `resolver-scan-fix` checks the confirm screen's "→ place" tint and waits for the tag to settle | `node test/replay/replay.mjs issue-tint overlay-stays-on-stop resolver-scan-fix` |

Run (after `npm run build`): `node test/replay/replay.mjs issue-tint overlay-stays-on-stop resolver-scan-fix`; pure: `node test/replay/stopissue_checks.mjs`.

## Data folder and releases (batch 12, 2026-10-14)

Rules 81-85 in [STANDALONE.md](../src/other/STANDALONE.md#data-folder-and-releases-batch-12-user-2026-10-14); audit in
[OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#data-folder-and-releases-batch-12). The app's files move from Electron's userData
to `%USERPROFILE%\SuperCargo-OtherModes` (movable, checked for damaged data); releases are a Setup exe and a Portable zip
from `swill008/SuperCargo-All`; updates work like Gremlin's (Check for Updates window); reference data status; overlay O1-O3;
release notes rules (rules 86-96).

| File | Owns (batch 12) | Entry points |
|---|---|---|
| `src/main/paths.ts` (new) | Every app path: data folder (default `<HOME>/SuperCargo-OtherModes`, `DATA_FOLDER_NAME`, or `settings.dataFolder` when usable), `settings.json` in the default folder, caches in userData, the fallback reason | `defaultDataFolder()`, `dataFolder()`, `dataPath(...)`, `settingsFile()`, `cachePath(...)`, `setDataFolderOverride()`, `dataFolderStatus()` |
| `src/main/dataFolderIpc.ts` (new) | DATA FOLDER IPC: show, choose (picked folder used as is; copy when it holds no SuperCargo files, never overwrite; damaged data -> `needsRepair` without saving), repair, reset, open, restart | `registerDataFolderIpc(deps)`, `info()`, `switchTo()`, `copyMissing()`, `holdsData()` |
| `src/main/dataCheck.ts` (new) | Validates each SuperCargo JSON file with its loader's shape rule; moves all SuperCargo files to `Moved for Repair\<YYYY-MM-DD HH-MM>\` (structure kept, `settings.json` stays); start-up warning dialog | `checkDataFolder(dir)`, `moveForRepair(dir, when?)`, `startupDataCheck()` |
| `src/renderer/src/components/DataFolderRow.tsx` (new, split from SettingsPage) | GENERAL → DATA FOLDER row, the inline damaged-data warning with RESET AND CONTINUE / CANCEL | `DataFolderRow` |
| `src/main/releaseNotes.ts` (new) | Release notes for the update window: GitHub releases between current and offered, "What's new" section of each, newest first, cached for the session | `whatsNew(body, version)`, `fetchNotes(current, offered)` |
| `src/renderer/src/components/UpdateWindow.tsx` (new) | The "Check for Updates" modal: states, notes (safe markdown as React elements), buttons, reference data panel | `UpdateWindow` |
| `src/renderer/src/components/RefDataStatus.tsx` (new) | Reference data panel: per-file state, date, last checked, source line, CHECK NOW | default `RefDataStatusPanel` |
| `src/main/dataSync.ts` | Per-file reference data status (`reference-data-status.json`), broadcast `evt:refData`; `SC_TEST_REFDATA_BASE` | `refDataStatus()`, `checkRefDataNow()`, `loadRefDataStatus()`, `setRefDataBroadcast(fn)` |
| `src/main/diagnostics.ts` | `REFERENCE DATA` export section | |
| `src/renderer/src/components/UpdateBanner.tsx` | "Updated — now R1 <ver>" notice; "Update ready — INSTALL AND RESTART" bar after Later | |
| `src/other/otherLogParse.ts`, `otherEvents.ts`, `otherJob.ts` | O2: rep ranges (`repMax`) parsed and carried | |
| `src/other/otherWhere.ts`, `src/other/main/whereAmI.ts` | O3: altitude computed from position when the screen value isn't sane | |
| `src/other/renderer/components/OtherOverlay.tsx` | O1: fixed-height stop header; O2: "+rep–repMax REP" | |
| `src/main/*` (store, uex, dataSync, logger, trace, telemetry, debugWindow, diagnostics, ocr/*, index) | Paths from `paths.ts`; boot: settings from `settingsFile()`, then `setDataFolderOverride(settings.dataFolder)`, then the rest; `exports/` default save folder | |
| `src/other/main/{bodies,gameData,jobs,matchMemory,ocrSession,uex,whereAmI}.ts` | `dataPath()` / `cachePath('tessdata')` | |
| `src/renderer/src/pages/SettingsPage.tsx` | GENERAL → DATA FOLDER (renders `DataFolderRow`); UPDATES: CHECK FOR UPDATES opens the window, "Check for updates at start-up", the reference data ⚠ line; `UpdateStatus` pill | |
| `src/shared/channels.ts`, `src/preload/index.ts`, `src/shared/types.ts` | Channels `dataFolder:*` (incl. `dataFolder:repair`), `updater:download / :skip / :state / :updatedNotice`, `refData:get / :check`, `evt:refData`; preload `getDataFolder`, `chooseDataFolder`, `resetDataFolder`, `openDataFolder`, `restartForDataFolder`, `repairDataFolder`, `downloadUpdate`, `skipUpdate`, `getUpdateState`, `getUpdatedNotice`, `getRefDataStatus`, `checkRefData`, `onRefData`; types `DataFolderInfo`, `DataFolderChangeResult` (`needsRepair?`, `movedTo?`), `DataFolderCheck`, `DataFolderProblem`, `UpdateState`, `UpdatedNotice`, `ReleaseNote`, `RefDataStatus` / `RefDataFileStatus` / `RefDataFileState`, `AppSettings.dataFolder / skippedUpdateVersion / lastRunVersion` | |
| `electron-builder.yml`, `build/installer.nsh`, `package.json` | appId `space.supercargo.othermodes`, productName `SuperCargo-OtherModes`; win nsis + zip, `SuperCargo-OtherModes-R1-${version}-Setup.exe` / `-Portable.zip`; per-user, optional unticked desktop shortcut; publish `swill008/SuperCargo-All` | `npm run dist` |
| `.github/workflows/release-win.yml` (new), `release-linux.yml`, `release-notes/`, `scripts/release-body.mjs` | Stop when the tag exists; check the notes (N1); build, check both files, upload or publish with `release-notes/<ver>.md`; body to the job summary | workflow_dispatch `publish` |
| `src/main/updater.ts` | Installed copy: check, ask, download (checked size + sha512), install; portable zip: available + release page only; skip, updated notice, `SC_TEST_UPDATE_FEED` | `initUpdater(deps)`, `checkForUpdates(byHand)`, `downloadUpdate()`, `skipVersion(v)`, `lastUpdateState()`, `takeUpdatedNotice()`, `quitAndInstall()` |
| `src/main/store.ts` | `autoCheckUpdates` default true | |
| `test/replay/replay.mjs` | `dataDir(home)` = `<HOME>/SuperCargo-OtherModes` (every scenario seeds and reads there); `legacyDataDir(home)`; `readJsonIn(dir, file)`; `setup()` adds `e.settings()`; `GENERAL_SECTIONS` adds DATA FOLDER; scenarios `data-folder`, `damaged-data`, `update-window`, `refdata-status`, `overlay-header` | see the command below |
| `test/replay/paths_checks.mjs` | Folder name, no subfolder, holdsData, checkDataFolder, moveForRepair, switchTo needsRepair / repair | `node test/replay/paths_checks.mjs` |
| `test/replay/update_checks.mjs` (new) | whatsNew, fetchNotes filter / order (stubbed fetch), skip, updated notice | `npm run test:update` |
| `test/replay/where_checks.mjs` | Rep ranges, altitude from position | `node test/replay/where_checks.mjs` |
| `test/replay/refresh_checks.mjs` | HOME/USERPROFILE pointed at its temp folder; each reference data state from a local `file://` base, status saved and reloaded | |
| `test/replay/release_checks.mjs` (new) | Release notes heading and N1 rules, README rule text, workflow summary + tag check, builder targets / names / publish owner; run by `run_all.mjs` | `node test/replay/release_checks.mjs` |

**Data flow.**

```
boot: settingsFile() (<HOME>/SuperCargo-OtherModes/settings.json) ─► setDataFolderOverride(settings.dataFolder)
      ─► dataFolder(): override usable? it : default (+ fallback reason) ─► dataPath(...) for every app file
      ─► app ready ─► startupDataCheck(): checkDataFolder ─ problems ─► dialog: Reset (moveForRepair) | Quit
Settings GENERAL DATA FOLDER ─► dataFolder:choose ─► picker ─► no SuperCargo files: copyMissing
      │                                                     └► SuperCargo files: checkDataFolder ─ ok: use as is
      │                                                                         └ damaged: needsRepair (not saved)
      │                                    inline warning ─► RESET AND CONTINUE ─► dataFolder:repair ─► moveForRepair + copyMissing
      ─► settings.dataFolder ─► pending ─► RESTART NOW ─► dataFolder:restart ─► app.relaunch + quit ─► next boot uses it
start-up (autoCheckUpdates) / CHECK FOR UPDATES ─► updater: checking ─► fetchNotes ─► available ─► UpdateWindow
      ─► Update Now ─► updater:download ─► downloading % ─► ready (checked) ─► Install and Restart ─► quitAndInstall
dataSync refreshFromRepo ─► reference-data-status.json ─► evt:refData ─► RefDataStatus panel / Settings ⚠ line
```

Run (after `npm run build`): `node test/replay/replay.mjs data-folder damaged-data update-window refdata-status overlay-header settings-tabs`;
pure: `node test/replay/paths_checks.mjs`, `npm run test:update`, `node test/replay/refresh_checks.mjs`,
`node test/replay/where_checks.mjs`, `node test/replay/release_checks.mjs`.

## Zones 1 and 2 share the WHERE AM I reader (batch 14, 2026-10-15)

Rule 56 in [STANDALONE.md](../src/other/STANDALONE.md); decision in [DECISIONS.md](DECISIONS.md) section 4; contract
[batch-14-zones-share-reader.md](contracts/batch-14-zones-share-reader.md). Two OCR readers instead of three; about 115 MB
less memory once zone 1 has been read.

| File | Owns (batch 14) | Entry points |
|---|---|---|
| `src/other/main/whereAmI.ts` | One own worker reads both zones, setting the zone's full parameter set before each read; the zone 1 `TesseractEngine` is gone; worker load failure -> both zones use the `TesseractEngine` path as in 1.0.1 | `runWhere()`, calibrator TEST (unchanged) |
| `src/other/main/ocrPrep.ts` | Per-zone parameter sets (zone 1: psm 3, interword spaces, threshold 0, 2× upscale, no prep; zone 2: psm 6, interword spaces, Sauvola 2, after `prepForOcr`) | constants used by `whereAmI.ts` |
| `test/replay/zonereader_checks.mjs` (new) | Both zones read on one worker with their own settings; no third reader; fallback path | `node test/replay/zonereader_checks.mjs` |

```
contract OCR ─► upstream TesseractEngine (unchanged)
WHERE AM I ─► own worker: set zone 2 params ─► read zone 2 ─► nothing? ─► set zone 1 params ─► read zone 1 (2× crop)
worker won't load ─► TesseractEngine path for both zones (as 1.0.1)
```
