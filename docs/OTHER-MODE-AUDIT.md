# Other mode: map and audit (branch `features`)

Audited 2026-10-14 (before the v0.9.1 upstream merge; line numbers may have shifted) at `features` @ f636295. The branch has 190 commits on top of upstream v0.8.3 (1764380). It
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

## WHERE AM I and start modes

Added 2026-10-14 after this audit (approved by the user). Files, entry points and data flow are in
[SYSTEM-MAP.md](SYSTEM-MAP.md#other-mode-where-am-i-and-start-modes-features-2026-10-14); the rules are in
[STANDALONE.md](../src/other/STANDALONE.md) (rules 9-20).

- **A. Start modes.** `otherStartMode` replaces `otherAutoStart` (no compatibility: unreleased fork). **auto**: the newer of the typed start (`startTypedAt`) and the latest clue (`where.at`) wins. **fixed**: the typed start only. The AUTO / FIXED toggle replaces AUTO / PINNED.
- **B. Clues** (each sets `where` with its source, newest wins in auto): `tick` (DONE / GO HERE / TURN IN, the step's place before the tick), `objective` (log Objective Complete), `inventory` (RequestLocationInventory / Update Inventory Location; see `otherCurrentLocation.ts` for the 36/36 log check), `map`, `displayinfo`, plus `typed`. The UI shows the source.
  - **B4 quantum / ATC: dropped.** Quantum and ATC lines in the logs name no destination or current place, so they cannot set a position.
- **C. WHERE AM I.** Hotkey `otherWhereHotkey` (default CommandOrControl+Shift+L) and one button on the overlay card's start line. One screenshot, two zones: zone 2 (r_DisplayInfo text, upper right) first when `otherWhereUseZone2`, zone 1 (map bottom line) as fallback. Failure: "couldn't read the map, try again".
- **D. Multi-system and surface.** Distances go through gateways ("+ 1 jump") and sort by jumps, then metres. Gateways are roster places named `<Other> Gateway` in the system they sit in (Stanton, Pyro, Nyx; Terra and Magnus ignored); each system's coordinates have its own star at the origin. Two points on the same body are measured over the surface ("≈490 km surface").

**Map bottom line** (checked against the user's screenshots): `SYSTEM [SYSTEM] > [BODY] > [PLACE] > lat° lon° distGM`, e.g.
`STANTON SYSTEM > 0.00° 1.06° 12.47GM`, `STANTON > HURSTON > 0.00° 0.00° 12.85GM`.
- Star frame: x = r·cosLat·cosLon, y = r·cosLat·sinLon, z = r·sinLat.
- Accuracy about ±5-10 Mm (distance truncated to 0.01 Gm). On a planet or moon it is the body centre. `0.00° / 0.00°` is ignored as a position.
- The most specific name wins (place, then body); coordinates only cross-check it (a gap over 50 Mm goes to a debug log).

**r_DisplayInfo 3** (upper right):
- `CamPos Planet Zone: x y z` is metres in the body's own frame, which turns with the body and matches the roster's surface coordinates. On Hurston, body centre + this vector lands 22.8 km from HDRSO-Stott; the game showed 22.82 km.
- `Zone: SolarSystem_… Pos: x y z` is km in the star frame, but rotated by the body's spin, so it must not be used for surface places.
- `Planet:OOC_Stanton_1_Hurston` names the body; `Current player location : Stanton1` / `StantonSolarSystem` the system; `Radius`, `Altitude` in metres.
- Rule: altitude under 100 km → body centre + planet vector; otherwise the solar position. Name = nearest roster place within 50 km on a body or 100 km in space, else none. Labels: "HDRSO-Stott · 22.8 km", "Open space · 443,380 km from Hurston".

**Known limits.** Zone 2 needs `r_DisplayInfo 3` and recalibration after a resolution change; surface data is a fixed snapshot in the body frame; the map on a planet gives only the body centre; `0°/0°` is ignored.

## Whole-panel read, accuracy, live reads, tracked mission, AFK (batch 2)

Added 2026-10-14, all user-approved (CONTRACT2 C1-C8, N1-N4, O1-O4, AFK). Rules 14-20 in
[STANDALONE.md](../src/other/STANDALONE.md); files and data flow in [SYSTEM-MAP.md](SYSTEM-MAP.md).

**Accuracy scale** (`ACCURACY` in `otherWhere.ts`; score at read time, then −1 per 5 min since `where.at`, min 1):

| Score | Word | Clue |
|---|---|---|
| 10 | exact | Display info near a body: planet zone line or CamPos + body centre, checks pass |
| 9 | exact | Display info in space: SolarSystem line (matches Root) |
| 8 | good | Map line names a station / place |
| 7 | good | Inventory log line |
| 6 | good | Objective Complete log line |
| 5 | rough | You ticked a step |
| 4 | rough | Map line names only a body (body centre) |
| 3 | guess | Map coordinates only |
| 0 | none | No position |
| – | – | Typed start: no score (the user's choice) |

A display-info read whose ServerTime is more than 2 min off the PC clock is "maybe stale": −3 (min 1).

**Sense checks** (each recorded in `DisplayInfo.checks`; a source is used only when its checks pass):
- near a body: the planet zone km line agrees with CamPos within 1 km; |position| ≈ radius + altitude within 5 km;
  `Current player location : StantonN` agrees with the body (1 Hurston, 2 Crusader, 3 ArcCorp, 4 microTech; moons "1a" etc.);
  the planet zone line alone means near that body; altitude over 100 km → use the SolarSystem line instead;
- SolarSystem line matches Root within 1 km (when Root is there), else Root alone;
- then zone 1 (the map line), then log clues.

**OCR tolerance** (from the user's real reads): OOC / 00C / 0OC / O0C, spaces for underscores, a unit per number
(m, km, Km, the "Kkm" typo), stray commas (`12849498.,1180km`), leading junk (`~~`), a `Pos:` whose numbers wrap to the
next line; system names by prefix (Stanton, Pyro, Nyx) ignoring trailing digits / l / I / | and "SolarSystem";
place names fold O→0 and I/l→1 inside tokens with a digit (`S1DCO6` = `S1DC06`; doubled zeros `S1DCO06` = `S1DC06` since batch 6). An unknown or missing system
on either side counts as the same system for distances (the real near-Hurston read gave "Stantonl" and every stop
showed "No jump route" before this).

**Replay scenarios** (`test/replay/replay.mjs`, real app path, `SC_WHERE_TEXT_FILE` / `SC_AFK_DRYRUN` seams; all fail
on the batch-1 build): `where-real-near-hurston`, `where-real-space`, `where-system-stantonl`, `place-ocr-o-zero`,
`where-tracked-mission`, `where-live` (waits for the 30 s minimum interval; no test override), `afk-dry-run`,
`hotkey-check-invalid`.

**Known limits.**
- AFK is untested on Windows here: the build machine is Linux, so only the dry run (no focus, no keys) and the
  helper-text checks in `afk_checks.mjs` have run. SendInput, the foreground-lock workaround and the "game window
  gone" stop need a check on a Windows PC with the game. AFK presses keys in the game for you: check RSI's terms.
- A real zone 2 OCR read takes about 5 s (whole panel, 3× upscale), so live reads are 30-120 s apart and AFK reads
  about once a minute.
- The tracked mission id is matched on its first 8 hex characters only; a badly garbled id matches nothing.
- Live reads need r_DisplayInfo 3 on and the panel visible; they never fall back to the map line.

## Diagnostics export additions (batch 3)

Added 2026-10-14, all user-approved (CONTRACT3 items 1-15). Section list and the images privacy note in
[STANDALONE.md](../src/other/STANDALONE.md#diagnostics-footprint-in-upstream-files); files and data flow in
[SYSTEM-MAP.md](SYSTEM-MAP.md).

| # | Item | Where in the export | Owner | Test |
|---|---|---|---|---|
| 1 | "What went wrong?" note | `## NOTE`, first section | `diagnostics.ts`, Settings / Debug export area | `diag-sections-new`, `diag-images` (note cleaned) |
| 2 | Overlay's own snapshot | `## OVERLAY` (place-list size, start, stop, distance text, last read message, AFK, tracked id, settings) | `otherOverlayDiag.ts`, `OtherOverlay.tsx`, `diagnostics.ts` | `diag-sections-new` |
| 3 | WHERE AM I history (last 10) | `## WHERE AM I HISTORY` | `whereAmI.ts` `getWhereDiag()` | `diag-sections-new` (2 reads) |
| 4 | AFK log | `## AFK LOG` (presses, helper stderr, start-up ms, restarts, state) | `afk.ts` `getAfkDiag()` | `diag-sections-new` (dry run, ≥2 presses) |
| 5 | Capture details | `## CAPTURE` (`null` when nothing captured) | `whereAmI.ts` | `diag-sections-new` (test seam: no capture) |
| 6 | OCR zone crops (opt-in) | `<base>-zone1.png`, `-zone2.png`; `## IMAGES` | `whereAmI.ts` `getWhereImages()`, `diagnostics.ts` | not testable in the seam (no capture); `diag-images` checks none appear |
| 7 | Location history (last 30) | SNAPSHOT `other.locationHistory` | `otherJobs.ts` `whereHistory()` | `diag-sections-new` |
| 8 | Place lookup per stop | SNAPSHOT distance rows `lookup` | `otherNext.ts` `explainPlaceLookup()` | `diag-sections-new`, `diag_checks.mjs` |
| 9 | Hotkeys | `## HOTKEYS` (value, registered now, last result, paused) | `whereAmI.ts` | `diag-sections-new` |
| 10 | Live stats | `## LIVE` | `whereAmI.ts` | `diag-sections-new` (present) |
| 11 | Places summary | SNAPSHOT `other.places` | `otherDiag.ts` | `diag-sections-new` |
| 12 | Distance detail per stop | SNAPSHOT distance rows `travel` | `otherGeo.ts` `explainTravel()` | `diag-sections-new`, `diag_checks.mjs` |
| 13 | Game log health | `## GAME LOG HEALTH` (path, size, mtime, last line, lag median/max, rotations) | `diagnostics.ts` | `diag-sections-new` |
| 14 | Overlay picture (opt-in) | `<base>-overlay.png`; `## IMAGES` | `diagnostics.ts` (`capturePage()`) | `diag-images` (saved and listed under xvfb) |
| 15 | Per-read timings | `timings` in each history entry (capture ms, OCR ms per zone, parse+resolve ms) | `whereAmI.ts` | `diag-sections-new` |

Every text section passes the sanitiser (handle → PLAYER, other players → OWNER-n); both replay scenarios put a
made-up handle in the log and the note and check it is absent. Pictures can't be sanitised, so they are off by
default and the tick box says so.

**Known limits.**
- `## CAPTURE` is `null` (no words) when no capture has happened yet; zone crops only exist after a real WHERE AM I
  capture, so they are untested here (the test seam reads a text file).
- `## OVERLAY` gives the place-list size but not the place-list version (item 2 asked for both).
- The replay scenarios answer the save dialog by replacing `dialog.showSaveDialog` through the main-process inspector;
  the `--export-diagnostics` CLI flag still takes no note or images.

## Places from markers, pickup order, clipboard (batch 4)

Added 2026-10-14, user-approved (CONTRACT4 F1-F4 and C). Rules 21-25 in
[STANDALONE.md](../src/other/STANDALONE.md#places-from-mission-markers-user-2026-10-14); files and data flow in
[SYSTEM-MAP.md](SYSTEM-MAP.md).

**The case (the user's export).** Job J74 (`FTL_Courier_Stanton_Iron_Rank1`) lists "Deliver Iron To Security
Compound" before "Collect Iron From HDPC-Farnesway on Hurston". "Security Compound" is not a UEX place, so the stop
showed "Not found in UEX". Its marker (`zoneHostId 862321816216`) has |position| = 1001.2 km, Hurston's radius: the
zone is Hurston's own frame, and Hurston's centre + position lands 4.0 km from HDPC-Cassillo (other log lines name
the place `DC_Stan_Hurston_S1_Cassillo_FOB`). The zone was never calibrated, because calibration needed a z-match with
a UEX place, and it was given the Haul-only roster. Zone ids also change per server (SolarSystem 862399811847 one
session, 862321811808 the next), so a table learned on an earlier server was wrong for the current one.

| # | Fix | Owner | Test (fails on e46aba2) |
|---|---|---|---|
| F1 | Body-frame markers: radius estimate (median distance of the body's places), ±3% radius, a body place within 10 km, exactly one body; merged roster | `otherMarkers.ts` `bodyFrameMatch()`, `otherJobs.ts` | `marker_checks.mjs`; replay `j74-near-place`, `j74-session-resets-zones` |
| F2 | `near` (nearest roster place within 25 km) on marker rows; overlay and Next show "Security Compound · near HDPC-Cassillo (4 km)" | `otherNext.ts`, `OtherOverlay.tsx`, `NextPage.tsx` | `next_order.mjs`; replay `j74-near-place` |
| F3 | Zone table for the build cleared on session / disconnect / quit; step positions kept; decide trace `marker zones reset: <why>` | `otherJobs.ts` | replay `j74-session-resets-zones` |
| F4 | Open pickup before same-item deliveries of the same job (next step, show-all and route order); no item or `pickupLocation` → game order | `otherNext.ts` `stepWorkOrder()` | `next_order.mjs`; replay `j74-pickup-first` |
| C | UI export copies the saved text to the clipboard (`copied`); result line "Saved and copied · 1.4 MB · <path>" (+ large note > 1 MB) or "Saved (copy to clipboard failed)"; the CLI never copies | `diagnostics.ts`, `trace.ts`, `index.ts` handler, Settings / Debug | replay `diag-clipboard` (clipboard read in main through the inspector equals the saved file); `diag-cli-no-clipboard` is a guard (passes on the old build too) |

The J74 replay uses the real marker line, the real objective texts and ids (`dropoff_` / `pickup_f1fc9593-…_0`) and
a build-12913470 session line; the accept title is modelled on real courier accept lines (the export did not keep it).

**Known limits.**
- Body radius is estimated from the roster's places; a saved planet table (the panel's exact `Radius:`) could refine
  it later. A body with no places with coordinates can't be matched.
- Hurston and microTech are both ~1000 km; only the 10 km place check separates them. No place near the point on
  any body (or more than one body passing) leaves the zone uncalibrated and the stop "Not found in UEX".
- `near` is a label; the distance comes from the marker point.
- After every server change the first marker must calibrate again.

## REFRESH and the sanitiser user-name fix (batch 5)

Added 2026-10-14, user-approved (CONTRACT6). Rules 26-28 in
[STANDALONE.md](../src/other/STANDALONE.md#refresh-user-2026-10-14); files and data flow in
[SYSTEM-MAP.md](SYSTEM-MAP.md).

**The case.** Marker lines (CreateMarker) and objective texts are logged when a contract is accepted. After a
restart the start-up scan applies only events newer than the watermark (rule 7), so the body-frame calibration added
in batch 4 never saw J74's old marker line, and "Deliver Iron To Security Compound" stayed "Not found in UEX".
REFRESH re-reads markers of the active jobs only, ignoring the watermark, and re-places steps. **Rule: REFRESH never
moves the watermark (`lastLogEventAt` / `lastLogEventCount`), never revives or ends a job and never touches done
flags or history; it runs automatically once per app version (`refreshedForVersion`).**

| # | Change | Owner | Test (fails on a7eb226) |
|---|---|---|---|
| R1 | Re-scan without watermark: session lines + markers of the given active missions only | `main/scanLog.ts` `scanMarkersFor()`, `main/jobs.ts` IPC | replay `refresh-places-j74` |
| R2 | Refresh-only apply: reset the build's zone table, calibrate, `placeSteps`; watermark, status, done flags, history untouched; result line + decide trace `refresh` | `otherJobs.ts` `refreshJobs()` | replay `refresh-places-j74` (step placed, overlay and Next "near HDPC-Cassillo", result names the place, watermark same, a Complete job with its own marker line stays complete, counts and the done pickup kept) |
| R3 | REFRESH button on Next (by STARTING AT) and in the Jobs header | `NextPage.tsx`, `JobsPage.tsx` | replay `refresh-places-j74` (clicks it by text) |
| R4 | Automatic once per version after the start-up scan; `refreshedForVersion` stored | `otherJobs.ts`, `otherJob.ts`, `main/jobs.ts` | replay `refresh-auto-once` (placed with no click; watermark same; one `auto refresh: new version` trace line; the second start of the same version doesn't rerun: trace count same and a re-stripped step stays unplaced) |
| S1 | Sanitiser: the OS user name is replaced only inside home paths (`\Users\<name>\`, `/Users/<name>/`, `/home/<name>/`, case-insensitive) and as a whole value; never inside words or JSON keys. With the container user `root`, the SNAPSHOT key `"root"` had become `"%USERNAME%"` | `src/main/sanitize.ts` | `test/replay/sanitize_checks.mjs` |

How the scenarios get the stale doc: a first run applies the J74 lines live (and a second job that has a marker and
then ends Complete), the app quits, and the doc is left as an older build would leave it: step positions removed,
`markerZones` removed, the app's own watermark (already past the J74 lines) kept. `refresh-places-j74` keeps
`refreshedForVersion` so the start does not refresh by itself; `refresh-auto-once` removes it.

**Replay tooling flake (run_all after the full replay suite).** Two real-log replays came back `app_jobs=0` after
~50 s while alone they pass in 6-11 s. Their saved `supercargo.log` was empty: the app never started. Each launch
ran `xvfb-run -n <display>` with display = 90 + (pid % 50) × 20 + launch number. `run_all` starts one replay
process per fixture and mode, several at once; two whose pids match mod 50 pick the same display, and the full
suite's process walks 50+ displays from its base, across other bases. `xvfb-run` on a display that is in use fails
at once ("Xvfb failed to start", hidden by `stdio: 'ignore'`), and `launch()` then waited out its 45 s and went on.
A scenario that threw before `stop()` also left its detached app and X server running after the suite. Fix (test
tools only): every launch starts its own `Xvfb -displayfd`, so the X server picks a free display itself; every app
and X server is tracked and killed on exit (also on Ctrl+C); `launch()` reports `ready` and logs
"APP NOT READY" when the start-up line never comes; `replay.mjs --log` exits 3 in that case, and `run_all` retries
that start once, printing `RETRY ... app never became ready`. A check that runs and fails is never retried.

**Known limits.**
- REFRESH reads only the newest `logbackups` file and Game.log (the start-up scan's files); a job accepted two game
  sessions ago keeps "Not found in UEX" if its marker line is older than that.
- Markers of ended jobs are not read, so their (history) steps are not re-placed.
- The automatic run compares version + commit; a local rebuild without a new commit doesn't run it again.

## Pickup distance, bad reads, copy buttons (batch 6)

Added 2026-10-14, user-approved (CONTRACT7 A, B, C). Rules 29-33 in
[STANDALONE.md](../src/other/STANDALONE.md#pickup-distance-and-bad-reads-batch-6-user-2026-10-14); files and data flow
in [SYSTEM-MAP.md](SYSTEM-MAP.md#other-mode-pickup-distance-bad-reads-copy-buttons-batch-6-2026-10-14).

**The case (the user's 12:02 export).** The user stood at Covalex Distribution Centre S1DC06 on Hurston (start
"Covalex Distribution Centre S1DC06 · 305 m", accuracy 10). Job J82's first step is a combined one: pickupLocation
"Covalex Distribution Center S1DCO06 on Hurston" (OCR doubled O), location "Security Compound", not picked up, and
`position` = the drop-off marker (Security Compound, ~4 km away). The lookup found nothing (method `none`), so the row
fell back to `step.position`: the distance table said 4175 m from the marker, the overlay said "≈4 km surface from
you" and the header "Covalex Distribution Center S1DCO06 on Hurston · near Covalex Distribution Centre S1DC06
(4 km)", for a pickup the user was standing on. In `## WHERE AM I HISTORY`, two reads at the same spot (16:59:52,
17:00:36) came out "Open space": the system word was garbled, `knownSystem()` title-cased it into a made-up system,
the body lookup in that system's pool failed ("Hurston not in the roster"), and the SolarSystem line was used, which
on a planet turns with the body and matches no roster place. A third read (16:58:20, the body line cut off) came out
"Rappel · 46.4 km" from the Root line.

| # | Fix | Owner | Test (fails on f45af9f) |
|---|---|---|---|
| A1 | Last lookup tier: folded names with runs of 2+ zeros collapsed to one inside words that carry a digit, exact match only, same pick rules; reported as method `folded` | `otherNext.ts` `findRosterLocation()`, `explainPlaceLookup()` | `next_order.mjs`; replay `j82-pickup-here` |
| A2 | While a step's pickup is open, `stepPointWithSource()` never uses `step.position` (the drop-off marker on a combined step); no pickup place → no distance. After pickup the marker works as before | `otherNext.ts` | `next_order.mjs` (unresolvable pickup: no distance, not 4 km; resolvable: ≈0.3 km; after pickup: ≈4 km); replay `j82-pickup-here` |
| B1 | `knownSystem()` returns '' for unknown names, so a garbled read has no system; the map line keeps its title-cased word | `otherWhere.ts` | `where_checks.mjs` |
| B2 | Near a body, look the body up in the read system's places, then in every system | `otherWhere.ts` `resolveDisplayInfo()` | `where_checks.mjs`; replay `where-covalex-garbled` (both "Open space" reads → Covalex S1DC06 ~250-320 m, accuracy 10) |
| B3 | Near a body but the body position fails → no position; check `position: near <body> but the body position failed: star-frame lines not used on a planet`; the start is kept. Space keeps the SolarSystem / Root path | `otherWhere.ts` `resolveDisplayInfo()` | `where_checks.mjs`; replay `where-covalex-garbled` (the Rappel read: no position, the check in `## WHERE AM I HISTORY`, start unchanged) |
| C | COPY TEXT / COPY IMAGES after a UI export; all saved pictures stitched into `<base>-all.png` (side by side, top-aligned, 16 px black gaps, unscaled, `nativeImage` only), listed in `## IMAGES` and returned as `combinedImage`; IPC `diag:copyText` / `diag:copyImages`; "no export yet" before an export | `diagnostics.ts`, `trace.ts` (`stitchBitmaps`), `channels.ts`, preload, `index.ts` re-tie, Settings / Debug export areas | `diag_checks.mjs` (sizes, gaps, pixels); replay `diag-copy-buttons`, `diag-copy-none` |

The replays use the export's real texts: J82's step label, pickup name and drop-off marker point verbatim, and the
four raw zone 2 texts verbatim except the ServerTime line, set to the test time so the read is not "maybe stale"
(−3). `diag-copy-buttons` first puts a sentinel on the clipboard, since the export already copies the text by itself.

Old build results (f45af9f, `REPLAY_ROOT` copy of `out/`): `j82-pickup-here` 5 of 7 checks fail (table 4175 m from
the marker, overlay "≈4 km surface from you" and "near Covalex Distribution Centre S1DC06 (4 km)", Next "≈4 km";
the start read and "Next has no near" pass); `where-covalex-garbled` fails on both "Open space" reads (system "Zone",
accuracy 9) and on all three Rappel checks (start became "Rappel · 46.4 km"); the planet-line read passes (unchanged
behaviour); `diag-copy-buttons` and `diag-copy-none` fail (no `combinedImage`, no copy IPC).

**Known limits.**
- The doubled-zero tier is exact-match only; other OCR doublings still find nothing.
- A pickup place that can't be found now shows no distance (before: the drop-off's distance, which was wrong).
- A read near a body whose body can't be placed gives no position, even where the star-frame line would have been
  close; the start is kept and the read's checks say why.
- The replay seam captures nothing, so the replay's `<base>-all.png` holds only the overlay picture.

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
