# SuperCargo-OtherModes to-do

Open items for this app. Each one: what, why, how, and what it depends on.

## Only if we ever stop using the original author's reference data

**Decided (user, 2026-10-14).** The app keeps downloading the reference data from the original SuperCargo author's repo
(`AquatikJustice/SuperCargo`, `main`, `data/uex`), checked by its `hashes.json`. The update window shows each file's state
(rule 92 in `src/other/STANDALONE.md`). Nothing to do unless that source goes away or stops being kept current.

**What it would take.** The five reference data files (`data/uex/ships.json`, `locations.json`, `commodities.json`,
`grid-faces.json`, `contract-overrides.json`, plus `hashes.json`) would have to be kept current in our own repo
(swill008/SuperCargo-All) after game patches, and `RAW_BASE` in `src/main/dataSync.ts` pointed there.

**How the original author does it** (same tools are in this repo):
- `ships.json`, `locations.json`, `commodities.json`: `npm run gen:uex` (`scripts/gen-uex-snapshots.mjs`). Pulls the
  UEX API 2.0 (needs a UEX API token: `UEX_TOKEN` env var) plus Star Citizen Wiki game data for coordinates; keeps
  hand-added ships UEX doesn't list yet; rewrites `hashes.json`.
- `grid-faces.json`: drawn by hand in the app's grid markup tool (developer mode watches the working-tree file live).
- `contract-overrides.json`: built from box-size corrections users report from the app (`src/main/boxReports.ts`).
- Commit the changed files and `hashes.json` to the branch the app downloads from; apps pick them up at the next check.

Added 2026-10-14 (user); narrowed 2026-10-14 (contract 14).

## Zone 1 text on the shared WHERE AM I reader: compare with the old reader

**What.** Batch 14 moved zone 1 (the map's bottom line) onto the WHERE AM I worker with its 1.0.1 settings. Compare the
zone 1 text the old reader and the new one give on the user's real zone 1 picture.
**Depends on.** A diagnostics export with images from the user (it keeps the zone 1 crop). Then run both paths on that
crop; any difference goes to the user before a change.
**Status.** Waiting for the export (recommendation A, user 2026-10-15).

## Tesseract console noise in WHERE AM I (to confirm first)

**What.** The dev console prints "Estimating resolution as N" for every read and "Image too small to scale!! (1x36 vs
min width of 3)" / "Line cannot be recognized!!" in bursts. The second pair means Tesseract found a 1-2 px wide,
36 px tall stroke in a crop (most likely a HUD panel border at the crop edge) and tried to read it as a text line.
**Next step.** A diagnostics export taken while it prints (it saves the zone 1 and 2 crops) to see the stroke. Then:
trim thin edge strokes before reading, or tighten the zone; and give Tesseract a fixed resolution (silences the first
line; check with the OCR benchmark before and after, since it can change what is read).
**Status.** Discussed 2026-10-14, not approved yet.

## Supabase "Node.js 20 and below are deprecated" warning

Printed by @supabase/supabase-js (usage stats, crew sharing) because Electron 33 runs Node 20. Harmless today; goes away
with an Electron version that runs Node 22. The Electron upgrade is NOT DOING for now (docs/DECISIONS.md section 1).

