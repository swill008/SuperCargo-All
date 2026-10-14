# SuperCargo code audit

v0.8.3 (commit 1764380), 2026-10-14. Read-only audit; no program code was changed. See
[SYSTEM-MAP.md](SYSTEM-MAP.md) for the architecture.

Baseline: `npm run typecheck` passes and `npm run build` passes (the renderer is a single
2.7 MB JS chunk). There are no tests, no lint config, and no CI on PRs.

Legend: **[verified]** means the code was re-read to confirm the finding, **[run]** means it was reproduced
with a script, and *plausible* means it is likely but not proven.

## High

| # | Area | Finding | Where |
|---|---|---|---|
| H1 | Privacy / backend | The five `usage_*` views have no `security_invoker`, so they run with the owner's rights and bypass RLS. With Supabase's default grants, the publishable key embedded in the app can likely read every user's usage rows. The `box_report_*` views do this correctly. Fix: `with (security_invoker = on)` or `revoke select ... from anon, authenticated`. **[verified]** | `db/usage_pings.sql:38-71` |
| H2 | Privacy / docs | The FAQ says "By default, no. Nothing leaves your machine", but `shareUsageStats` defaults to `true`. The README says the snapshot "never includes your contracts", but box-size reports (same flag) send the contract title, mission id and objectives. Fix the docs, or make box reports a separate opt-in setting. **[verified]** | `FAQ.md:42`, `src/main/store.ts:29`, `src/main/boxReports.ts:12-35` |
| H3 | Route | A job that delivers back to the start node makes the exact solver fail (each node is visited once and the start is pinned first), so normal round trips fall back to the non-optimal multi-trip path. With capacity 0 the planner returns infeasible. **[run]** | `src/shared/route.ts:142-143` |
| H4 | Route | Capacity 0 combined with any deferred or aboard job marks every job "unfittable" (no `cap > 0` guard on the multi-trip path). **[run]** | `src/shared/route.ts:903`, `:418` |
| H5 | Route / hold | The manual-order fit check calls `holdOracle(bays)` without `fixtures`, so boxes can be planned into cells occupied by Stor-All crates. | `src/shared/route.ts:645` |
| H6 | OCR capture | `captureDisplayMatches` compares the saved display key (`x_y_WxH`) against the numeric `d.id`. It never matches and always falls back to primary, so the app window can appear in a second-monitor capture. Fix: reuse `resolveDisplay` from capture.ts. **[verified]** | `src/main/index.ts:281`, `src/main/capture.ts:8` |
| H7 | Platform | Electron 33 is out of upstream support (no Chromium security fixes). | `package.json` |
| H8 | Overlay | The overlay opened mid-walk shows step 1: its `idx` and `driven` state start at 0/false and the current walk state is never replayed to it. | `CompactWindowApp.tsx:32-41`, `CargoGridPage.tsx:759-765` |

## Medium

| # | Area | Finding | Where |
|---|---|---|---|
| M1 | OCR parse | The same commodity going to the same destination twice is merged into one objective: "0/10 Agricium → Port Tressler" + "0/6 ..." gives 10 SCU and the 6 SCU is lost. **[run] [verified]** | `src/shared/ocrParse.ts:257` |
| M2 | OCR parse | The apostrophe class is `['\`]` with no curly `’`, so "Rat’s Nest" normalises differently from "Rat's Nest", and "Hurston’s L1" fails. **[run] [verified]** | `src/shared/fuzzy.ts:8`, `ocrParse.ts:106` |
| M3 | Persistence | `setLoadingBoxes` never calls `persist()`, so the frozen packing plan can be lost on close and re-packed differently. **[verified]** | `src/renderer/src/state/store.ts:1038` |
| M4 | Persistence | JSON writes are not atomic, and a parse failure returns empty data that the next save writes over: one crash mid-write can wipe `history.json`. Fix: temp file + rename + `.bak`. | `src/main/store.ts:45-61` |
| M5 | Performance | `persist()` sends and writes the whole manifest on every change with no debounce. The pin-clear loops persist N times. | `store.ts:410`, `CargoGridPage.tsx:2011-2058` |
| M6 | Performance | `<Canvas shadows>` has no `frameloop="demand"`, so it renders at 60 fps all the time next to the game. **[verified]** | `CargoGridPage.tsx:2485` |
| M7 | Performance | The overlay `ResizeObserver` effect has no dependency list, so it re-subscribes and sends an IPC call on every render. **[verified]** | `CompactWindowApp.tsx:103-113` |
| M8 | Security | `sandbox: false` on both windows (not needed by the preload); `shell.openExternal` runs with no scheme allow-list; `file://` navigation is not blocked. | `src/main/index.ts:28-32, 57, 110, 184, 191` |
| M9 | Security | No IPC payload validation. `ocr:saveSample` puts a renderer-supplied id straight into file paths, so `../` can move and upload any `.png` (needs a compromised renderer). `settings:set` merges any patch. **[verified]** | `src/main/ocr/samples.ts:24`, `index.ts:434, 590` |
| M10 | Main thread | Synchronous `execSync` of powershell plus a drive scan before the window opens; full sync reads of Game.log and `global.ini`. | `installDetect.ts:87,114`, `scanLog.ts:10`, `contractData.ts:113` |
| M11 | OCR | Auto-captures are dropped while `ocrBusy` is set; `ocr:run` bypasses the busy guard. | `src/main/index.ts:341, 587` |
| M12 | Backend | `with check (true)` inserts with no size limits, and `client_id` is set by the client: spam can skew stats and box-size "agreement". Uploaded OCR labels go into training with no review. Bucket policies are not in the repo. | `db/*.sql`, `scripts/train/auto/orchestrate.mjs:153` |
| M13 | Data supply | Installed apps pull `data/uex` from `main` on GitHub. The hashes come from the same source, so one bad commit reaches every user. There is no CI validation. | `src/main/dataSync.ts:9` |
| M14 | CI | The only workflow is the tagged Linux release; no typecheck, build or tests on push/PR. Actions are pinned by tag, not SHA. | `.github/workflows/release-linux.yml` |
| M15 | Hold | `planHold` reads `lastDrop` after the `prev` re-sort, so on a re-plan the wrong unit can get the far-wall placement. | `src/shared/hold.ts:819-823` |
| M16 | Route | The manual route reports feasible while aboard cargo is never delivered. | `src/shared/route.ts:732` |
| M17 | Packing | `walkPack` ignores the bay exit and floor, and re-packs from scratch at each step. Its out-of-bounds check is only on the flat index, so a stale pin wraps into the wrong row. | `src/shared/walkPack.ts:64, 252` |
| M18 | Renderer | `init()` side effects (history purge, `saveManifest`, `scanSession`) also run in the overlay window. IPC listeners are bound only after startup loads finish, so events can be lost (*plausible*). | `store.ts:743-845` |

