# Batch 15: one Tesseract reader for all OCR

Approved by the user 2026-10-15 ("ok, approved, build it"; then "test and push it, then release it"). Engine:
Tesseract ("we will use tesseract"). Answers:

1. **C**: contract first. A contract job arriving while a zone job runs: the zone job is thrown away
   (`ReaderTrashedError`), the worker is terminated and a fresh one starts (about 0.13-0.29 s); queued zone jobs
   wait behind the contract job (contract jobs always go before waiting zone jobs; FIFO within a kind).
2. **A**: a WHERE AM I press during a contract read waits, then reads (a second WHERE AM I press while one WHERE AM I
   run is going still returns `busy`, as today).
3. **No backup reader** ("lets change 3, and not use a fallback ocr"). A failed load fails that job (usual failure
   message: contract "tesseract engine is unavailable", WHERE AM I "couldn't read the map, try again"); the next job
   tries to load again (the load error is not permanent; one load at a time).
4. **A**: the reader closes on quit (`will-quit` -> `disposeReader()`).
5. **Time limit**: setting `ocrTimeLimitSec`, default 10, 5-30 (missing/invalid -> 10, clamp). A job running longer
   than the limit (timed from when it starts on the worker; the worker LOAD is not counted, a first-run tessdata
   download can be slow) is stopped: worker terminated, job rejects with `ReaderTimeoutError`, next job gets a fresh
   worker. Log `ocr reader time limit hit` with job and ms.
6. A WHERE AM I run you started (why button / hotkey / calibrate) whose zone read was trashed for a contract runs
   again (whole run, fresh screenshot) once no contract job is running or queued, **at most 5 re-runs**; trashed a
   6th time it fails with WHERE_FAIL_MESSAGE. A trashed live run is dropped silently: not broadcast, not recorded as a
   failure, `live.skipped++`, `failsInRow` unchanged.
7. **B**: no hold on accept; the zone job is trashed when the contract job reaches the reader.
8. **A**: Settings -> GENERAL, OCR section (next to "Capture delay"): "OCR time limit (seconds)", 5-30, default 10,
   hint "A read that takes longer is stopped and the reader restarts."

## Before (1.0.2)

Two readers: contract (`TesseractEngine`, own worker, psm 3, keep spaces, recognize with `{blocks:true}`) and WHERE AM
I's own worker (zone 2: prepForOcr + psm 6 + Sauvola; zone 1: 2x upscale + psm 3 + threshold 0, `zoneParams()` in
`ocrPrep.ts`), with a `TesseractEngine` fallback when that worker fails. Neither closed on quit. No time limit.

## After

### `src/other/main/ocrReader.ts` (new; owner: reader)

Start from the saved batch-13 version
(`/tmp/claude-0/-home-user/e2999f0c-d8e9-52fa-836a-4d030be0719d/scratchpad/batch13-single-reader/all.patch`, file
`src/other/main/ocrReader.ts`), then: remove holds (`holdForContract`, `contractHeld` holds part); keep contract-first
`next()`, `trashRunningZone` (now triggered only by a contract job arriving), terminate-before-create; clear the load
error so the next job retries; add the time limit.

```ts
export type ReaderJob = 'contract' | 'zone1' | 'zone2'
export const READER_PROFILES: Record<ReaderJob, Record<string, string>> // contract {psm '3', spaces '1', threshold '0'};
  // zone1 = zoneParams(1), zone2 = zoneParams(2) from ./ocrPrep (one place for the zone values)
export class ReaderTrashedError extends Error {}   // name 'ReaderTrashedError'
export class ReaderTimeoutError extends Error {}   // name 'ReaderTimeoutError'
export function readerRecognize(png: Buffer, job: ReaderJob): Promise<ReaderData> // contract -> {blocks:true} output
export function contractPending(): boolean  // a contract job is running or queued
export function readerBusy(): boolean       // any job running or queued
export function readerAvailable(): Promise<boolean>
export function readerAssetsReady(): Promise<boolean>
export function disposeReader(): Promise<void>
export function setReaderTimeLimit(getSec: () => unknown): void // read per job; missing/invalid -> 10; clamp 5-30
export function readerStats(): ReaderStats  // started, alive, restarts, trashed, timeouts, switches, lastSwitchMs
export function createReaderCore(deps: { createWorker; log?; timeLimitMs?: () => number; now?; setTimer? }) // test seam
```
At most one worker alive at any time. Full profile applied when the job's profile differs from the last applied
(after a restart nothing is applied). Logs: `ocr reader ready ms`, `ocr reader trashed for contract`,
`ocr reader settings switch`, `ocr reader time limit hit`; load failure as 1.0.1 (`console.error` + `logger.error
'tesseract load failed'`).

### `src/main/ocr/tesseractEngine.ts` (upstream, minimal; owner: reader)

Adapter: `recognize` -> `readerRecognize(png,'contract')`, blocks->words mapping unchanged; on failure with
`!readerAvailable()` throw `'tesseract engine is unavailable'`; a `ReaderTimeoutError` -> throw `'OCR time limit
reached'`; `isAvailable` -> `readerAvailable()`; `assetsReady` -> `readerAssetsReady()`; `dispose()` no-op (shared).

### `src/other/main/whereAmI.ts`, `src/other/main/ocrPrep.ts`, `src/other/main/register.ts` (owner: where)

- whereAmI: no own worker, no fallback, no `TesseractEngine` import. Zone 2: prepForOcr -> `readerRecognize(png,'zone2')`;
  zone 1: `toUpscaledPng(cropped,2)` -> `readerRecognize(png,'zone1')`. `busy` unchanged. Trash handling per answer 6
  (wait until `!contractPending()` before a re-run, poll 100 ms). Timeout -> that zone read fails like any recognize
  error. `runLiveWhere` also skips (skipped++) when `readerBusy()`.
- ocrPrep: keep `ZONE_PARAMS`/`zoneParams` (imported by ocrReader), bench exports unchanged.
- register.ts: `setReaderTimeLimit(() => getSettings().ocrTimeLimitSec)`; `void disposeReader()` in the existing
  `will-quit`.

### Settings (lead did types + defaults; owner of the UI row: settings)

`AppSettings.ocrTimeLimitSec` (src/shared/types.ts), defaults 10 in src/main/store.ts and
src/renderer/src/state/store.ts (done by the lead). Row in `src/renderer/src/pages/SettingsPage.tsx` GENERAL OCR
section under "Capture delay": a number input or slider 5-30 step 1, shows "N s", hint as in answer 8. An old
settings file without the key shows 10.

## Tests

- `test/replay/reader_checks.mjs` (reader): one worker max; profiles in full; contract before waiting zones; contract
  arriving trashes a running zone job (restart, contract on a fresh worker, queued zones wait then run); load failure
  then retry succeeds; time limit stops a hung job (fake timer), next job on a fresh worker, a job under the limit is
  untouched, missing/invalid limit -> 10, clamp 5/30; dispose leaves 0.
- `test/replay/zonereader_checks.mjs` (where): updated to the shared reader (zones via readerRecognize, no
  TesseractEngine / tesseract.js in whereAmI.ts); a pure re-run helper (e.g. in a small module) proving 5 re-runs max,
  live trash silent.
- `test/replay/replay.mjs` (e2e): the GENERAL tab shows "OCR time limit" with 10 s by default and saves a new value;
  existing where/afk/diag/settings scenarios still pass.
- Gold proof (staggered, scratch only): gold zone pictures + the contract picture through one real reader in mixed
  orders give text identical to today's reads; trash path and time limit on a real worker.
