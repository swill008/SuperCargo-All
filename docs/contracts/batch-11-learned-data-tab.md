<!-- Copy of the batch contract the lead gave the agents (CONTRACT12.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 11 contract: main tab LEARNED DATA (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features (HEAD a0834ec). Rules: edit ONLY your files; no commits; no player names;
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing.
Do NOT run npm run build (lead builds/tests at the end). Final report: files, exports, results, start/end clock times.

## Approved
Bottom menu in Other mode: NEXT | JOBS | HISTORY | LEARNED DATA | SETTINGS (label exactly "LEARNED DATA", view id 'learned').
Only in Other mode. LEARNED PLACES leaves Settings → OTHER MODE (Places & Matching keeps Data Sources, plus one line:
"Learned places are on the LEARNED DATA tab." with a button that opens it). Data Sources stays in Settings.
Page sections (large headings like the OTHER MODE settings page: 20px display font, accent, rule; one-line description):
1 "Places": S1 summary bar "N you set · N learned · N unproven · N ⚠ disputed" (each number a filter button);
  S2 "Needs your eye" first: current open stops (listOpenStops like otherMemoryStore.collectSeen does, with memory) whose
  status is unsure / guess / mismatch / none, each row: stop text, job ref, MatchTag (click opens MatchFix as everywhere);
  S3 disputed entries pinned on top of the table: "you were at X (d)" + buttons KEEP MINE (keeps the user's place and clears the
  dispute: wrong=0, wrongAt=[], disputed=false) and USE WHERE I WAS (sets a user entry to wrongAt[0].name);
  S4 the table: text as read → place (planet · system via formatPlaceWithBodySystem), how learned (memoryLabel), times seen,
  last used; sortable by column (click header); search + filter (all / you set / game / disputed / unproven); CHANGE / FORGET;
  then RECENT CHANGES with UNDO (as today).
2 "Sites": learned generic sites from the planet table doc (useBodies().learned): name · at <near> (meters) · body · seen ·
  last seen. Read-only.
3 "Planets": useBodies().bodies: name, system, radius (km, "exact (panel)" or "estimated"), seen, last seen. Read-only.
S7: MatchFix (the stop fix panel) gets a link "Open in Learned Data" → setView('learned') and the page scrolls to / highlights that
entry (match.memoryKey) when it exists, else to "Needs your eye".

## Interfaces
- otherMemory.ts: SetInput += `reset?: boolean` (setUserPlace: when true, wrong=0, wrongAt=[], disputed=false, confirmed kept;
  change logged as 'set' with before/after so UNDO works). main/matchMemory.ts validation passes `reset` through. Preload/IPC
  unchanged (otherMemorySet already takes SetInput).
- NEW src/other/renderer/state/learnedFocus.ts: `focusLearned(key?: string): void` (sets pending key + setView('learned')),
  `useLearnedFocus(): string | null` and `clearLearnedFocus(): void`.
- store.ts ViewId += 'learned' (upstream re-tie, one word); BottomNav OTHER_NAV += { id: 'learned', label: 'LEARNED DATA' } before
  SETTINGS; mountApp.tsx OtherPages: view 'learned' → <LearnedDataPage/>.

## Agents and files
- nav: src/renderer/src/state/store.ts (ViewId only), src/renderer/src/components/BottomNav.tsx (OTHER_NAV only),
  src/other/renderer/mountApp.tsx, src/other/renderer/OtherSettingsPage.tsx (remove LearnedPlaces, add the line + button).
- page: NEW src/other/renderer/pages/LearnedDataPage.tsx, src/other/renderer/components/LearnedPlaces.tsx (S1, S3, S4 inside it
  or split into new components under components/), NEW src/other/renderer/state/learnedFocus.ts, src/other/renderer/components/
  MatchFix.tsx (S7 link only).
- memory: src/other/otherMemory.ts, src/other/main/matchMemory.ts, test/replay/memory_checks.mjs (reset checks incl. undo).
- e2e-docs: test/replay/replay.mjs (fix helpers that open LEARNED PLACES via Settings: now the LEARNED DATA tab; new scenario
  'learned-data-tab': tab in the bottom menu only in Other mode; Settings OTHER MODE has no learned list but the link opens the tab;
  summary counts match other-matches.json; a guess stop appears in Needs your eye and is fixed there; disputed entry: KEEP MINE
  clears it, USE WHERE I WAS sets the place; sort by a column; Sites and Planets show data from other-bodies.json; MatchFix
  "Open in Learned Data" lands on the entry), src/other/STANDALONE.md (re-tie: ViewId, BottomNav), docs/SYSTEM-MAP.md,
  docs/OTHER-MODE-AUDIT.md.
