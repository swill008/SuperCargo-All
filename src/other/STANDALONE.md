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

Options for these behaviours live in Settings (Other block); defaults in `OTHER_SETTING_DEFAULTS` (`src/other/workMode.ts`).
