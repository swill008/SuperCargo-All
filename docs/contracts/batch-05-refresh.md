<!-- Copy of the batch contract the lead gave the agents (CONTRACT6.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 5 contract: REFRESH (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features. Background: CONTRACT.md..CONTRACT5.md, src/other/STANDALONE.md (job rules: the
start-up scan applies only events after the watermark; main window is the only writer).
Rules: edit ONLY your files; no commits; no player names; activity log lines; `npm run typecheck` before finishing.

## Why
Marker lines (CreateMarker) and objective text for a job are logged when the contract is accepted. After a restart the scan
replays only events newer than the watermark, so code that learned to place a step later (e.g. body-frame markers, batch 4)
never sees that job's old marker line. Real case: J74 "Deliver Iron To Security Compound" stays "Not found in UEX".

## What
REFRESH (button on the Next screen next to STARTING AT, and in the Jobs screen header; not on the overlay):
1. Reload places: main refreshes the Other places roster (refreshOtherPlaces / loadOtherPlaces path) and the renderer reloads
   them (loadOtherPlacesFromMain) — the place list version bumps so views recompute.
2. Re-scan logs for ACTIVE jobs only: main reads the current Game.log + the newest logbackups file (same files as the start-up
   scan) IGNORING the watermark, but returns ONLY 'marker' events (and 'session' events for the build/zone context, in order) whose
   missionId is in the given list of active mission ids. Nothing else (no accepts, endings, objectives, quits).
3. The main window re-applies them with a refresh-only path: reset the current build's zone table, re-calibrate from those markers
   (normal calibrateZone incl. the body-frame path), re-place steps (placeSteps over all jobs). Must NOT touch the watermark
   (lastLogEventAt/Count), job status, steps' done flags, history, or create/end jobs. Overlay sends the action to the main
   window (rule 8) if the button is ever there (it isn't now).
4. Result line on the screen (~6 s) + decide trace + debug log: "Refreshed · 3 jobs · 1 place found (Security Compound near
   HDPC-Cassillo)" / "Refreshed · nothing new". Counts: active jobs, markers read, steps that gained a position, zone result.
5. Automatic once: on the first start after an update (app version or git commit in DebugInfo differs from the doc's
   `refreshedForVersion`), run steps 1–3 silently after the start-up scan; store `refreshedForVersion` in the doc.

## Interfaces
- IPC otherJobsRefreshScan 'otherJobs:refreshScan' (invoke, missionIds: string[]) -> { events: OtherLogEvent[]; files: string[]; ms: number }
  (main: src/other/main/scanLog.ts new export scanMarkersFor(logPath, missionIds); handler in src/other/main/jobs.ts; channel +
  preload `refreshScanOther(missionIds)`).
- Renderer store action `refreshJobs(opts?: { silent?: boolean }): Promise<RefreshResult>` in otherJobs.ts;
  RefreshResult { jobs; markers; placed; zones: string; message }.
- Doc field refreshedForVersion?: string (otherJob.ts + main/jobs.ts validation). The app version/commit: window.supercargo has a
  debug-info getter (check preload for debugInfo/getDebugInfo); use version + commit.
- UI: REFRESH button (Next + Jobs), disabled while running, shows the message.

## Agents
- refresh-main: src/other/main/scanLog.ts, src/other/main/jobs.ts, src/shared/channels.ts (Other block), src/preload/index.ts (Other lines).
- refresh-state: src/other/renderer/state/otherJobs.ts, src/other/otherJob.ts, src/other/renderer/state/otherDiag.ts (last refresh result in SNAPSHOT).
- refresh-ui: src/other/renderer/pages/NextPage.tsx, src/other/renderer/pages/JobsPage.tsx.
- e2e-docs: test/replay/replay.mjs + docs: scenario = J74 lines (accept, objectives, marker) applied, app restarted with the watermark
  past them (or run the old build first to create the doc), then REFRESH via cdpEval(useOtherJobs action or the button) → step
  gets a position, overlay/Next show "near HDPC-Cassillo"; watermark unchanged; ended jobs not revived; automatic refresh runs
  once per version.

## Added (user-approved): sanitiser OS-user fix
src/main/sanitize.ts replaces the OS user name everywhere in the export; when the name is a common word (container user "root")
ordinary words/keys become "%USERNAME%" (e.g. a SNAPSHOT key "root"). Fix: replace the OS user name only inside path contexts
(\Users\<name>\, /Users/<name>/, /home/<name>/, C:\Users\<name>, %USERPROFILE%-like paths, case-insensitive on Windows paths)
and as a whole value equal to the name; never inside other words or JSON keys. Agent: sanitize-fix (owns src/main/sanitize.ts +
a new test/replay/sanitize_checks.mjs: name "root" keeps `"root": true` keys and the word "root" but cleans
C:\Users\root\AppData and /home/root/...; a distinctive name still cleaned in paths; the player-handle rules unchanged).
