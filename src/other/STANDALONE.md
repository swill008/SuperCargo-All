# StandAlone Other

Other mode lives under `src/other/`. Haul (factory SuperCargo) does not import Other domain code except at these re-tie points.

After merging AquatikJustice/SuperCargo, restore:

1. `src/main/index.ts` — `registerOther({ watcher, getSettings, getMainWindow })` inside `app.whenReady` (after the single-instance lock); each new `LogWatcher` relays its `'line'` events to it; `routeAccepted()` in the log `accepted` handler only to skip the haul manifest in Other mode.
2. `src/main/logWatcher.ts` — `this.emit('line', line)` for every raw line (`'line'` in `LogWatcherEvents`).
3. `src/renderer/src/App.tsx` — `bootOther()`, `<OtherPages>`, `<OtherModals>`, `useOtherEscape`, Other view guard.
4. `src/renderer/src/pages/SettingsPage.tsx` — `<OtherSettingsBlock />` after Capture delay.
5. `src/preload/index.ts` and `src/shared/channels.ts` — the Other IPC methods and channels (`loadOtherJobs`, `saveOtherJobs`, `scanOtherEvents`, `onOtherLogEvent`, `onOtherJobsChanged`, `otherAction`, `onOtherAction`, …).
6. `electron.vite.config.ts` / tsconfig — `@other` → `src/other`.
7. `BottomNav` / `CompactGate` — workMode branch (Jobs/Next vs Manifest).
8. `src/renderer/src/state/store.ts` — `scanSession` skips when `workMode === 'other'`; `ViewId` includes `jobs` and `next`.
9. `src/main/index.ts` — WHERE AM I hotkey: `registerHotkey()` calls `registerOtherWhereHotkey(() => settings)` (imported from `@other/main/register`, which wraps `src/other/main/whereAmI.ts`) **after** its `globalShortcut.unregisterAll()` and before the OCR hotkey's early return. Upstream `registerHotkey()` unregisters every global shortcut, so registering it anywhere else is wiped the next time the OCR hotkey is set. (The WHERE AM I IPC handlers need no extra tie: `registerOther()` calls `registerOtherWhereIpc()`.)
10. `src/main/index.ts` — in the settings-set handler, the `patch.ocrHotkey` condition is widened so `registerHotkey()` also re-runs when `patch.otherWhereHotkey` changes.
11. `src/shared/channels.ts` and `src/preload/index.ts`, in the Other blocks — WHERE AM I channels `otherWhereRun` (`otherWhere:run`), `otherWhereCalPreview` (`otherWhere:calPreview`), `otherWhereCalTest` (`otherWhere:calTest`), `evtOtherWhere` (`evt:other:where`), and preload methods `otherWhereRun()`, `otherWhereCalPreview()`, `otherWhereCalTest(zone)`, `onOtherWhere(cb)`.

Do not merge Other into packer, hold, CargoGridPage, or `manifest.json`.
Tag: `StandAlone`.

## Job rules (user, 2026-10-14)

These are the intended behaviour of Other mode. Change them only with the user.

1. **Haul mode is only for hauling.** In Haul mode the Other side ignores every contract; it never creates jobs.
2. **Two outcomes:** completed or abandoned. Fail, Abandon and "Player left" all count as abandoned; the reason is not shown.
3. **The latest ending wins.** Endings in the log (EndMission Complete / Fail / Abandon) mark the job automatically during play.
4. **Re-share reactivates.** A new "Contract Accepted" for a mission id makes its job active again, even if it was archived (a party member re-shared it after you left).
5. **Quitting ends contracts.** "Player requested disconnect" (quit to menu, server hop) and `<SystemQuit>` with `Quit via console command` or `User closed the application` (quit game) mark every active log job abandoned.
6. **A crash keeps jobs.** No ending is inferred from missing contracts: not at app start-up, not from a new Game.log, not from a log scan. After a crash you rejoin with your contracts, so jobs stay active until the log ends them or you do.
7. **Start-up replays only new log events** (after `lastLogEventAt` + `lastLogEventCount`, so nothing is applied twice): the previous log in `logbackups` when newer than the watermark, then the current Game.log. A previous log that ends with SystemQuit applies rule 5; one that ends without it is a crash (rule 6).
8. **One window owns Other.** Only the main window applies log events and saves; the overlay shows the same jobs, sends its button presses (step done, complete, abandon) to the main window, and reloads when the main window saves.

## Where the player is (user, 2026-10-14)

9. **One `where` field.** The jobs doc (`other-jobs.json`) keeps the player's position as `where: Where | null` (`src/other/otherWhere.ts`: name, label, point, system, body, `source`, `at`). It replaces the old `currentLocation` / `currentLocationAt`. Sources:
   - `tick`: you tick a step DONE / GO HERE / TURN IN → that step's place (read before the tick changes the active step);
   - `objective`: an Objective Complete line in the log ticks a step → that step's place, at the log time;
   - `inventory`: the log's RequestLocationInventory / Update Inventory Location events (a "left the place" event clears `where` only when the current `where` came from `inventory`);
   - `map` / `displayinfo`: WHERE AM I (rule 11);
   - `typed`: the STARTING AT box (stored separately as `startLocation` + `startTypedAt`).
   Quantum and ATC lines are **not** a source: no log line names the place (checked against real logs). The UI shows which source the start came from.
10. **STARTING AT mode** (`otherStartMode`, AUTO / FIXED toggle on the start line). **auto** (default): the newest of the typed start (`startTypedAt`) and the latest clue (`where.at`) wins. **fixed**: the typed start only; empty means no start. A non-typed start older than 5 minutes shows as stale.
11. **WHERE AM I** reads the star map: hotkey `otherWhereHotkey` (default Ctrl+Shift+L) or the one button on the overlay card's start line. One screenshot, two zones: zone 2 (r_DisplayInfo 3 text, upper right) first when `otherWhereUseZone2`, then zone 1 (the map's bottom location line) as fallback. The result is broadcast to every window; only the main window applies it (`applyWhere`) and saves. A failed read (hotkey or button) shows "couldn't read the map, try again" and changes nothing; a second run while one is running returns busy.
12. **Location never touches the log watermark.** `where` updates (from any source, including WHERE AM I) never change `lastLogEventAt` / `lastLogEventCount`; only log job events advance them (rule 7).
13. **Distances are system-aware.** A stop in another system goes via the gateway ("38.0 Gm + 1 jump"); stops sort by jumps, then metres. Two points on the same planet or moon are measured over the surface ("≈490 km surface").

Options for these behaviours live in Settings (Other block); defaults in `OTHER_SETTING_DEFAULTS` (`src/other/workMode.ts`).

## Diagnostics footprint in upstream files

The diagnostics trace (EXPORT DIAGNOSTICS) adds `trace(...)` calls to upstream Haul files: `src/main/logWatcher.ts`, `src/main/scanLog.ts`, `src/main/ocr/index.ts`, `src/main/contractData.ts`, `src/renderer/src/state/store.ts` (edit actions wrapped in a pass-through that records the action), `src/renderer/src/state/route.ts`. They change no behaviour; after an upstream merge, re-add them or drop them (the export still works, with less Haul detail).
