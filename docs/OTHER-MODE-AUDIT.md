# Other mode: map and audit (branch `features`)

Audited 2026-10-14 at `features` @ f636295. The branch has 190 commits on top of upstream v0.8.3 (1764380). It
adds `src/other/` (37 files) and touches 21 upstream files (+467 / -547). Read-only audit; no code
was changed. The upstream (Haul) audit is in [AUDIT.md](AUDIT.md).

Legend: **[verified]** means re-read in the code to confirm, and *plausible* means likely but not proven.

## Build state

- `npm run build`: passes.
- `npm run typecheck`: **fails**, with 32 errors in the node project and 6 in the web project.
  - Most come from the tsconfig includes. `tsconfig.node.json` takes in `src/other/**/*.ts`, which pulls the renderer state files into the node project. `tsconfig.web.json` pulls `src/other/main/*` the other way.
  - Fix:
    - node: `"src/other/*.ts", "src/other/main/**/*.ts"`
    - web: `"src/other/*.ts", "src/other/renderer/**/*"`, with `exclude: ["src/other/main/**"]`.
  - Real errors:
    - **`JobsParts.tsx:108` uses `onRestore`, which is not destructured** (the prop is declared and `JobsPage` passes it). This is a runtime crash on the RESTORE button. **[verified]**
    - `BottomNav.tsx:40`: `TabId` is not assignable to `ViewId`.
    - `other/main/jobs.ts:76`: `status` is typed as `string`.
    - Unused imports in `jobs.ts:10` and `main/scanLog.ts:5`.
- `patches/other-uex-places-wire.patch` does not apply (bare `@@` hunks, pre-refactor paths). Everything in it already exists under `src/other/`, so it is **safe to delete**.

## System map

```
Game.log ─► main/logWatcher ─► logParser (+3 Other regexes, sessionDrop)
   │  accepted ─► main/index routeAccepted ─► Haul store            (haul contract, Haul mode)
   │                                      └► evt:other:accepted     (haul contract, Other mode)
   │  non-haul accepted ─► evt:other:accepted  (logWatcher.ts:195, in EVERY mode)
   │  objective / ended ─► haul channels, also consumed by Other
   │  sessionDrop       ─► evt:other:sessionDrop
   ▼
other/main: ipc (broadcast to all windows) · jobs (other-jobs.json, IPC load/save/scan,
            places, OCR shots) · scanLog (full log replay) · uex (cities, stations,
            outposts → other-uex-places.json) · ocrSession (one PNG per job, wiped)
   ▼
renderer (main window AND overlay each run their own copy):
  state/otherJobs (zustand: jobs, startLocation, listOrder, jobOrder) · otherHistory
  otherCapture / otherAutoOcrRun / otherOcr (OCR → steps) · otherPlaces · haulModeSwitch (disabled)
  pages: Next · Jobs · OtherHistory · WorkModeSection+Settings
  overlay: CompactGate → OtherOverlay (Other mode) or CompactWindowApp (Haul mode)
shared domain: otherJob (model, J-refs) · otherLog (objective text → steps) · otherOcrParse
  · otherLocationSnap (exact, then unique fuzzy) · otherNext (open stops, distance or manual order)
  · workMode
```

- **Data model.**
  - `OtherJob` = {id, ref, title, kind, reward, status `active|complete|abandoned`, steps, source `log|manual`, filledBy, objectivesLocked, …}.
  - `OtherStep` = {kind `go|pickup|turnin`, location (raw or snapped), item, have/need, done}.
  - Stored in `userData/other-jobs.json` as {jobs, history, startLocation, listOrder, jobOrder}.

## Findings

### High: data loss or wrong data

| # | Finding | Where |
|---|---|---|
| O1 | **Main window and overlay overwrite each other.** Both hold a full copy and both save the whole doc; only the overlay reloads on `jobsChanged`. A DONE tapped in the overlay is undone at the main window's next save. **[verified]** | `CompactGate.tsx:25`, `otherJobs.ts:173-183` |
| O2 | **Log events are handled twice.** `sendAll` reaches both windows, so each accept is saved twice and triggers two auto-OCR runs; the start-up scan and `reconcileFromLog` also run twice. Fix: bind the log listeners only in the main window. | `other/main/ipc.ts:4` |
| O3 | **Manual order is lost on restart.** `loadOtherJobs` drops `listOrder`/`jobOrder`, and the history save writes only `{jobs, history}`, which also erases `startLocation`. **[verified]** | `other/main/jobs.ts:27-31`, `otherHistory.ts:44` |
| O4 | **Completed contracts are recorded as Abandoned after a restart.** The renderer marks every log job that is no longer live as abandoned and ignores the scan's `ended` list, overwriting main's correct `complete`. **[verified]** | `otherJobs.ts:201-206`, `otherHistory.ts:70` |
| O5 | **Non-atomic write plus a silent empty fallback.** A crash mid-write gives `{jobs:[], history:[]}`, and the next save makes the loss permanent. | `other/main/jobs.ts:25-33` |
| O6 | **Haul mode still adds jobs to Other.** Every non-haul accept is sent in every mode and ingested with no mode check, which breaks the `workMode.ts` rule. **[verified]** | `logWatcher.ts:195`, `otherJobs.ts:319` |
| O7 | **The OCR modal keeps the previous job's draft.** IMPORT on job A, Esc, then IMPORT on job B and CONFIRM writes A's rows to B. | `OtherCaptureModal.tsx`, `mountApp.tsx:65` |
| O8 | **A quit to menu archives every active log job** as abandoned (*plausible*: depends on whether the game re-logs accepts on rejoin). | `dropLogSession`, `scanLog.ts:50` |

