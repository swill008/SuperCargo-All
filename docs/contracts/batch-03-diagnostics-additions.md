<!-- Copy of the batch contract the lead gave the agents (CONTRACT3.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 3 contract: 15 diagnostics additions (user-approved, all of them). Lead owns this file.

Repo /home/user/sc-features, branch features (last commit 0fcf528). Background: CONTRACT.md, CONTRACT2.md in this folder.
Rules: edit ONLY your files; no commits/pushes; no player names in code/tests/fixtures; everything that goes into the export
text passes the existing sanitizer (src/main/sanitize.ts, sanitizeDeep) — handle -> PLAYER, ids -> OWNER-n;
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; run `npm run typecheck` before finishing
(other agents' mid-build errors are expected — report them). Final report: files, exports, results, start/end clock times.

The export today: src/main/diagnostics.ts buildDiagnostics() writes one .txt with sections SUMMARY, SETTINGS, SNAPSHOT,
UNKNOWN LINES, DECISIONS, PERF, USAGE, ERRORS, DEBUG LOG, LOG EXCERPT. The main window answers diagSnapshotRequest
(src/renderer/src/App.tsx) with { other: otherDiagSnapshot(), haul: ... }.

## The 15 items
P1  1 NOTE: "What went wrong?" text typed at export -> `## NOTE` section at the very top.
    2 OVERLAY: the overlay window answers its own snapshot request -> `## OVERLAY` section: place-list size (+version),
      start (label, source, accuracy), current stop index/place, distance text shown, no-distance text, last read message,
      AFK state shown, tracked id, settings it rendered with (otherOverlayDistance, start mode).
    3 WHERE AM I HISTORY: last 10 reads (why, at, ok, zone, ms, timings, note, checks, accuracy, label, error, raw per zone).
    4 AFK LOG: every press (at, key, scan, game window found, focus ok, helper reply ok/error), helper stderr (last 20 lines),
      helper start-up ms, restarts, current AfkState.
    5 CAPTURE: displays (size, scaleFactor, bounds), capture target used (game window / display id), captured image size,
      zone 1/2 boxes in pixels + their fractions.
P2  6 IMAGES (opt-in tick box, off by default): last zone 1 + zone 2 crops (unscaled) saved as PNG next to the export
      (<export base>-zone1.png, -zone2.png). Note in the export lists the saved files.
    7 LOCATION HISTORY: last 30 `where` changes (at, source, label, accuracy, outcome 'applied'|'older-ignored'|'cleared').
    8 PLACE LOOKUP per stop: explainPlaceLookup(raw, locations) -> { raw, cleaned, method: 'exact'|'contains'|'address'|
      'folded'|'none', match?: name, hasCoords, candidates (≤5: name, system, hasCoords) }.
    9 HOTKEYS: ocrHotkey + otherWhereHotkey: value, isRegistered now (globalShortcut.isRegistered), last registration
      result/reason, paused-for-recording.
   10 LIVE: getWhereLiveStats().
P3 11 PLACES: roster counts per system and per source (UEX / starmap / other), with and without coords.
   12 DISTANCE DETAIL per stop: explainTravel(a, b, locations) -> { aSystem, bSystem (normalised keys), sameSystem,
      gatewayOut?, gatewayIn?, surface, body?, meters, jumps }.
   13 GAME LOG HEALTH: log path, file size, mtime, last line time seen, median and max lag between a line's <timestamp> and
      when the app received it (from trace parse records: line time vs record t), rotations seen if known.
   14 OVERLAY PICTURE (same opt-in as 6): compact window capturePage() PNG next to the export (<base>-overlay.png).
   15 TIMINGS per read: capture ms, OCR ms zone 1 / zone 2, parse+resolve ms (part of item 3's records).

## Interfaces (fixed names)
- src/shared/trace.ts: DiagExportOptions += { note?: string; includeImages?: boolean }; DiagExportResult += { images?: string[] }.
- src/main/diagnostics.ts:
  - Source += overlayWindow?: () => BrowserWindow | null (index.ts setDiagSource call passes () => compactWindow — 1-line re-tie).
  - export function setOtherDiagSource(s: { sections: () => Record<string, unknown>; images: () => { name: string; png: Buffer }[] }): void
    The other main code registers it (register.ts). Each key of sections() becomes `## <KEY>` (e.g. 'WHERE AM I HISTORY',
    'CAPTURE', 'AFK LOG', 'HOTKEYS', 'LIVE'), JSON, sanitised.
  - Overlay snapshot: same diagSnapshotRequest/Reply channels, separate reqId sent to the overlay webContents.
- src/other/renderer/state/otherOverlayDiag.ts (NEW, renderer agent): setOverlayDiag(partial: Record<string, unknown>), overlayDiag().
- Overlay responder (ui agent, in OtherOverlay.tsx): useEffect -> window.supercargo.onDiagSnapshotRequest(reqId =>
  window.supercargo.diagSnapshotReply(reqId, { overlay: overlayDiag() })) — ONLY in the overlay window (the component only
  mounts there; double-check the main window doesn't also mount OtherOverlay; if it does, guard with window.location.hash === '#compact').
- otherNext.ts: export explainPlaceLookup; otherGeo.ts: export explainTravel (renderer agent).
- otherJobs.ts: export whereHistory(): readonly entries (renderer agent).
- whereAmI.ts: keep last crops in memory (Buffer PNG, unscaled), per-read timings, capture details; export
  getWhereDiag(): { history, capture, live, hotkeys }, getWhereImages(); afk.ts: export getAfkDiag(): { state, presses[], stderr[], startupMs, restarts }.

## Agents and files
- diag-main: src/main/diagnostics.ts, src/shared/trace.ts, src/main/index.ts (setDiagSource re-tie only), src/main/sanitize.ts (if needed).
  Items 1 (section), 2 (main side), 6/14 (saving PNGs; overlay capturePage), 13, ordering of all sections.
- diag-other-main: src/other/main/whereAmI.ts, src/other/main/afk.ts, src/other/main/register.ts. Items 3, 4, 5, 9, 10, 15, 6 (crops).
- diag-renderer: src/other/renderer/state/otherDiag.ts, src/other/renderer/state/otherJobs.ts, src/other/otherNext.ts,
  src/other/otherGeo.ts, NEW src/other/renderer/state/otherOverlayDiag.ts. Items 7, 8, 11, 12 (+ the overlay diag module).
- ui: src/other/renderer/components/OtherOverlay.tsx, src/renderer/src/pages/SettingsPage.tsx (EXPORT DIAGNOSTICS area only),
  src/renderer/src/pages/DebugPage.tsx (export area only). Items 1 (dialog: textarea "What went wrong?" + tick box
  "Include images (OCR crops and an overlay picture). Pictures can't be cleaned of names." off by default), 2 (overlay publishes
  + responds), 6/14 (tick box). The export result shows saved image paths.
- e2e-docs: test/replay/replay.mjs, src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md.
