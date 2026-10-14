<!-- Copy of the batch contract the lead gave the agents (CONTRACT7.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 6 contract: fix A (pickup distance), fix B (bad reads), copy buttons (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features (last commit f45af9f). Background: CONTRACT.md..CONTRACT6.md in this folder,
src/other/STANDALONE.md. Real export to read for test inputs (sanitised):
<uploaded diagnostics file>
(## SNAPSHOT jobs J82/J78, distanceTable; ## WHERE AM I HISTORY raw zone2 texts).
Rules: edit ONLY your files; no commits; no player names in code/tests/fixtures (handle = PLAYER);
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; run `npm run typecheck` before finishing
(other agents' mid-build errors are expected; report them). Final report: files, exports, results, start/end clock times.

## The case
User stands at Covalex Distribution Centre S1DC06 (Hurston). Job J82 step (combined): pickupLocation "Covalex Distribution
Center S1DCO06 on Hurston" (OCR doubled O), location "Security Compound", pickedUp false, position = the DROP-OFF marker
(Security Compound, ~4 km away). Lookup method "none" -> the row used step.position -> "≈4 km" for a pickup the user stands on,
and the header says "S1DCO06 · near Covalex S1DC06 (4 km)".

## A (agent next-fix: src/other/otherNext.ts, test/replay/next_order.mjs)
A1 findFolded: final tier after the existing exact/contains tiers: collapse runs of 2+ zeros to one zero inside tokens that
   contain a digit, on both sides ("s1dc006" == "s1dc06"); exact match on that form only; same `pick` (coords, system hint).
   Export nothing new unless useful; explainPlaceLookup should report method 'folded' for it.
A2 stepPointWithSource (and anything else that falls back to step.position for distance/near): while stepIsPickup(step), never
   use step.position (it belongs to the delivery place of a combined step). No point -> row has no distance (existing
   noDistance path, why e.g. "pickup place not found"). After pickup, the marker fallback works as today.
Tests (next_order.mjs, real names from the export): S1DCO06 resolves to the Centre S1DC06 entry with coords; J82-like step
with drop-off marker 4 km away and an unresolvable pickup name gets NO distance (not 4 km); resolvable pickup -> ≈0.3 km from a
start at Covalex; after pickedUp the marker gives ≈4 km. Must fail on the old code.

## B (agent where-fix: src/other/otherWhere.ts, test/replay/where_checks.mjs)
B1 knownSystem: unknown names return '' (not title-cased) so garbled systems ("Zone", "Zope", "Stantepl" -> check: Stantepl
   prefix rule may already map it) become null. Check every caller in the repo (grep) still behaves; report any you can't own.
B2 resolveDisplayInfo near a body: look the body up in the system pool; if not found, retry across all systems.
B3 Near a body (planet zone line / CamPos near) but step 1 fails (no body, a failed check): do NOT fall back to the SolarSystem/
   Root lines (they turn with the planet and don't match roster places); push check {item:'position', ok:false, why:'near
   <body|a body> but the body position failed: star-frame lines not used on a planet'} and return null.
   Space (not near) keeps the SolarSystem/Root path.
Tests: the real raw zone2 texts from WHERE AM I HISTORY (16:58:20 "Rappel" read -> null; 16:59:52 / 17:00:36 "Open space"
reads -> Covalex S1DC06 ~250-320 m, accuracy 10; 17:01:16 -> unchanged result). Must fail on the old code.

## C copy buttons (agent diag-copy)
Files: src/main/diagnostics.ts, src/shared/trace.ts, src/shared/channels.ts (diag block), src/preload/index.ts (diag lines),
src/main/index.ts (handler re-tie lines only), src/renderer/src/pages/SettingsPage.tsx and DebugPage.tsx (export area only),
test/replay/diag_checks.mjs.
- Main keeps the last UI export: { path, images[], combined? }.
- When images are saved, also stitch them into ONE PNG `<base>-all.png`: side by side, top-aligned, 16 px gap, black background,
  unscaled; Electron nativeImage only (toBitmap/createFromBitmap; BGRA), no new packages. Listed in IMAGES as "saved: ...-all.png
  (all pictures in one)". DiagExportResult += { combinedImage?: string }.
- IPC (invoke): diagCopyText 'diag:copyText' -> { ok: boolean; bytes?: number; error?: string } (reads the last saved .txt,
  clipboard.writeText); diagCopyImages 'diag:copyImages' -> { ok: boolean; width?: number; height?: number; error?: string }
  (clipboard.writeImage of the combined PNG). No export yet -> { ok:false, error:'no export yet' }.
  Preload: diagCopyText(), diagCopyImages().
- UI (both pages): after a successful export, buttons "COPY TEXT" and (only when images were saved) "COPY IMAGES" next to the
  result line; feedback "Text copied · 1.1 MB" / "Picture copied (3 in one)" / the error, ~4 s. The automatic text copy on
  export stays.
- Export the stitch function pure enough to test (e.g. stitchBitmaps(list of {width,height,bgra}) -> {width,height,bgra}) and add
  checks to diag_checks.mjs (sizes, gap, pixels in place).

## D (agent e2e-docs: test/replay/replay.mjs, src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md)
Scenarios (CDP + SC_WHERE_TEXT_FILE seams already in replay.mjs): (1) J82-like job with the doubled-O pickup and a drop-off
marker, start set by a display-info read at Covalex -> Next/overlay row shows ≈0.3 km (not 4 km), no "near" suffix;
(2) a garbled-system panel text near Hurston -> start is Covalex, not "Open space"; the Rappel text -> start unchanged;
(3) export with images -> diagCopyText puts the saved text on the clipboard (read in main via mainEval
require('electron').clipboard.readText()); diagCopyImages puts an image of the combined size (clipboard.readImage().getSize()).
Write them now and confirm they FAIL on the current build (`npm run build` output in out/ is the old code until the lead
rebuilds; do not rebuild while other agents edit; copy out/ aside first if you need it). Then docs. Report which scenarios
failed on the old build.
