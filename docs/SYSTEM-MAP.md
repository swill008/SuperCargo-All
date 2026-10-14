# SuperCargo system map

Snapshot of v0.8.3 (commit 1764380), 2026-10-14. See [AUDIT.md](AUDIT.md) for findings.

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