### Medium

- **O9.** Archived or moved-to-History jobs are re-created by the next scan (the duplicate check only looks at `jobs`).
- **O10.** Log objective regexes stop at the first `.`, so "Go to NB Int. Spaceport" becomes "NB Int" (`logParser.ts:18-25`).
- **O11.** Neutralize objectives become TURN IN steps ("Deliver 0/1 X to X").
- **O12.** Progress counts from the log are discarded (`0/` is hard-coded), and later "3/5" lines are dropped as duplicates. "Collect" lines and rewards are not read from the log.
- **O13.** Auto-OCR:
  - Back-to-back accepts cancel the first job's capture.
  - The mode is not re-checked when it fires.
- **O14.** Duplicate J-refs after Clear Finished (`otherJobRef(jobs.length)`); NextPage groups by ref and title, so two jobs can merge into one group.
- **O15.** Restore is half-built:
  - A complete job comes back with every step done.
  - `objectivesLocked` stays set.
  - A job whose mission is no longer live is abandoned again at the next start.
- **O16.** `ensureOtherIpc()` runs at import time, before the single-instance lock. Each launch makes 3 UEX calls and wipes the OCR session, including in a second instance that is about to quit.
- **O17.** The start-up scan saves once per event; Game.log is read synchronously up to 3 times.
- **O18.** Objectives are inherited by a matching title, so they can be copied onto the wrong contract (*plausible*).

### Upstream (Haul) regressions on `features`, with Other mode off

- **TopBar shows literal `·` and `⚠`.** JSX text does not process escapes. **[verified]** (`TopBar.tsx:93, 135, 171`)
- **The overlay stops fitting its content once a size is saved.** `compactResize` returns early, and programmatic `setBounds` saves the size. **[verified]** (`main/index.ts:564`)
- **The Typeahead default `menuMinWidth=480` applies to every haul typeahead**, so the ship picker menu overflows.
- **Auto-update is forced off and the saved `true` is rewritten** (`main/store.ts:73`). This is intended for the fork, but it conflicts with upstream.
- **Haul contracts can gain 0-SCU objectives** from the new "Go to" / "Deliver 0/3" patterns (low risk).

### Unfinished or dead code

- **Haul-switch prompt:** `offer()` does nothing, so `HaulModeSwitchModal`, `switchToHaul` and `stayInOther` can never run.
- **Empty or unused functions:**
  - `bindOtherAutoOcr` has an empty body.
  - The `OtherCaptureModal` `autoRun` effect has no caller.
  - Unused: `applyOcrObjectives`, `getOtherPlacesCached`, `OtherMount`, `isOtherGenerator`, `snapLocationToUex`, `isHaulMode` and `isOtherMode`.
- **Fixture checks** (`checkOtherLocationSnapFixtures`, `checkOtherOcrLineFixtures`) never run.
- **UEX places are refreshed once at start-up, with no notice to the renderer.** On a first run there are no coordinates, so distance sorting does nothing until a restart.

## Upstream footprint vs STANDALONE.md

About 60% of the 21-file diff is reformatting and deleted comments. TopBar is -426 lines with no feature removed. Other
changes that sit outside `src/other` but are not in STANDALONE.md:
- `shared/channels.ts` (9 channels)
- `logParser.ts` (patterns and `sessionDrop`)
- the overlay rework in `index.ts`, `types.ts`, `SettingsPage` and `CompactWindowApp`
- theme, PageHeader and Typeahead
- the auto-update override

| File | Conflict risk | Suggested |
|---|---|---|
| `main/index.ts` | High | One `registerOther({watcher, getSettings})` call inside `whenReady`; move the overlay rework to its own branch |
| `TopBar.tsx` | High | Revert completely (this also fixes the escape bug) |
| `App.tsx`, `BottomNav.tsx` | High | Use the existing `<OtherMount view>` plus a `useNavItems` hook; revert the formatting |
| `SettingsPage.tsx` | High | Keep only `<OtherSettingsBlock/>`; the overlay rows go with the overlay branch |
| `logParser.ts`, `logWatcher.ts` | Med-High | Move the Other patterns into `src/other/main`, and subscribe to the watcher from `register.ts` |
| `channels.ts`, `preload` | Med | `OTHER_IPC` in `src/other`, and `...otherApi` in the preload |
| `Typeahead.tsx` | Med | Make the new props opt-in |
| `CompactGate.tsx` | Low | Move into `src/other/renderer` |
| `scanLog.ts` | Low | Revert |

The target is about 8 one-line hooks in upstream files: main, preload, App, nav, overlay gate,
settings, the scanSession guard, and the alias config.

## Suggested order

1. **Make it green:**
   - fix the tsconfig includes, `onRestore`, and the three type errors
   - delete the stale patch
   - revert the TopBar churn
2. **Stop data loss:**
   - O1 + O2: a single owner window, or reload with a revision number
   - O3 / O5: pass the whole doc through, and write atomically
   - O4: use the scan's `ended` list
   - O6: gate on `workMode` in main
   - O7: reset the modal per job
3. **Shrink the upstream footprint to the hooks above.** Split the overlay rework and the theme into their own branch.
4. **Finish the features:**
   - log parsing (`.` in names, Neutralize, progress counts, Collect, reward)
   - Restore
   - the J-ref counter
   - the Haul-switch prompt: decide to finish it or delete it
   - unit tests that run the existing fixtures
