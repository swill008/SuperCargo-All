# StandAlone Other

Other mode lives under `src/other/`. Haul (factory SuperCargo) does not import Other domain code except at these re-tie points.

After merging AquatikJustice/SuperCargo, restore:

1. `src/main/index.ts` — `ensureOtherIpc()` at startup; `routeAccepted()` in the log `accepted` handler.
2. `src/main/logWatcher.ts` — `sendOtherAccepted` / `sendOtherSessionDrop` from `@other/main/ipc` (non-haul emit).
3. `src/renderer/src/App.tsx` — `bootOther()`, `<OtherPages>`, `<OtherModals>`, `useOtherEscape`.
4. `src/renderer/src/pages/SettingsPage.tsx` — `<OtherSettingsBlock />` after Capture delay.
5. `src/preload/index.ts` — Other IPC methods (`loadOtherJobs`, `onOtherAccepted`, …).
6. `electron.vite.config.ts` / tsconfig — `@other` → `src/other`.
7. `BottomNav` / `CompactGate` — workMode branch (Jobs/Next vs Manifest).
8. `src/renderer/src/state/store.ts` `scanSession` — skip when `workMode === 'other'` so Other restarts do not fill Manifest.

Do not merge Other into packer, hold, CargoGridPage, or `manifest.json`.
Tag: `StandAlone`.
