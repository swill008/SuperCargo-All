<!-- Copy of the batch contract the lead gave the agents (CONTRACT8.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 7 contract: one stop-place resolver ("choice 2", user-approved). Lead owns this file.

Work in /home/user/sc-choice2 (git worktree, branch choice2-wip; its HEAD = f45af9f + batch 6 as a local WIP commit).
NOT /home/user/sc-features (batch 6 is being tested there). node_modules is a symlink: never npm install.
Background: CONTRACT.md..CONTRACT7.md in this folder, src/other/STANDALONE.md. Real exports (sanitised) for cases:
<uploaded diagnostics file> (## SNAPSHOT distanceTable rows
carry raw place text, lookup, marker position, start).
Rules: edit ONLY your files; no commits; no player names in code/tests/fixtures (handle = PLAYER);
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing (others'
mid-build errors are expected; report them). Final report: files, exports, results, start/end clock times.

## Why
A stop's place is found by a chain of rules (exact, contains, O/0 fold, zero fold, marker fallback, nearest-place body,
pickup exception). Each fix adds a link; links interact (the pickup got the drop-off's 4 km). Replace the chain with ONE
resolver that weighs evidence and returns one answer per stop that every screen, the route sort and diagnostics read.

## Principles
1. The game's own data first: the objective's marker (step.position) is ground truth for position. The text names the stop.
2. Evidence adds up; no special cases. A candidate wins only when it clearly beats the runner-up; otherwise "unsure".
3. Real cases as a table (fixtures/stop_cases.json): every change must pass the whole table; a new problem = a new row.

## Interface: NEW src/other/otherResolve.ts (pure, no React/store; agent resolve-core)
```ts
export type MatchStatus = 'exact' | 'corrected' | 'marker' | 'guess' | 'mismatch' | 'unsure' | 'none'
export interface Evidence { kind: 'name' | 'body' | 'system' | 'marker' | 'here'; ok: boolean; points: number; text: string }
export interface Candidate { name: string; score: number; hasCoords: boolean; system?: string | null; body?: string | null }
export interface StopPlace {
  text: string                 // the active place text (stepActivePlace)
  label: string                // what to show: roster name, or text (+ " · near X (d)" is the UI's job via `near`)
  match?: Location             // chosen roster place (with coords) when one won
  point?: GeoPoint             // position to measure to (roster coords, or marker point with body/system from nearest place)
  source: 'roster' | 'marker' | null
  status: MatchStatus
  confidence: number           // 0-10 (same scale/colours as WHERE AM I accuracy)
  evidence: Evidence[]         // in the order weighed
  candidates: Candidate[]      // top 5 by score
  near?: { name: string; meters: number }   // marker points only: nearest roster place within NEAR_MAX_M (25 km)
}
export interface ResolveCtx {
  locations: Location[]        // merged roster
  useMarker: boolean           // otherMarkerDistance setting
  here?: GeoPoint              // start point when it came from a read (not typed), for 'here' evidence
}
export function placeKey(s: string): string          // the ONE normaliser (see below)
export function resolveStopPlace(step: OtherStep, ctx: ResolveCtx): StopPlace
export function resolvePlaceText(text: string, ctx: ResolveCtx, marker?: GeoPoint): StopPlace  // same, no step
export function matchWord(status: MatchStatus): string   // '✓ exact' | '≈ corrected' | '📍 game marker' | '? guess' | '⚠ mismatch' | '? not sure' | '✗ not found'
export const NEAR_MAX_M = 25_000  (move from otherNext; otherNext re-exports it)
```
Marker for the active place: step.position belongs to the step's own objective place (step.location). While
stepIsPickup(step) (pickup of a combined step not yet collected) there is NO marker for the active place.

placeKey: lower case; strip trailing "(...)"; split address hints with splitLogAddress (body/system hints kept separately,
e.g. "... on Hurston" -> body hint Hurston); words only; centre->center; inside tokens with a digit: o->0, i/l->1, runs of
0 collapsed to one 0. (Replaces foldPlaceName/foldZeros; otherNext may keep foldPlaceName as a thin wrapper if used.)

Scoring per roster candidate (two spellings of one place = same placeKey -> one candidate, the one with coords):
- name: raw text equals roster name (case-insensitive) +6 'exact'; placeKey equal +5 'corrected'; whole-word containment
  either way (key >= 4 chars) +3; shared distinctive token (has a digit, >= 4 chars) +2. No name points -> not a candidate.
- body hint: candidate.body (or candidate is the body) equals hint +2; differs -6.  system hint: equal +1; differs -6.
- marker (ctx.useMarker, marker exists): candidate within 2 km of marker +4; 2-10 km 0; > 10 km -5.
- here (ctx.here): candidate within 1 km of here +2 ("you are here").
Decision:
- winner = top candidate with coords; accept when score >= 5 AND (no runner-up OR top - second >= 3).
  status: 'exact' if name was exact else 'corrected' if key-equal else 'guess'. confidence = min(10, score), minus 2 for 'guess'.
  If a marker exists and the winner is > 10 km from it: status 'mismatch', point = marker point, confidence 4, label = text.
- no winner, marker exists: point = marker (body/system from nearest roster place within 25 km; that place = `near`),
  status 'marker', confidence 8; when 2+ candidates scored >= 5 but none won, status stays 'marker' (marker decides).
- no winner, no marker: candidates scored >= 5 but tied -> 'unsure' (no point, confidence 2); else 'none' (confidence 0).
Evidence texts are short and human ("name exact: HDMS-Hadley", "contract says Hurston ✓", "game marker 0.3 km away ✓",
"game marker 14 km away ✗", "you are here ✓", "runner-up Covalex S4DC05 (score 4)").

## Agents and files
- resolve-core: NEW src/other/otherResolve.ts, NEW test/replay/resolve_checks.mjs (esbuild bundle like next_order.mjs, uses
  data/uex/other-positions.json places + the haul roster fixture if next_order uses one), NEW test/replay/fixtures/stop_cases.json.
  Case table: harvest every distinct stop text from the 6 exports (distanceTable rows: raw text, marker position if any, start
  point) plus J74 Security Compound and J82 cases; each row { text, step kind/pickup, marker?, here?, expect: { status, name? ,
  maxMeters? } }. Decide expected answers from the game facts in the exports (log place codes, markers); mark rows you can't
  decide "expect": null with a note (reported, not tested). Unit checks for every scoring rule + the decision rules.
- next-wire: src/other/otherNext.ts, test/replay/next_order.mjs. listOpenStops / stepPoint / stepTravelFromStart /
  stepDistanceFromStart / compareStepsFrom / routeOrder use resolveStopPlace (one call per step per listOpenStops run; pass
  here = opts.origin when the origin kind isn't typed — add `originIsRead?: boolean` to ListOpenStopsOpts). OpenStopRow +=
  `match: StopPlace`; distanceSource derives from match.source ('roster' -> 'uex'); near = match.near; noDistanceWhy 'not-in-uex'
  when no point. Remove stepPointWithSource/withNearBody/findFolded's chain from the stop path (findRosterLocation stays for
  typed starts and other callers, but should use placeKey). explainPlaceLookup may stay as a wrapper over resolvePlaceText.
  StopGroup += match (first row's). Keep every other export's signature. Update next_order tests that pinned old internals;
  keep the batch 6 J82 checks passing (they must still hold).
- state-diag: src/other/renderer/state/otherJobs.ts (placeSteps: store the marker position for EVERY step whose objective has a
  marker, not only steps without a UEX place — the marker is evidence now; reportLearned only when match.status is 'marker'),
  src/other/otherJob.ts (position doc comment), src/other/renderer/state/otherDiag.ts (distanceTable rows: `match` = the row's
  StopPlace minus Location bulk (name/coords only); new top-level `matches`: every open stop whose status isn't 'exact' with text,
  status, confidence, evidence, candidates; noDistanceWhy uses match), src/main/diagnostics.ts (a `## MATCHES` section right
  after SNAPSHOT printing snapshot.other.matches as JSON; "(all exact)" when empty), test/replay/diag_checks.mjs if it pins these.
- ui: NEW src/other/renderer/components/MatchTag.tsx (small tag: matchWord + colour from confidence using the same gradient as
  AccuracyMeter/AccTag; title tooltip = evidence lines), src/other/renderer/components/OtherOverlay.tsx (tag after the stop place
  in the header; label from match.label + near), src/other/renderer/pages/NextPage.tsx (tag on each row/group place; 'mismatch'
  and 'unsure' rows show the candidates line "not sure: A or B?"), src/other/renderer/pages/JobsParts.tsx (tag beside step place).
  Only exact/marker look normal; others amber/red by confidence.
- e2e-docs: test/replay/replay.mjs (scenarios: J82 pickup -> tag '≈ corrected' + ≈0.3 km; J74 Security Compound -> '📍 game
  marker' near HDPC-Cassillo; a look-alike name on another body -> rejected/'✗ not found' (no wrong distance); two equal
  candidates -> '? not sure' with no distance; export -> ## MATCHES lists the non-exact stops), src/other/STANDALONE.md,
  docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md. Write scenarios now; run them only when the lead says the build is ready
  (don't run npm run build yourself; other agents are editing).

## ADDENDUM (user, mid-build): generic sites belong to the contract's named place
User: "the contract does say Security Compound, but the actual location is Covalex Distribution Center S1DC06 on Hurston...
UEX would have Covalex S1DC06, not Security Compound." Generic site names (Security Compound, Storehouse, ...) are not UEX places;
the stop belongs to the named UEX place the contract mentions. Rules (resolve-core implements, others display):
- `site?: { name: string; meters: number | null; from: 'contract' | 'marker' }` on StopPlace (keep `near` = same object when
  from 'marker' for compatibility). When the active text gets no name candidate (a generic site), look for the parent place:
  1. 'contract': a roster place named elsewhere in the same step/job text (step.label, pickupLocation, other steps' places of the
     same job; resolved with the same scoring, must win clearly) whose position is within 25 km of the marker (or no marker).
  2. 'marker': else the nearest roster place within 25 km of the marker (today's `near`).
- Position: the game marker when there is one (status 'marker', conf 8; site meters = marker -> parent distance). No marker but a
  contract parent: point = parent's coords, status 'guess', confidence 5, evidence "no game marker: using Covalex S1DC06, named in
  the contract". Never a different place's distance.
- Label (UI): "Security Compound · at Covalex Distribution Centre S1DC06" (+ " (4 km)" when site.meters > 1 km and from a marker).
  Route grouping may group a site with its parent when within 1 km.
- Case rows: J82 drop-off "Security Compound" -> site Covalex S1DC06 from 'contract'; J74 -> site HDPC-Cassillo from 'marker'
  (contract names HDPC-Farnesway for the pickup, which is NOT within 25 km of the marker, so it is not the parent).
