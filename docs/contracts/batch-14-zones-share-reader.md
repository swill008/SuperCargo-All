# Batch 14 contract: zones 1 and 2 share the WHERE AM I reader. User-approved 2026-10-15.

User: "go ahead and code, you are approved on your recommendations"; to "could zone 1 and 2 be combined?": "I meant 1"
(both zones share one reader). Supersedes in part the batch 13 "NOT DOING: fewer OCR readers" decision.

**Before.** Three tesseract readers: the contract reader (upstream `TesseractEngine`); the WHERE AM I own worker for
zone 2 (page mode 6, interword spaces, Sauvola `thresholding_method` 2, after `ocrPrep`); a second `TesseractEngine`
inside `whereAmI.ts` for zone 1 (page mode 3, crop upscaled 2×).

**After.** Two readers. The WHERE AM I own worker reads both zones and sets the zone's full parameter set before each
read: zone 1 page mode 3, interword spaces, default threshold 0, crop upscaled 2×, no prep (its 1.0.1 settings); zone 2
unchanged. The settings live in `src/other/main/ocrPrep.ts`. The third reader is not created.

**Unchanged.** Contract reader; zone order (zone 2 first, zone 1 if zone 2 gives nothing); a second WHERE AM I run while
busy returns busy; live reads read zone 2 only; calibrator TEST; diagnostics pictures; readers not closed on quit.

**Fallback (recommendation A).** If the own worker fails to load, both zones use the `TesseractEngine` path as in 1.0.1.

**Proof.** Same zone 1 text on the user's real picture: pending an export with images (docs/TODO.md). Memory, measured
2026-10-15 (Electron 33): one warmed reader ~115-128 MB, so about 115 MB less once zone 1 has been read in a session.

**Files.** `src/other/main/whereAmI.ts`, `src/other/main/ocrPrep.ts`, new `test/replay/zonereader_checks.mjs`; docs:
STANDALONE rule 56, DECISIONS section 4, SYSTEM-MAP, TODO, `release-notes/1.0.2.md`.
