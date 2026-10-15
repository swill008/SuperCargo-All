# Batch 17: OCR-filled jobs split into pickup and drop-off

Approved by the user 2026-10-15 ("do as recommeded and then build the new release"). Evidence: J11 (log-filled) had
2 steps; J12/J13 (OCR-filled, the game wrote no "New Objective" lines) had one combined "Collect … Deliver …" step
because the OCR path calls `mergeCollectIntoDeliver` on purpose (rule 24). The OCR read itself was complete.

1. **A**: OCR fills (auto-OCR and the manual scan window) produce separate steps exactly like the log path: a
   `pickup` step ("Collect X from A") and a `turnin` step ("Deliver X to B"), pickup first (rule 24 order). The
   game's pickup marker can then link to the pickup step. Remove the merge on the OCR path
   (`otherOcrParse.ts` parseOtherOcrText return, `otherOcr.ts` applyOcrRows); `mergeCollectIntoDeliver` goes if
   nothing else uses it.
   - Late log objectives after an OCR fill must not add duplicates: the 'objective' handler in `otherJobs.ts`
     matches an existing step without `logText` by kind + item + place (placeKey), and adopts the log text instead
     of adding a step.
2. **A**: jobs already saved with a combined step are left as they are (the combined-step display and completion
   code stays for them). No migration.
3. **A**: resolver (`otherResolve.ts`): a text "<site> in <city>" (e.g. "August Dunlow Spaceport in Orison") prefers
   the site candidate over the city candidate when the site lies in/at that city (roster parent/city or within the
   city's area), instead of a tie -> "none".

Tests: OCR text of the user's contract (main "Deliver Ammunition Crate to Mogote Aid Shelter.", indented
"Collect Ammunition Crate from August Dunlow Spaceport in Orison." wrapped over 2 lines) -> 2 rows/steps, pickup
first; manual scan window rows the same; late "New Objective" log lines after an OCR fill -> still 2 steps, no
duplicates; resolver case row in stop_cases.json (fails on 1.0.3: tie -> none); existing combined steps still
display/complete.
