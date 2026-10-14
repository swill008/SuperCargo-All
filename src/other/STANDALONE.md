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
12. `src/main/index.ts` — `registerOther({ …, reregisterHotkeys: registerHotkey })` (line 1011, in `app.whenReady`): the hotkey recorder's resume (`otherHotkeys:resume`) re-runs upstream `registerHotkey()` so the OCR hotkey and WHERE AM I come back together. The import on line 21 also brings in `onOtherSettingsChanged`.
13. `src/main/index.ts` — `onOtherSettingsChanged(patch)` (line 788) at the end of the settings-set handler, just before `return settings`: starts, restarts or stops the live position timer when `otherWhereLive` / `otherWhereLiveSec` change. AFK needs no tie of its own: `registerOther()` calls `registerOtherAfkIpc()` and stops AFK (and the live timer) on `will-quit`.
14. `src/renderer/src/pages/SettingsPage.tsx` — the Capture hotkey row (lines 488-497): the upstream text `<input>` (and its `hotkey` state + sync `useEffect`) is replaced by `<HotkeyRecorder value={settings.ocrHotkey} onChange={…updateSettings({ ocrHotkey: v })} conflicts={[otherSetting(settings, 'otherWhereHotkey'), 'CommandOrControl+Shift+D']} />`, with the imports on lines 10-11 (`HotkeyRecorder` from `@other/renderer/components/HotkeyRecorder`, `otherSetting` from `@other/workMode`). To drop Other, put the upstream input back.
15. `src/shared/channels.ts` and `src/preload/index.ts`, in the Other blocks — hotkey recorder channels `otherHotkeysPause` (`otherHotkeys:pause`), `otherHotkeysResume` (`otherHotkeys:resume`), `otherHotkeyCheck` (`otherHotkeys:check`); AFK channels `otherAfkStart` (`otherAfk:start`), `otherAfkStop` (`otherAfk:stop`), `otherAfkGet` (`otherAfk:get`), `evtOtherAfk` (`evt:other:afk`); preload methods `otherHotkeysPause()`, `otherHotkeysResume()`, `otherHotkeyCheck(accel)`, `otherAfkStart()`, `otherAfkStop()`, `otherAfkGet()`, `onOtherAfk(cb)` (and the `AfkState` type import).

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

14. **Position accuracy (0-10).** Every clue carries `where.accuracy`, set when it is taken (`ACCURACY` in `otherWhere.ts`): display info near a body 10, display info in space 9, map line naming a place 8, inventory 7, objective 6, tick 5, map line naming only a body 4, map coordinates only 3. A typed start has no score (it is the user's choice). The overlay start line shows a coloured `ACC n` tag with a 10-segment bar; the Next tab shows the score and its word (exact 10-9, good 8-6, rough 5-4, guess 3-1, none 0) on a small red-orange-green slider under STARTING AT. Number and word are always shown, so colour is never the only signal.
15. **Fading.** The score drops by 1 for every 5 minutes since `where.at`, never below 1 (`whereAccuracy()`). A display-info read whose ServerTime differs from the PC clock by more than 2 minutes is "maybe stale": −3 (min 1), noted in its checks and diagnostics.
16. **The whole panel is read.** Zone 2 reads the whole r_DisplayInfo panel and uses, best first, the planet zone line or CamPos + the body centre (near a body), then the SolarSystem line (checked against Root), then zone 1, each only when its sense checks pass (recorded in `checks`). A read with no system named is still OK. After every WHERE AM I read the overlay shows a short note for about 4 s ("Read OK · display info · ACC 10", "Panel unreadable → used map line · ACC 3", or the failure message; the previous start is kept on failure).
17. **Live reads** (`otherWhereLive`, off by default; `otherWhereLiveSec` 45, 30-120): the main process re-reads zone 2 only, every N seconds, with no keypress; it skips while a read is running or a hotkey is being recorded. Only good reads change `where`; live reads are silent, except one quiet message after 3 failures in a row. Diagnostics count them.
18. **Tracked mission.** The panel's `Tracked mission : <name> [<uuid>]` line marks the active job whose mission id starts with the same first 8 hex characters (O/0 and I/1 tolerated) as `trackedMissionId` in the doc. The overlay shows a TRACKED tag on that job and jumps the card to its next stop when a new tracked id arrives; the Next tab shows the tag too.
19. **AFK button** (overlay, next to TURN IN / ABANDON; Windows only). Click to start, click again to stop; while on it is amber with "AFK ON · next key in N s". Every `otherAfkIntervalSec` (15 s) it brings the Star Citizen window to the front and presses `otherAfkFirstKey` (F2, the map) on the first cycle, then `otherAfkCycleKey` (F1) each later cycle, as scan codes through Windows SendInput (a PowerShell helper; no native module). It stops on the button, when the game window is gone, after `otherAfkMaxMin` (120; 0 = no limit), or when the app quits, and leaves the game focused. With `otherAfkWhereRead` on, it takes a quiet WHERE AM I read about once a minute, ~2 s after a key press. On other systems Start returns "Windows only". The settings hint says: "Presses keys in Star Citizen for you. Check RSI's terms before using it; the game window is brought to the front every cycle." Test seam: `SC_AFK_DRYRUN=1` sends no focus or keys and only records the presses (`presses`, `lastKeys`); `SC_AFK_INTERVAL_MS` sets the interval in a dry run.
20. **Hotkey recorder.** Both global hotkeys (OCR capture and WHERE AM I) are set by clicking the field and pressing the combination ("Press keys…"); Esc cancels, Backspace/Delete clears (off). A combination needs Ctrl, Shift or Alt unless it is F1-F24; modifier-only presses are ignored. While recording, all app global hotkeys are paused. It warns about a clash with the other hotkey or Ctrl+Shift+D (debug), and after saving shows "in use by another app" when registration fails.

Options for these behaviours live in Settings (Other block); defaults in `OTHER_SETTING_DEFAULTS` (`src/other/workMode.ts`).

## Diagnostics footprint in upstream files

The diagnostics trace (EXPORT DIAGNOSTICS) adds `trace(...)` calls to upstream Haul files: `src/main/logWatcher.ts`, `src/main/scanLog.ts`, `src/main/ocr/index.ts`, `src/main/contractData.ts`, `src/renderer/src/state/store.ts` (edit actions wrapped in a pass-through that records the action), `src/renderer/src/state/route.ts`. They change no behaviour; after an upstream merge, re-add them or drop them (the export still works, with less Haul detail).
