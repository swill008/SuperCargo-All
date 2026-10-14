<!-- Copy of the batch contract the lead gave the agents (CONTRACT14.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 12 (final scope) contract. User-approved 2026-10-14. Lead owns this file.

Repo /home/user/sc-features, branch features (HEAD ab1edb7 + uncommitted batch-12 work: paths.ts, dataFolderIpc.ts,
release files; read CONTRACT13.md in this folder for that earlier part). Rules: edit ONLY your files; no commits; no player
names or IDs anywhere; log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; run
`npm run typecheck` before finishing (errors in files you don't own may show while others work: report, don't fix).
Do NOT run npm run build or the replay/run_all suites (the lead builds and tests at the end). NEVER change program behaviour
beyond what this contract says; if something is unclear or would change behaviour, stop and put the question in your report.
Final report: files changed, exports, test results, open questions, start/end clock times (`date +%H:%M`).

## Shared, already written by the lead (do not edit; ask the lead for changes)
src/shared/types.ts: DataSyncResult.status?, RefDataFileState, RefDataFileStatus, RefDataStatus, ReleaseNote, UpdateState
(new kinds: checking | upToDate | available{version, notes, url, portable, skipped?, sizeBytes?} | downloading{version, percent,
transferred?, total?} | ready{version, verified} | error{message} | failed{version, message}), UpdatedNotice,
DataFolderProblem, DataFolderCheck, DataFolderChangeResult.needsRepair?/movedTo?, AppSettings.skippedUpdateVersion?,
AppSettings.lastRunVersion?.
src/shared/channels.ts: updaterDownload, updaterSkip, updaterState, updaterUpdatedNotice, refDataGet, refDataCheck,
evtRefData, dataFolderRepair.
src/preload/index.ts (window.supercargo): downloadUpdate(), skipUpdate(version), getUpdateState(), getUpdatedNotice(),
getRefDataStatus(), checkRefData(), onRefData(cb), repairDataFolder(target).
src/main/index.ts: the lead wires everything (send the lead the exact lines; see "index.ts wiring" in each part).
DataFolderRow is now its own file: src/renderer/src/components/DataFolderRow.tsx.

## A. Data folder (agent: datafolder) files: src/main/paths.ts, src/main/dataFolderIpc.ts, NEW src/main/dataCheck.ts,
src/renderer/src/components/DataFolderRow.tsx, test/replay/paths_checks.mjs
User decisions (like Gremlin):
- DATA_FOLDER_NAME = 'SuperCargo-OtherModes'; default C:\Users\<you>\SuperCargo-OtherModes (os.homedir()).
- CHANGE…: the picked folder is used AS IS. Remove targetFor/subfolder.
- A chosen folder missing at start-up: fall back to the default with the reason (keep today's behaviour).
- "SuperCargo files" = the known names the app writes in the data folder root (see CONTRACT13 "Placement": manifest.json,
  history.json, window-state.json, other-jobs.json, other-matches.json, other-bodies.json, other-uex-places.json,
  uex-*.json, reference-data-status.json, upload-queue.json, game-data/, logs/, ocr-samples/, other-ocr-session/, outbox/,
  exports/; grep src for dataPath( to complete the list). settings.json is never one of them (never moved, never copied).
  holdsData(dir) = any of these exists in that root.
- NEW dataCheck.ts: `checkDataFolder(dir): DataFolderCheck` validates each existing SuperCargo JSON file with the same rule
  its loader uses (it parses as JSON and has the shape the loader expects, e.g. history.json {entries: []}; read each
  loader in store.ts / src/other/main/*.ts and copy the shape test, don't import loaders that have side effects).
  `moveForRepair(dir, when = new Date()): string` moves ALL SuperCargo files and folders (not only damaged ones; not
  settings.json, not "Moved for Repair") into `<dir>\Moved for Repair\<YYYY-MM-DD HH-MM>\` keeping the folder structure;
  if that name exists add " (2)", " (3)"…; returns the absolute folder. Log what moved.
  `startupDataCheck(): Promise<'ok' | 'reset' | 'quit'>`: runs after app ready, before windows open: checks dataFolder();
  problems -> native dialog.showMessageBox warning: title "SuperCargo data can't be read", message lists the damaged files
  with reasons, detail: "Reset moves all SuperCargo files in <folder> into "Moved for Repair\<date>" so you can look at them.
  Your settings are kept. The app then starts with empty data."; buttons ["Reset and continue", "Quit"] (default Quit,
  cancelId Quit). Reset -> moveForRepair, 'reset'. Quit -> 'quit' (index.ts then app.quit()).
- After CHANGE… (switchTo): target has SuperCargo data -> checkDataFolder; fine -> use as is (usedExisting); problems ->
  return {ok:false, needsRepair, info} WITHOUT saving. DataFolderRow then shows an inline warning box listing the files and
  reasons, with buttons RESET AND CONTINUE / CANCEL. RESET AND CONTINUE -> repairDataFolder(target): moveForRepair(target),
  then the folder has no SuperCargo data so the normal rule applies: copy the current data in (copyMissing), save, pending
  restart; result {ok:true, copied, movedTo}. Message: "Moved the old files to <movedTo>. Copied N files."
  Target without SuperCargo data -> copy current data in first (as today).
- paths_checks.mjs: update for the new name, no subfolder, holdsData list, checkDataFolder (good/damaged/bad shape),
  moveForRepair (structure kept, settings.json stays, " (2)" on a clash), switchTo needsRepair path, repair path.
index.ts wiring: in app.whenReady() before creating windows: `const dc = await startupDataCheck(); if (dc === 'quit') {
app.quit(); return }`; registerDataFolderIpc already wired (add dataFolderRepair handler inside registerDataFolderIpc).

## B. Updater main (agent: updmain) files: src/main/updater.ts, NEW src/main/releaseNotes.ts, src/main/store.ts,
NEW test/replay/update_checks.mjs, package.json ("test:update" script line only)
- Like Gremlin's updater: checks once at start-up when settings.autoCheckUpdates (DEFAULT TRUE now: remove the store.ts
  force-off and set the default true), plus on demand (Check for Updates). No hourly recheck (lead removes it in index.ts).
- autoDownload = false (Gremlin asks first: Update Now). Installed copy: Update Now -> downloadUpdate() -> downloading
  {percent, transferred, total} -> ready{verified:true} (electron-updater checks size + sha512 from latest.yml before
  'update-downloaded'; a check failure surfaces as error -> failed{version, message}). Install and Restart ->
  quitAndInstall(). Try Again -> downloadUpdate() again. autoInstallOnAppQuit = false.
  Portable (zip) copy: never downloads; available{portable:true}; Open Release Page = url.
- releaseNotes.ts: `whatsNew(body, version): string | null` (the text after "## What's new in R1 <version>" — also accept
  "## What's new in <version>" — up to the next "#"/"## " heading; trimmed; null when absent);
  `fetchNotes(current, offered): Promise<ReleaseNote[] | null>` reads https://api.github.com/repos/<fork-owner>/SuperCargo-All/releases
  (10 s timeout, Accept application/vnd.github+json), keeps releases with current < version <= offered (version from the tag
  "SuperCargo-OtherModes-R1-<ver>" or tag_name sans v), newest first, each's whatsNew; falls back to the offered release's
  own notes; null when nothing/no network. Notes fetched BEFORE 'available' is sent, cached for the session (opening the
  window again shows them at once).
- Skip This Version: updaterSkip saves settings.skippedUpdateVersion (via a deps.updateSettings passed to initUpdater). The
  start-up check for a skipped version sends available{skipped:true} (the renderer stays quiet for skipped at start-up);
  Check for Updates by hand always shows it. A newer version than the skipped one is offered normally.
- Updated notice: at start-up compare app.getVersion() with settings.lastRunVersion; if lastRunVersion is set and older ->
  UpdatedNotice{from,to} kept for getUpdatedNotice (returned once, then null); then save lastRunVersion = current.
- getUpdateState returns the last state sent. Prerelease versions (with '-') skip checks as today.
- Test hook (for the e2e agent): env SC_TEST_UPDATE_FEED=<path to JSON> {version, notes?: ReleaseNote[] | null,
  portable?: boolean, failCheck?: string, failDownload?: string, upToDate?: boolean}: when set, no network: check/download
  run on timers (download 3 steps of ~150 ms) and send the same states; quitAndInstall only logs "update install (test)".
- export `initUpdater(deps: { getWindow; getSettings; updateSettings })`, `checkForUpdates(byHand: boolean)`,
  `downloadUpdate()`, `skipVersion(v)`, `lastUpdateState()`, `takeUpdatedNotice()`, `quitAndInstall()`.
- update_checks.mjs: whatsNew cases (heading forms, next heading stops it, missing -> null), version filter/order of
  fetchNotes with a stubbed fetch, skip logic, updated-notice logic. Pure functions only (export them for the test); load
  TS the way the other *_checks.mjs do (look at resolve_checks.mjs / paths_checks.mjs).
index.ts wiring: send the lead the exact replacement lines for initUpdater/checkForUpdates/IPC handlers.

## C. Update window UI (agent: updui) files: NEW src/renderer/src/components/UpdateWindow.tsx,
src/renderer/src/components/UpdateBanner.tsx, src/renderer/src/pages/SettingsPage.tsx (UPDATES section only + UpdateStatus),
src/renderer/src/state/store.ts (update state + autoCheckUpdates default true + update window open flag only),
src/renderer/src/App.tsx (mount only)
Like Gremlin's DialogUpdate.qml (read /home/user/Gremlin-Platforms/qml/DialogUpdate.qml and
gremlin/ui/update_model.py for wording/states; don't copy QML, match behaviour and words). A modal window in the app:
- Title "Check for Updates". States: checking ("Checking for updates…"), upToDate ("SuperCargo-OtherModes R1 x is up to
  date."), available ("R1 <new> is available. You have R1 <cur>." + notes box + buttons), downloading (progress bar,
  "Downloading… 12.3 / 85.0 MB"), ready ("Downloaded and checked. Install and Restart to finish."; buttons Install and
  Restart / Later), error ("Couldn't check for updates: <msg>"; Try Again / Close), failed ("The download failed: <msg>";
  Try Again / Open Release Page / Close).
- available buttons: installed: Update Now / Skip This Version / Later; portable: Open Release Page / Skip This Version / Later.
- Notes box (4a-4e): only What's new (render the markdown safely as React elements: "### X" -> small heading, "- " ->
  bullet, **bold**; never dangerouslySetInnerHTML); several versions -> each starts with a small muted line
  "What's new in R1 <v>", thin rule and space between, newest first (no such line when only one); scrolls inside the
  window; below it the link "Full release notes on GitHub ↗" (url, opens in the browser like other external links in the
  app); notes null -> "Release notes unavailable." (link still shown, updating still works).
- Reference data panel at the bottom of the window: renders <RefDataStatusPanel/> from
  src/renderer/src/components/RefDataStatus.tsx (agent refdata writes it; default export, no props). Until it exists,
  import it anyway; the lead resolves at merge.
- When it opens: start-up check result available (not skipped) -> the window opens by itself (like Gremlin); skipped ->
  stays quiet; upToDate/error at start-up -> stays quiet. Check for Updates (Settings → GENERAL → UPDATES button "CHECK FOR
  UPDATES", replacing CHECK NOW) opens the window and checks by hand (checkForUpdates). Keep the "Auto-check on launch"
  toggle (label "Check for updates at start-up").
- Updated notice: on mount, getUpdatedNotice(); if set show a banner (UpdateBanner) "Updated — now R1 <to>" with
  WHAT'S NEW (opens the release page) and a close X.
- UpdateBanner: keep a small "Update ready — INSTALL AND RESTART" bar when ready and the window was closed with Later; the
  available/portable bar is replaced by the window.
- SettingsPage UPDATES: "⚠ Reference data: <n> file(s) couldn't be updated — see Check for Updates" line when any
  RefDataStatus file is downloadFailed/hashMismatch/badFormat (read via getRefDataStatus + onRefData).
- UpdateStatus pill: map the new kinds.

## D. Reference data status (agent: refdata) files: src/main/dataSync.ts, src/main/diagnostics.ts (REFERENCE DATA section
only), NEW src/renderer/src/components/RefDataStatus.tsx, test/replay/refresh_checks.mjs
- Source stays the original author's repo (RAW_BASE <upstream-owner>/SuperCargo main data/uex). Env override for tests:
  SC_TEST_REFDATA_BASE (a file:// dir or http URL) replaces RAW_BASE.
- refreshFromRepo() fills a RefDataStatus: per SPECS file (labels: Ships, Locations, Commodities, Cargo grids, Contract
  box sizes): upToDate / updated / downloadFailed / hashMismatch / badFormat with at=now and a detail; hashes.json
  unreachable -> reached:false and each file downloadFailed ("couldn't reach the list"), keeping the old at for files
  never changed? No: at = now for the failure. Saved to dataPath('reference-data-status.json'); `loadRefDataStatus()`
  (notChecked entries when missing); result.status set. After every check broadcast evtRefData (export
  `onRefDataChanged(cb)` hook or accept a broadcast fn: `setRefDataBroadcast(fn)`; the lead wires it) and log a summary.
  Never silent: failures log a warn line per file.
- IPC (lead wires, you export): `refDataStatus(): RefDataStatus`, `checkRefDataNow(): Promise<RefDataStatus>` (= seed +
  refreshFromRepo, and the same follow-up the dataRefresh handler does; return a callback-free function and tell the lead
  what follow-up to run).
- RefDataStatus.tsx: heading "Reference data (ships, places, cargo grids)"; one line per file: label, state in plain words
  (Up to date / Updated / Couldn't download / Fingerprint didn't match (kept the old copy) / Format not understood (kept the
  old copy) / Not checked yet) coloured (green/amber/red), date "14 Oct 2026 21:05"; "Last checked …"; source line "From the
  original SuperCargo author's data"; button CHECK NOW (checkRefData) with a busy state; listens to onRefData.
- diagnostics.ts: add a "REFERENCE DATA" section (checked at, reached, per file state + at + detail) to the export text.
- refresh_checks.mjs: cases for each state with a local file:// base (good, changed, wrong hash, bad shape, missing file,
  unreachable list), status saved and reloaded.

## E. Overlay O1 + O2 display (agent: overlay) files: src/other/renderer/components/OtherOverlay.tsx (+ any overlay-only
component it uses; report the list)
- O1: the stop card header has a FIXED height: line 1 = place name on one line, cut with "…" (text-overflow ellipsis), full
  name in a title tooltip on hover; line 2 = tags (match tag etc) and Body · System. Card height must not change when
  stepping ‹ › between stops with long/short names and with/without tags.
- O2 display: reputation shows "+<rep> REP" as today, or "+<rep>–<repMax> REP" when repMax is set (en dash). Find every
  place rep is shown in Other mode (grep "REP" / ".rep" in src/other/renderer) and update them all the same way; report
  files you need that you don't own.

## F. Parse + altitude (agent: parsealt) files: src/other/otherLogParse.ts, src/other/otherEvents.ts, src/other/otherJob.ts
(rep fields + carrying repMax through only), src/other/otherWhere.ts, src/other/main/whereAmI.ts (altitude only), the
matching tests in test/replay/*_checks.mjs that cover them (where_checks.mjs; add parse cases where log parsing is tested
— find it)
- O2: RE_REP accepts "[100–500 Rep]", "[100-500 Rep]", "[1,000 – 2,500 Rep]" (en dash, hyphen, spaces): rep = low,
  repMax = high (only when high > low). Plain "[313 Rep]" unchanged. Carry repMax everywhere rep is carried (event ->
  job -> saved job), optional field.
- O3: when the Altitude read from the screen is garbled/missing/implausible, compute altitude = |position − body centre| −
  body radius (km) from the position reading and the planet table (exact radius when known, estimated otherwise), and use
  it for the start label ("Hurston · 436 km up"). Find where the label and the "Open space" decision are made; keep the
  OCR altitude when it is sane and agrees within a tolerance you document. Mark the computed value (e.g. alt source
  'computed') in diagnostics if a diag field exists.
- Tests: rep range cases; altitude computed from position (fixture numbers, no player data).

## G. Release notes in the workflow (agent: relnotes) files: scripts/release-body.mjs, test/replay/release_checks.mjs,
.github/workflows/release-win.yml, .github/workflows/release-linux.yml (only if it builds a body), release-notes/README.md,
release-notes/1.0.0.md, test/replay/run_all.mjs (N3 only)
- N1: buildBody refuses notes without at least one "### New|Changed|Fixed" section with at least one "- " bullet; refuses
  placeholders (TODO, TBD, FIXME, "…" or "..." alone on a bullet, "<", "lorem"); refuses notes identical (after the heading)
  to the previous version's file. Clear error per rule.
- N2: release-notes/README.md: rule "each batch commit adds its lines to release-notes/<next version>.md" (writing notes
  as we go), and the release steps checklist.
- N3: run_all.mjs also runs release_checks.mjs (fails the run when notes are missing/empty for package.json's version).
- N4: workflow writes the final release body into $GITHUB_STEP_SUMMARY.
- N5: workflow stops when the tag SuperCargo-OtherModes-R1-<ver> already exists (git ls-remote --tags origin or the API)
  BEFORE building, with a clear message.
- installText: data folder name %USERPROFILE%\SuperCargo-OtherModes.
- Rewrite release-notes/1.0.0.md for everything in R1 1.0.0: Other modes (jobs beyond hauling, WHERE AM I, resolver, match
  memory, LEARNED DATA tab, Settings tabs GENERAL | OTHER MODE), data folder (%USERPROFILE%\SuperCargo-OtherModes, CHANGE…
  used as is, damaged-data check with "Moved for Repair"), installer + portable zip, updates like Gremlin (Check for Updates
  window, What's new, Skip This Version, progress + checked download, Updated notice, checks at start-up), reference data
  status in the update window, overlay fixes (steady card height, rep ranges, altitude from position). Plain user words,
  "### New / ### Changed / ### Fixed". Fresh start note stays.
- release_checks.mjs: cases for N1 rules and the README rule text; workflow contains the summary step and the tag check.

## H. End-to-end (agent: e2e) file: test/replay/replay.mjs only
Read the current scenarios first. Update/add scenarios (names in quotes), using the app's real UI by clicks:
- 'data-folder' (update): HOME/SuperCargo-OtherModes is the folder; CHANGE to an empty folder uses it as is (no subfolder),
  copies data, restart uses it; a folder with good data is used as is; missing chosen folder falls back with the reason.
- 'damaged-data' (new): a damaged history.json at start-up -> the dialog (stub dialog.showMessageBox via the harness's
  main-process eval if one exists; else check the path via the test env) -> Reset moves files to Moved for Repair\<date>,
  settings.json kept, app starts; CHANGE to a folder with damaged data shows the inline warning, CANCEL keeps the old
  folder, RESET AND CONTINUE moves + copies.
- 'update-window' (new): SC_TEST_UPDATE_FEED fixtures (write them to the temp dir): available with 2 versions of notes
  (window opens by itself at start, both "What's new in R1 …" lines newest first, the link), Skip This Version then
  restart -> quiet, Check for Updates by hand shows it again; Update Now -> progress -> ready -> Install and Restart logs
  "update install (test)"; failDownload -> failed + Try Again; notes null -> "Release notes unavailable."; portable ->
  Open Release Page; upToDate by hand -> "up to date"; updated notice after lastRunVersion older.
- 'refdata-status' (new): SC_TEST_REFDATA_BASE to a temp dir with good files + one wrong hash -> the window's panel lists
  the states; the ⚠ line shows in Settings; CHECK NOW after fixing the file -> Updated.
- 'overlay-header' (new, if the harness can show the overlay with jobs): card height equal across stops with long/short
  names; rep range shows "+100–500 REP".
- settings-tabs: keep passing (UPDATES section wording changed: CHECK FOR UPDATES).
Use the exported names in this contract; where a piece isn't built yet, write the scenario to the contract and say so.

## I. Docs (agent: docs) files: README.md, FAQ.md, src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md,
docs/TODO.md
- Data folder name SuperCargo-OtherModes, CHANGE used as is, damaged-data rule + Moved for Repair, updates like Gremlin
  (window, notes, skip, checks at start-up on by default), reference data from the original author's repo with status in
  the update window, overlay fixes, release notes rule (written per batch, checked by the workflow and run_all).
- docs/TODO.md: the to-do becomes "Only if we ever stop using the original author's reference data" (keep the how-to, drop
  the decided questions about which branch).
- SYSTEM-MAP: new files (dataCheck.ts, releaseNotes.ts, UpdateWindow.tsx, RefDataStatus.tsx, DataFolderRow.tsx,
  update_checks.mjs) and the new IPC channels.