## Low

- The watcher sends status 5×/s while Game.log is missing (`logWatcher.ts:92`).
- UTF-8 characters can be split across reads (`logWatcher.ts:149`).
- The CSP is set only through headers when packaged, which probably does not apply to `file://`; there is no meta CSP in `index.html` (*plausible*).
- Every OCR run keeps a screen crop on disk even without opt-in; it is pruned only at startup (`ocr/index.ts:94`).
- Switching OCR engine mid-load can leak the Tesseract worker (*plausible*).
- The bundled seed overwrites newer refreshed data after an app update (`dataSync.ts:49`).
- Heuristic route bitmasks overflow above 31 nodes (`route.ts:208`) (*plausible*).
- `floatOk` stops checking after the first floating box (`hold.ts:1250`).
- Any repeated pickup is rewritten to Nyx Gateway, even on Stanton contracts (*plausible*) (`contract.ts:32`).
- The 4-character fuzzy substring bonus is too generous (`fuzzy.ts:62`).
- R3F `GridShell` geometries are never disposed (`CargoGridPage.tsx:572`).
- The zoom shortcut uses the stale `uiZoom` from a closure (`App.tsx:42`).
- `redetect` has no `finally` (`SettingsPage.tsx:119`).
- `npm run markup` points at `tools/grid-markup`, which does not exist; `docs/OCR-TRAINING.md` and `docs/PROGRESS.md` are referenced but missing.
- `esbuild` is used by a script but not declared; the generator scripts assume Windows paths.
- The training scripts never await append streams before training or before deleting from the bucket (`orchestrate.mjs:85`, `drain_supabase.mjs:87`).
- `evt:openCapture` is a dead channel.
- Builds are unsigned and Electron fuses are not set.

## Dead code and duplication

- **Unused:**
  - `loadout.packSchedule` (~100 lines)
  - `ships.findShip` and `ships.shipCapacity` (the latter shares its name with the `shipModules` one that is used)
  - `boxGeometry.boxHeight` and `boxFootprint`
  - `payout.partialPayout` and `repLineScu`
  - `PackOpts.exitAware` and `cluster`
- **Three packers coexist:** `packer.ts`, `hold.ts` and `walkPack.ts`.
- **Duplicates have drifted:** `hold.fits()` claims to mirror `findSpot` but treats pinned boxes differently.
- **Copies:** the support check is copied 4 times in `hold.ts`; the peel check is copied between `packer` and `loadout`.

## Recommended order

1. **Backend and privacy:** fix H1 (one SQL change) and H2 (docs or defaults). Confirm the bucket and RLS policies live.
2. **Quick correctness fixes, each a few lines:** H4, H5, H6, M1, M2, M3, M7, M16.
3. **CI and tests:** add a push/PR workflow (`npm ci && npm run typecheck && npm run build`) plus a data-hash check. Add unit tests (vitest) for `planRoute`, `planHold`, `parseOcrText`, `packCargo`/`provePeel` and `resolveLocation`/`bestMatch`.
4. **Hardening:** `sandbox: true`, an https-only `openExternal`, IPC id validation, atomic JSON writes, and an Electron upgrade.
5. **Performance:** `frameloop="demand"`, debounced `persist()`, and async startup I/O.
6. **Maintainability:**
   - Split `CargoGridPage.tsx` into scene components, hooks (`useFrozenWalk`, `useLoadingPins`, `useBoxDrag`, `useOverlaySync`) and `LoadingPanel`.
   - Split the store into zustand slices.
   - Retire `walkPack` and `packSchedule`.
