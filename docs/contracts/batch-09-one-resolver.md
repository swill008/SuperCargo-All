<!-- Copy of the batch contract the lead gave the agents (CONTRACT10.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 9 contract: ONE name/place resolver for all of Other mode (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features (HEAD adde3ba = batch 8, pushed). Work here directly.
Background: CONTRACT8.md (+ADDENDUM) resolver, CONTRACT9.md (+ADDENDUM 2, 3) memory, sources, typo, site codes.
Rules: edit ONLY your files; no commits; no player names in code/tests/fixtures (handle = PLAYER);
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing
(others' mid-build errors expected; report them). Do NOT run npm run build (the lead builds and runs replay at the end).
Final report: files, exports, results, start/end clock times.

## Why (user)
"I asked you to streamline the process... that means the entire name/place resolution." Today 11 of 13 Other-mode lookups
bypass otherResolve. Worst: job import (Game.log and screenshot scan) RENAMES the place text to a roster name, so a wrong
rename later shows as "✓ exact". Learning (match memory) and user fixes must apply to every lookup.

## Inventory (all must end up in the one resolver unless marked KEEP)
1 job import from Game.log: otherLocationSnap.snapOtherLocation (otherLog.stepFromParse)
2 job import from scan: snapOtherLocationOcr / ocrTokenMatch / fixOcrLagrangeCodes (otherOcr.ts)
3 stops: otherResolve.resolveStopPlace (already)
4 typed start: otherNext.resolveOrigin -> findRosterLocation
5 log position clues: otherJobs.whereFromPlace (objective complete, inventory) -> findRosterLocation
6 map-line read: otherWhere.resolveMapLine
7 marker placement: otherJobs.placeSteps hasUex -> findRosterLocation
8 by-name distance helpers: otherNext travelFromStart / distanceFromStart / compareByDistanceFrom / rosterDistance / snapLocationToUex
9 diagnostics copies: explainPlaceLookup / findFolded / foldPlaceName (also used in otherJobs proof compare)
10 game location codes: otherCurrentLocation.rosterNameForCode (Stanton1_Lorville, RR_HUR_L1)
11 wiki site codes: otherSiteCodes (already in the resolver)
12 position -> place: otherNext.nearestRosterPlace (near labels, learned report, proof "you were at")
13 display-info read: otherWhere.snap / placed (body lookup + nearest place)
KEEP (exact rules / geometry / upstream): otherGeo.gateway & gatewayLocation, otherMarkers.locationByZ,
otherPlaces merge (sources), src/renderer/src/state/store.ts + shared/logLocation.resolveLogLocation (haul mode, upstream).

## Design
- **Text as read is the input, always.** Imports never decide by renaming. OtherStep.locationRaw / pickupLocationRaw always hold
  the text as read (log or scan). `location` / `pickupLocation` get the roster name ONLY when the resolver is sure (status
  'exact' | 'corrected' | 'user' | 'learned' | code match, confidence >= 8, no runner-up within 3); otherwise the text as read.
  (Keeps stepKey/dedupe between log and scan working for sure matches.) The resolver ALWAYS resolves from the text as read
  (locationRaw ?? location; pickupLocationRaw ?? pickupLocation), so a tag can never say "exact" because of an import rename.
  locationSnapped = location !== locationRaw.
- **One module owns matching: src/other/otherResolve.ts** exports (new ones marked +):
  resolvePlaceText(text, ctx, marker?, related?, jobTexts?) (existing), resolveStopPlace (existing; uses text as read),
  + importPlace(raw: string, ctx: ResolveCtx, opts?: { ocr?: boolean; label?: string }): { location; locationRaw; locationSnapped; match: StopPlace }
    (the sure-rule above; Neutralize targets, "<System> System" destinations, patrol coordinates pass through unresolved;
    ocr: true adds the OCR Lagrange-code fixes from fixOcrLagrangeCodes and the token rules of ocrTokenMatch as evidence)
  + resolveStartText(text, ctx): StopPlace           (typed start, log clues, map-line names: no marker, no step)
  + findBody(name, locations, system?): Location | null   (body by name: Hurston, OOC_Stanton_1_Hurston forms; used by otherWhere)
  + nearestPlace(point, locations, maxM = NEAR_MAX_M): { place: Location; meters: number } | undefined  (moved from otherNext
    nearestRosterPlace; otherNext re-exports the old name as a thin wrapper only if tests need it)
  + the Lagrange/address rules of otherLocationSnap (stripLagrangeFlavor, "X Station at microTech's L4 Lagrange point" ->
    MIC-L4 X Station, "landing pad locker in X", sub-place "… in Lorville" not Lorville) become candidate rules in the resolver.
  ResolveCtx gains nothing new except what exists (locations, useMarker, here, memory). Main-process callers pass memory from
  main/matchMemory.getMemory() (lookupMemory) and the site table main already loads (gameData.ts setSiteCodes).
- **Codes, one table: src/other/otherSiteCodes.ts** + placeForCode(code, locations): { name: string; via: 'site' | 'city' | 'lagrange' } | null
  = wiki site codes (siteByCode / tradeCodeForPanel / parentForCode) then the CITY and RR_<BODY>_L<n>/LEO rules moved from
  otherCurrentLocation (which then only parses lines and calls placeForCode). The resolver's code evidence uses placeForCode.
- **Memory everywhere:** every resolvePlaceText/resolveStartText/importPlace call passes ctx.memory (renderer:
  currentMemoryLookup() from otherMemoryStore; main: from matchMemory). The memory key is from the text as read.
- **Old copies deleted:** otherLocationSnap.ts reduced to a re-export of importPlace (or deleted with callers updated);
  findRosterLocation / findFolded / foldPlaceName / snapLocationToUex / explainPlaceLookup / travelFromStart / distanceFromStart /
  compareByDistanceFrom / rosterDistance removed or turned into one-line wrappers over the resolver (prefer removal; update
  callers/tests). OTHER_LOCATION_SNAP_CASES (30+ real log lines) move into test/replay/fixtures/stop_cases.json with the same
  expected names (or a justified, safer answer: 'unsure'/'none' instead of a wrong place; list every changed expectation).

## Agents and files
- core: src/other/otherResolve.ts, src/other/otherSiteCodes.ts, src/other/otherCurrentLocation.ts, test/replay/resolve_checks.mjs,
  test/replay/sitecodes_checks.mjs, test/replay/fixtures/stop_cases.json. Write the NEW exports first (signatures exactly as
  above) and typecheck early; others code to them.
- import: src/other/otherLocationSnap.ts, src/other/otherLog.ts, src/other/renderer/state/otherOcr.ts (+ any test that covers
  them). Log path: stepFromParse(id, parsed, locations?) keeps its signature but uses importPlace with memory
  (currentMemoryLookup when in the renderer; otherLog may run in main too: check callers, pass memory via an optional ctx arg).
- next: src/other/otherNext.ts, test/replay/next_order.mjs. resolveOrigin uses resolveStartText (+ memory via an optional
  `memory` field in its arg) and returns `match?: StopPlace` for the typed/where name; remove the legacy helpers (8, 9);
  nearestRosterPlace -> nearestPlace.
- state: src/other/renderer/state/otherJobs.ts (whereFromPlace -> resolveStartText with memory; placeSteps hasUex -> resolver;
  proof compare -> placeKey/resolver; nearestRosterPlace -> nearestPlace), src/other/renderer/state/otherDiag.ts
  (explainPlaceLookup -> the StopPlace evidence; lookups in SNAPSHOT from the resolver), marker_checks / refresh_checks /
  diag_checks if they pin removed functions.
- where: src/other/otherWhere.ts (resolveMapLine and resolveDisplayInfo take an optional `resolve?: (text) => StopPlace` and use
  findBody / nearestPlace instead of snap/placed copies), src/other/main/whereAmI.ts (passes a resolver closure with main memory
  + site codes), test/replay/where_checks.mjs.
- ui: src/other/renderer/components/OtherCaptureModal.tsx (scan confirm screen: each place shows MatchTag from importPlace's
  match, clicking opens MatchFix; a fix is saved before Confirm and the step uses it), src/other/renderer/pages/NextPage.tsx and
  src/other/renderer/components/OtherOverlay.tsx (MatchTag next to STARTING AT / the start line from resolveOrigin.match),
  src/other/renderer/pages/JobsParts.tsx (text as read shown; the matched place beside it with its tag).
- e2e-docs-guard: test/replay/replay.mjs (scenarios: a scanned job whose place OCR misread -> tag on the confirm screen, fix it
  there, the stop uses the fix; a Game.log job with a wrong-but-unique-looking name -> NOT renamed, tag shows the real status;
  typed start "S1DCO06" -> tag ≈ corrected; a learned/user entry applies to a log job, a scan job and the typed start alike),
  NEW test/replay/resolver_guard.mjs (fails when a file under src/other matches place names itself: e.g. `locations.find(`,
  `locations.filter(`, `.name.toLowerCase() ===`, `norm(l.name)` outside an allowlist: otherResolve.ts, otherSiteCodes.ts,
  otherPlaces.ts, otherGeo.ts (gateway), otherMarkers.ts (locationByZ), otherBodies.ts — each allowlist entry with its reason),
  docs: src/other/STANDALONE.md, docs/SYSTEM-MAP.md (NEW section "Name and place resolution" listing every entry point BY
  FUNCTION: text->place, code->place, position->place, special cases, with file:function and which UI shows a tag),
  docs/OTHER-MODE-AUDIT.md.
