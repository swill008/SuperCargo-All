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
[STANDALONE.md](../src/other/STANDALONE.md) (rules 9-13 and re-tie points 9-11). Map and display-info
facts are in [OTHER-MODE-AUDIT.md](OTHER-MODE-AUDIT.md#where-am-i-and-start-modes).

| File | Owns | Entry points |
|---|---|---|
| `src/other/otherGeo.ts` | Travel distance between two star-frame points: same system, other system via gateways (`jumps`), or over a body's surface | `travel()`, `compareTravel()`, `formatTravel()`; types `GeoPoint`, `Travel` |
| `src/other/otherWhere.ts` | The `Where` model and its sources; parsing and resolving the map bottom line and the r_DisplayInfo text against the location roster | `parseMapLine()`, `parseDisplayInfo()`, `resolveMapLine()`, `resolveDisplayInfo()`; types `Where`, `WhereSource`, `MapLine`, `DisplayInfo`, `WhereRunResult` |
| `src/other/main/whereAmI.ts` | Main side of WHERE AM I: global hotkey, one screen capture, OCR of zone 2 then zone 1, parse/resolve, broadcast; calibration preview and per-zone test; test seam `SC_WHERE_TEXT_FILE` (JSON `{zone1?, zone2?}` used instead of capture + OCR) | `registerOtherWhereHotkey(getSettings)` (re-exported by `main/register.ts`, called from upstream `registerHotkey()`); `registerOtherWhereIpc(getSettings)` (called by `registerOther()`) for IPC `otherWhere:run`, `otherWhere:calPreview`, `otherWhere:calTest`; `runWhere()` (a second run while one is running returns `error: 'busy'`, not broadcast); sends `evt:other:where`; `WHERE_FAIL_MESSAGE`; `getRecentWhereRuns()` for diagnostics |
| `src/other/renderer/components/OtherMapCalibrator.tsx` | Settings UI (shown in `renderer/settingsBlock.tsx`, Other block) to set the two capture zones (`otherWhereZone1`, `otherWhereZone2`) on a preview grab and test each | `window.supercargo.otherWhereCalPreview()`, `otherWhereCalTest(zone)` |
| `test/replay/where_checks.mjs` | Parse/resolve checks for `otherWhere.ts`: map bottom lines and r_DisplayInfo 3 blocks transcribed from real screenshots, OCR-noisy variants and garbage, against the roster `data/uex/other-positions.json` | `node test/replay/where_checks.mjs` (bundles with esbuild; no build needed; separate from `run_all.mjs`) |

Settings (`src/other/workMode.ts`, defaults in `OTHER_SETTING_DEFAULTS`): `otherStartMode` ('auto' | 'fixed',
replaces `otherAutoStart`), `otherWhereHotkey` (CommandOrControl+Shift+L), `otherWhereZone1`, `otherWhereZone2`,
`otherWhereUseZone2`. Doc fields: `where` (replaces `currentLocation` / `currentLocationAt`), `startTypedAt`.

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

Other clues take the same last step: a tick or a log Objective Complete sets `where` to that step's place;
inventory log events set or clear it. None of them moves the log watermark (`lastLogEventAt` / `lastLogEventCount`).

**Known limits.**
- Zone 2 needs `r_DisplayInfo 3` on in game, and both zones need recalibrating after a resolution or UI-scale change.
- Surface positions use a fixed snapshot of place coordinates in each body's own (turning) frame; the game's solar
  `Pos` line is rotated by the body's spin and is not used near a body.
- The map on a planet or moon gives only the body centre (its bottom line has no surface position).
- Map coordinates `0.00° 0.00°` are ignored as a position (not a real direction; the name is used instead); the
  distance is truncated to 0.01 Gm, so map positions are good to about 5-10 Mm.
- Quantum travel and ATC log lines are not used: none names the place.
