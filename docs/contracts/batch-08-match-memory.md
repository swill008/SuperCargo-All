<!-- Copy of the batch contract the lead gave the agents (CONTRACT9.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 8 contract: match memory (learning M1-M4) + corrections (M5-M8) (user-approved). Lead owns this file.

Work in /home/user/sc-b8 ONLY (git worktree, branch b8-wip; HEAD = batch 7 commit ecff83e, not pushed yet).
node_modules is a symlink: never npm install. Background: CONTRACT8.md (+ADDENDUM) = the resolver (src/other/otherResolve.ts),
CONTRACT5.md = the planet table pattern (otherBodies.ts / main/bodies.ts / otherBodiesStore.ts) that this batch copies.
Rules: edit ONLY your files; no commits; no player names in code/tests/fixtures (handle = PLAYER);
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing (others'
mid-build errors expected; report them). Do NOT run npm run build (the lead builds). Final report: files, exports, results,
start/end clock times.

## What (user-approved)
M1 Match log: every open stop that isn't an exact match is remembered locally (userData/other-matches.json): text, chosen place,
   status, confidence, last evidence; repeats bump `seen`. Cap 500 entries (drop the oldest lastAt; never drop 'user' entries).
M2 Proof from the game: when the game logs Objective Complete for a step, if the latest position read (where.source
   'displayinfo' | 'map' | 'inventory', accuracy >= 7, within 10 min of the event time) shows where you were: chosen place
   within 1.5 km of that point (or the inventory clue names the chosen place) -> confirmed +1; else wrong +1 with where you were
   (nearest roster place name + meters, at). No read near the event time -> no proof.
M3 Learned names: a game entry with confirmed >= 2 and confirmed > wrong is evidence +4 for its place ("learned: confirmed ×N");
   wrong >= 2 on a place is −4 for that place ("the game showed this was wrong ×N").
M4 Diagnostics: `## MATCH MEMORY` section (entries + last 50 changes).
M5 Fix it on the stop: clicking a match tag (overlay, Next, Jobs) opens a small panel: evidence lines + ✓ Right (sets a 'user'
   entry for the current place) · ✗ Wrong → pick (search the merged roster, runner-up candidates first; sets a 'user' entry) ·
   Forget (only when an entry exists). Applies at once.
M6 Learned places list: Settings → OTHER MODE block, "LEARNED PLACES": table text → place, how learned ("you set it" /
   "game confirmed ×N" / "unproven" / "⚠ the game disagrees"), last used; Change (same picker), Forget; search box; filter
   (all / you set / game / disputed).
M7 Undo: every change (set, forget, proof) keeps before/after; last 50 kept; "Undo" on each change line in the list.
M8 You win, flagged when the game disagrees: a 'user' entry decides the place outright; if game proofs say wrong >= 2 for it,
   `disputed` = true and the tag/list show "⚠ the game disagrees" + where you actually were. Never overridden silently.

## Interfaces
### NEW src/other/otherMemory.ts (pure; agent mem-core)
```ts
export type MemoryOrigin = 'user' | 'game'
export interface MemoryWhere { name: string | null; meters: number | null; at: string }
export interface MemoryEntry {
  key: string                  // memoryKey(text, context)
  text: string                 // latest raw text seen
  context?: string             // generic sites only: placeKey of the place the contract names / the site parent ('' otherwise)
  place: string | null         // roster name chosen (user) or last resolved (game); null = no place
  origin: MemoryOrigin         // 'user' once the user set it; else 'game'
  confirmed: number            // game proofs that agreed with `place`
  wrong: number                // game proofs that disagreed
  wrongAt?: MemoryWhere[]      // last 3 places you actually were when it was wrong
  disputed?: boolean           // origin 'user' && wrong >= 2
  seen: number; firstAt: string; lastAt: string
  lastStatus?: string; lastConfidence?: number; lastEvidence?: string[]   // evidence texts, max 8
}
export interface MemoryChange { at: string; key: string; text: string; what: 'seen-new' | 'confirm' | 'set' | 'forget' | 'proof' | 'undo'; by: 'user' | 'game'; before: MemoryEntry | null; after: MemoryEntry | null }
export interface MemoryDoc { entries: MemoryEntry[]; changes: MemoryChange[] }   // changes newest first, max 50 (no 'seen' noise: only new entries, user actions, proofs, undo)
export const MEMORY_MAX = 500, CHANGES_MAX = 50, PROOF_WINDOW_MS = 600_000, PROOF_METERS = 1500
export function emptyMemoryDoc(): MemoryDoc
export function memoryKey(text: string, context?: string): string          // placeKey(text) + (context ? '@' + placeKey(context) : '')
export function lookupMemory(doc: MemoryDoc, key: string): MemoryEntry | undefined
export function recordSeen(doc, s: { key; text; context?; place: string | null; status; confidence; evidence: string[] }, at): MemoryDoc   // only non-exact; existing user entries keep their place
export function recordProof(doc, p: { key; text; context?; place: string | null; ok: boolean; actual: MemoryWhere }, at): MemoryDoc
export function setUserPlace(doc, p: { key; text; context?; place: string }, at): MemoryDoc          // ✓ Right / pick
export function forgetEntry(doc, key, at): MemoryDoc
export function undoChange(doc, index: number, at): MemoryDoc        // restores `before` of changes[index] (null -> remove); logs 'undo'
export function learnedPlace(e: MemoryEntry): { place: string; strength: 'user' | 'learned' } | null   // user: always; game: confirmed>=2 && confirmed>wrong
export function memoryLabel(e: MemoryEntry): string   // "you set it" | "game confirmed ×3" | "unproven" | "⚠ the game disagrees"
```
### Resolver (agent resolver-mem; src/other/otherResolve.ts)
- ResolveCtx += `memory?: (key: string) => MemoryEntry | undefined`. StopPlace += `memoryKey: string` (always set: the key for this
  stop: generic site -> memoryKey(text, site parent or ''), else memoryKey(text)) and `memory?: { origin; label; disputed?;
  wrongAt? }` when an entry was used.
- MatchStatus += 'user' (matchWord '✓ you set') and 'learned' (matchWord '✓ learned').
- user entry with a roster place that has coords: that place wins outright: status 'user', confidence 10 (disputed -> 6), evidence
  first line "you set this ✓" (or "you set this; ⚠ the game disagrees ×N"). Generic site: the user's place becomes the site
  (from 'contract'), the marker still gives the point when present.
- game entry (learnedPlace strength 'learned'): +4 to that candidate ("learned: game confirmed ×N"); if it then wins, status
  'learned' (confidence = min(10, score)). wrong >= 2 on a candidate: −4 ("the game showed this was wrong ×N").
- Existing case table must still pass with no memory. Add unit checks for each rule.
### Main (agent mem-main)
- NEW src/other/main/matchMemory.ts: load/save userData/other-matches.json (atomic write like main/bodies.ts), doc validation,
  IPC: otherMemoryGet 'otherMemory:get' (invoke -> MemoryDoc); otherMemorySeen 'otherMemory:seen' (send, array of recordSeen
  inputs); otherMemoryProof 'otherMemory:proof' (send, recordProof input); otherMemorySet 'otherMemory:set' (invoke {key,text,
  context?,place}); otherMemoryForget 'otherMemory:forget' (invoke key); otherMemoryUndo 'otherMemory:undo' (invoke index);
  each write broadcasts evtOtherMemory 'evt:other:memory' (MemoryDoc) to all windows; invoke handlers return the new doc.
  Coalesce saves (≤ 1 per second). Diagnostics: add 'MATCH MEMORY' to the setOtherDiagSource sections (entries sorted: disputed,
  user, game by lastAt; plus changes).
- Files: src/other/main/matchMemory.ts, src/other/main/register.ts, src/shared/channels.ts (Other block),
  src/preload/index.ts (Other lines: otherMemoryGet/Seen/Proof/Set/Forget/Undo, onOtherMemory).
### Renderer state (agent mem-state)
- NEW src/other/renderer/state/otherMemoryStore.ts (copy otherBodiesStore): startOtherMemory(), memoryDoc(), memoryLookup
  (key) => entry, useMemory() hook (re-render on change), useMemoryLookup() (stable function that changes identity on doc change).
  Main-window-only "seen" reporter: startMemorySeenReporter() (debounced 5 s on jobs/where/roster/memory change) runs
  listOpenStops like otherDiag does and sends non-exact stops via otherMemorySeen; dedupe key+status+place per run. Started
  where the main window starts other-mode stores (find where startOtherBodies is first called; the overlay must not report).
- src/other/otherNext.ts: ListOpenStopsOpts += `memory?: (key) => MemoryEntry | undefined`, passed into the resolver ctx (also for
  stepTravelFromStart/stepDistanceFromStart optional ctx). Nothing else changes.
- src/other/renderer/state/otherJobs.ts: M2 proof in the 'objective' (Objective Complete) case, BEFORE the takeWhere: prev =
  d.where; if prev is a read (displayinfo/map/inventory, accuracy >= 7, |e.at − prev.at| <= PROOF_WINDOW_MS) resolve the step's
  active place (resolveStopPlace with memory + merged roster + job) and send otherMemoryProof (main window only; same guard as
  reportLearned). ok = chosen point within PROOF_METERS of prev.point, or prev.name equals the chosen place (fold) for name-only.
  actual = nearest roster place to prev.point (or prev.name) + meters. Decide trace + dlog line.
- src/other/renderer/state/otherDiag.ts: pass memory into listOpenStops; SNAPSHOT gets memory counts (entries, user, learned,
  disputed).
- Tests: NEW test/replay/memory_checks.mjs (pure otherMemory: every function, caps, undo of set/forget/proof, disputed rule,
  learnedPlace thresholds) — mem-core writes it; mem-state adds proof-rule checks to next_order.mjs only if needed.
### UI (agent ui8)
- src/other/renderer/components/MatchTag.tsx: tag is a button (keyboard focusable) opening NEW MatchFix.tsx popover; statuses
  'user'/'learned' green; disputed shows "⚠ the game disagrees" in amber with wrongAt[0] ("you were at X").
- NEW src/other/renderer/components/MatchFix.tsx: popover (evidence lines; ✓ Right; ✗ Wrong → picker; Forget when entry exists;
  close on Esc / outside click). Picker: text search over the merged roster (useMergedLocations), candidates first, max 30 shown.
  Calls window.supercargo.otherMemorySet/Forget; works in the overlay window too (main process owns the file).
- NEW src/other/renderer/components/LearnedPlaces.tsx + src/other/renderer/components/settingsBlock.tsx (add the section):
  M6 table + filter + search + Change/Forget + "Recent changes" (last 50) with Undo per line.
- OtherOverlay.tsx, NextPage.tsx, JobsParts.tsx: pass `memory: useMemoryLookup()` into listOpenStops / resolveStopPlace ctx; call
  startOtherMemory() via the store's lazy start.
### E2E + docs (agent e2e-docs8)
test/replay/replay.mjs scenarios (CDP; write now, the lead builds and runs): (1) J82 pickup "S1DCO06" → click tag → ✗ Wrong →
pick "Covalex Distribution Centre S1DC06"… (use a case where the resolver says 'unsure' e.g. "Shubin Mining Facility on Lyria",
pick SAL-2) → stop shows '✓ you set' with a distance; restart app → still set (file persisted). (2) Undo in LEARNED PLACES →
back to '? not sure'. (3) Proof: a display-info read at a place, then an Objective Complete line for a stop resolved there →
confirmed 1; second job → confirmed 2 → next resolution status 'learned'. (4) Disputed: user sets place A, two completions while
reads show you at B → '⚠ the game disagrees'. (5) Export → ## MATCH MEMORY present with entries and changes. Docs:
src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md.

## ADDENDUM 2 (user-approved additions to batch 8): data source switches, OCR typo matching, OCR tune-up. NO wiki/new data source.
Same worktree /home/user/sc-b8, same Rules. The first six agents are finished; their files are now free to the owners below.

### S Data source switches (agent sources)
Today's sources: UEX (haul roster from the store + UEX cities/stations/outposts in main/uex.ts) and the bundled starmap file
data/uex/other-positions.json (main/uex.ts fillFromPositions fills UEX places' missing coords; addStarmapPlaces adds starmap-only
places). User rule: "If we use other data sources than UEX, I need the ability to select or deselect them."
- Location (src/shared/types.ts, minimal re-tie, note it in STANDALONE re-tie list) += `source?: 'uex' | 'starmap'` (where the
  place itself came from) and `coordsFrom?: 'uex' | 'starmap'` (where its x/y/z came from). main/uex.ts sets both (fillFromPositions
  -> coordsFrom 'starmap'; addStarmapPlaces -> source 'starmap'). Haul roster entries (upstream) count as source 'uex'.
- Setting `otherSourceStarmap` (workMode.ts OTHER_SETTING_DEFAULTS, default true). Off: mergeLocations (otherPlaces.ts) drops
  source 'starmap' places and strips x/y/z (and body if it came with them) from places whose coordsFrom is 'starmap'. Reads the
  setting via useStore.getState().settings (otherSetting); useMergedLocations re-computes when the setting changes.
- Settings → OTHER MODE: NEW src/other/renderer/components/DataSources.tsx section "DATA SOURCES" in settingsBlock.tsx: one row per
  source: name, what it adds ("UEX: 745 places, 610 with coordinates" / "Starmap positions (bundled game data): adds 312 places,
  fills coordinates for 128"), on/off (UEX always on, switch disabled with "base list").
- LearnedPlaces.tsx: an entry whose place isn't in the active sources shows "(place's source is off)" and the resolver ignores it.
- otherDiag.ts placeSource uses the new tags; SNAPSHOT shows enabled sources.
- Files: src/shared/types.ts (Location fields only), src/other/main/uex.ts, src/other/renderer/state/otherPlaces.ts,
  src/other/workMode.ts, src/other/renderer/settingsBlock.tsx, NEW DataSources.tsx, LearnedPlaces.tsx, src/other/renderer/state/
  otherDiag.ts. Unit checks: NEW test/replay/sources_checks.mjs (mergeLocations on/off: starmap-only places gone, filled coords
  stripped, UEX coords kept).

### T OCR typo matching (agent typo; owns src/other/otherResolve.ts, test/replay/resolve_checks.mjs, fixtures/stop_cases.json)
- Confusion-aware name score: after the placeKey-equal tier, compare a confusion-folded key (inside tokens with a digit: S<->5,
  B<->8, Z<->2, G<->6 in addition to O/0, I/l/1; in all words: rn->m, vv->w, cl->d, '|'->l) -> equal = 'corrected' +5.
- Then a weighted Damerau-Levenshtein similarity on the folded keys (confusion pairs cost 0.3, other edits 1): sim >= 0.9 and key
  length >= 8 -> +4 ("close spelling: <name>"); 0.82-0.9 -> +3. Code tokens (a digit and letters, e.g. S1DC06, CRU-L5, SAL-2) must
  be equal after confusion folding or the candidate gets no edit-distance points (S1DC06 never matches S4DC05).
- Candidate evidence names its source: "… · from starmap data" when the candidate's source/coordsFrom is 'starmap'.
- Re-check the case table rows that were 'none' from OCR misreads (CRU-LS5 Beautiful Glen Station, ARC-L dern Express Station,
  Ambitious, Dream Station at Crusader's L1 0, Deak Outpost on Yela, August Dunlow Sg Orison. Quy port in, Rayari): decide
  from the evidence whether each now resolves correctly ('corrected'/'guess') or must stay 'none'; never a wrong place. Add rows
  for each new rule. The memory rules and all existing rows must still pass.

### O OCR tune-up for WHERE AM I (agent ocr; owns src/other/main/whereAmI.ts, NEW src/other/main/ocrPrep.ts, NEW
test/replay/ocr_bench.mjs)
- Own Tesseract worker for WHERE AM I (not the shared upstream engine with psm 3): psm 6 for zone 2 (panel block), psm 7 for zone 1
  (one line); preserve_interword_spaces 1.
- Pre-process (pure JS on the nativeImage BGRA bitmap, in ocrPrep.ts): grey, invert (light text on dark -> dark on light), scale
  so text is ~30 px high (from the crop height vs the game resolution, not a fixed 3x; cap the output at ~4 Mpx), simple
  Otsu threshold. Keep diagnostics crops as today (unscaled originals) and add the pre-processed zone 2 to the IMAGES set as
  'zone2-prepped'.
- Bench: ocr_bench.mjs runs tesseract.js in node on the real crops in <session-files>/
  images/18.webp (zone 2 panel crop at 5120x2160; convert to PNG with sharp if installed, else electron-free decoding you can do;
  if impossible, report) comparing old (3x upscale, psm 3) vs new pipeline: ms and whether parseDisplayInfo gets planet zone line,
  body, CamPos, radius, altitude correct. tessdata: tesseract.js downloads eng.traineddata (network may work; cache under the
  scratchpad). Report the numbers. Must not change the SC_WHERE_TEXT_FILE seam.

### E (agent e2e-docs8b; owns test/replay/replay.mjs and the three docs)
Scenarios: sources-starmap-off (switch off -> J82 pickup S1DCO06's Centre S1DC06 coords are starmap-filled? check: if the place
loses coords the stop shows no wrong distance; DATA SOURCES shows counts; switch on -> back), typo-close-spelling (a misread from
the case table resolves through the UI with '≈ corrected'). Docs for S, T, O.

## ADDENDUM 3 (user-approved): use the Star Citizen Wiki game data (scunpacked-data) as a switchable source
Facts: the bundled data/uex/other-positions.json is ALREADY generated from scunpacked-data starmap_positions.json
(scripts/gen-other-positions.mjs). New: trade_locations.json maps internal codes to display names, e.g.
DC_Stan_Covalex_S1_S1DC06 -> "Covalex Distribution Center S1DC06", DC_Stan_Covalex_S1_S1DC06_FOB -> "Security Compound".
Samples: <scratchpad>/scdata/{starmap_positions,trade_locations}.json.
Source URLs: https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/<file>. Game data is CIG IP, fan use: credit
"Star Citizen Wiki game data (scunpacked-data)" in the DATA SOURCES row; no resale.
W1 NEW scripts/gen-site-codes.mjs -> bundled data/uex/site-codes.json: { generatedAt, sites: [{ code, name, parentCode?, parentName? }] }
   for entries with a DisplayName; parent = the longest code prefix (split on '_') whose entry's DisplayName is a real place
   (not generic: not in isGenericSite and not "Lobby"/"Exterior Zone N"/hangar-like). Keep generic children (FOB=Security Compound,
   Storehouse, ...) with their parent. Pure lookup module NEW src/other/otherSiteCodes.ts: siteByCode(code), sitesNamed(name) ->
   parents that have a site with that display name, parentForCode(code), codeFromText(text) (finds "[DC_...]" or
   "Stanton1_DistributionCentre_Covalex_S1DC06"-style codes; map the panel style to the trade style when possible).
W2 Main: NEW src/other/main/gameData.ts: load bundled site-codes.json (+ an updated copy in userData/game-data/ when present);
   "Update game data" action downloads starmap_positions.json + trade_locations.json from the URLs above (timeout, size cap 10 MB,
   validates shape), regenerates site codes + positions in userData/game-data/, main/uex.ts then prefers the userData copy of
   positions over the bundled one. IPC otherGameDataGet / otherGameDataUpdate ('otherGameData:get' / ':update') -> { sites count,
   positions count, source: 'bundled'|'downloaded', updatedAt, error? }; preload methods; register.ts wiring.
W3 Switch: the DATA SOURCES starmap row becomes "Star Citizen Wiki game data (scunpacked-data)": covers starmap positions AND site
   codes (one setting, otherSourceStarmap, keep the key), shows counts, bundled/downloaded date, an UPDATE button.
W4 Resolver: generic site + game data: if the contract parent has a site with that display name ("Covalex S1DC06 has a Security
   Compound") evidence +2 "game data: <parent> has a <site> ✓"; parent without one −2. A text carrying a code ("[DC_..._FOB]") ->
   site parent from the code exactly (evidence "game code <code> ✓", confidence 10). Off switch -> no game-data evidence.
Agent "wiki": phase 1 now (only NEW files: scripts/gen-site-codes.mjs, data/uex/site-codes.json, src/other/otherSiteCodes.ts,
src/other/main/gameData.ts, test/replay/sitecodes_checks.mjs). Phase 2 (W2 wiring in main/uex.ts/register.ts/channels/preload,
W3 in DataSources.tsx, W4 in otherResolve.ts) only after the lead says those files are free.
