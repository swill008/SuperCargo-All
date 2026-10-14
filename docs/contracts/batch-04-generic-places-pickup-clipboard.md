<!-- Copy of the batch contract the lead gave the agents (CONTRACT4.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 4 contract: generic places from markers, pickup before delivery, clipboard copy (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features. Background: CONTRACT.md..CONTRACT3.md in this folder.
Rules: edit ONLY your files; no commits; no player names; activity log lines; `npm run typecheck` before finishing.
Final report: files, exports, results, start/end clock times.

## The case (real, from the user's export)
Job J74 (FTL_Courier_Stanton_Iron_Rank1, missionId c240a60b-…): steps in game order
 1. turnin "Deliver Iron To Security Compound" (location "Security Compound", objectiveId dropoff_<id>_0)
 2. pickup "Collect Iron From HDPC-Farnesway on Hurston" (location "HDPC-Farnesway", objectiveId pickup_f1fc9593-…_0)
Marker line (verbatim, real):
<2026-10-14T15:12:49.694Z> [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [<id>], generator name [FTL_Courier], contract [FTL_Courier_Stanton_Iron_Rank1], contractDefinitionId[<id>], objectiveId [dropoff_<id>_0], markerEntityId [7145], zoneHostId [<zone-id>], position [x: -790556.763184, y: 614240.106819, z: -6055.992337] [Team_MissionFeatures][Missions]
|position| = 1001.2 km = Hurston's radius → the zone is Hurston's body frame. Hurston centre (roster) + position lands 4.0 km
from HDPC-Cassillo (the game's location lines elsewhere name "Security Compound [DC_Stan_Hurston_S1_Cassillo_FOB]").
Today it shows "Not found in UEX" because the zone isn't calibrated (calibration needs a z-match with a UEX place).
Also: calibrateZone is called with useStore.getState().locations (haul roster only) — use the merged roster (mergeLocations).
Zone ids change per server (SolarSystem id <zone-id> one session, <zone-id> the next), so tables learned on an
earlier server are wrong for the current one.

## Fixes
F1 Body-frame markers (otherMarkers.ts): for a non-root, non-small marker whose zone isn't calibrated: estimate each body's
   radius = median distance of its roster places (Location.body === body name, with coords) from the body's centre (roster
   entry named the body); candidate bodies = radius within ±3% of |position|; for each, point = centre + position; accept
   a body when the point lies within 10 km of one of that body's places; exactly one accepted body → calibrate the zone with
   centre = body centre (method 'body', place = the near place). Hurston and microTech are both ~1000 km: the place check
   decides; none or >1 accepted → leave uncalibrated (decide trace says why).
F2 Generic place label: rows whose point came from a marker get `near?: { name: string; meters: number }` = nearest roster
   place within 25 km (otherNext.ts). UI (overlay start/stop line and Next tab row) shows "Security Compound · near
   HDPC-Cassillo (4 km)" instead of "Not found in UEX" when a marker distance exists.
F3 Zone table per server: the reducer clears the marker zone table for the current build on 'session' and on 'disconnect'/'quit'
   events (new server = new zone ids); markers that arrive after are calibrated fresh. Already-placed step positions
   (system frame) stay. Diagnostics/decide trace notes the reset.
F4 Pickup before delivery (otherNext.ts): nextLiveStep and the step order used by listOpenStops (show-all and route) put an
   undone pickup step before undone turnin/delivery steps of the same job that carry the same item (case-insensitive); if
   either side has no item, keep game order. Steps with pickupLocation (combined "collect from A, deliver to B") are unaffected.
   J74 → first open step is "Collect Iron From HDPC-Farnesway".
C  Clipboard: after a successful export save, the main process copies the whole saved text to the clipboard
   (electron clipboard.writeText). DiagExportResult += { copied?: boolean }. Not for the CLI --export-diagnostics path.
   UI result line: "Saved and copied · 1.4 MB · <path>"; when > 1 MB add " (large: attaching the file may work better)".
   If the copy fails: "Saved (copy to clipboard failed)".

## Agents and files
- markers: src/other/otherMarkers.ts, src/other/renderer/state/otherJobs.ts, NEW test/replay/marker_checks.mjs (esbuild bundle
  like next_order.mjs; real marker above + data/uex/other-positions.json {places}: F1 lands near HDPC-Cassillo ≈4 km; a fake
  marker at microTech-radius with no near place stays uncalibrated; ambiguity rule).
- next: src/other/otherNext.ts, test/replay/next_order.mjs, src/other/renderer/components/OtherOverlay.tsx,
  src/other/renderer/pages/NextPage.tsx (F2 display + F4).
- clip: src/main/diagnostics.ts, src/shared/trace.ts, src/renderer/src/pages/SettingsPage.tsx and src/renderer/src/pages/DebugPage.tsx (export result line only).
- e2e-docs: test/replay/replay.mjs, src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md: scenarios —
  J74 replayed from real lines (accept, objectives, the marker) → overlay/Next show a distance and "near HDPC-Cassillo",
  first open step is the Farnesway pickup; a session line resets the zone table; diagExport → clipboard text (read in main via
  the inspector helper mainEval: require('electron').clipboard.readText()) equals the saved file and the result says copied.
  Each must fail on the old build (copy out/ before rebuilding). Then docs.
