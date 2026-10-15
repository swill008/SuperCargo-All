# How long things take (SuperCargo-OtherModes)

Measured times, so estimates match reality (same rules as Gremlin-Platforms' `claude/timings.md`). Add a row when a
step finishes: start and end from the clock, not a guess. Quote from the rules of thumb.

## Rules of thumb (2026-10-14, first rows)

| Kind | Rows | Quote |
|---|---|---|
| Agent fix / feature / docs | 14 | 2-6 min per agent; a batch of parallel agents ~6 min |
| Read-only study / CI log digging | 2 | 1-8 min |
| Quick tests (typecheck + all check scripts) | 2 | ~1 min |
| Targeted replay scenarios (a few) | 3 | 1-3 min |
| Full run (replay ~5 min + 8 real logs ~2 min) | 4 | ~7 min |
| CI on a push (GitHub, ubuntu) | 1 | ~10 min |
| Release run (GitHub, Windows: build Setup.exe + zip + publish) | 1 | ~4 min |

End to end, a small batch: agents (~6 min) + lead wiring and docs (~5 min) + full run (~7 min) + commit (~1 min);
with a push: + CI (~10 min, in the background); a release: + ~4 min.

| Date | Task | Kind | Estimated | Took | Notes |
|---|---|---|---|---|---|
| 2026-10-14 | Batch 12: 9 parallel agents (data folder, updater, update UI, ref data, overlay, parse/alt, release notes, e2e, docs) | agent | ~25-30 min each (budget) | 2-6 min each | 20:42-20:48 |
| 2026-10-14 | Decisions/rules/contracts record agent | docs | ~30 min | 5 min | 20:45-20:50 |
| 2026-10-14 | Check scripts (all) after build | test | — | ~1 min | 20:49 |
| 2026-10-14 | New replay scenarios (6) | test | — | ~3 min | 20:50 |
| 2026-10-14 | Full run: replay + run_all + checks | test | ~7 min | ~9 min | 20:52-21:01 |
| 2026-10-14 | Batch 12 follow-up: 3 agents (cancel, datamark, e2e) | agent | 10-15 min | 1-2 min each | 21:15-21:17 |
| 2026-10-14 | Full run (follow-up) | test | ~7 min | ~8 min | twice |
| 2026-10-14 | CI disk-full investigation (read-only agent) | research | ~15 min | 7 min | 21:36-21:43 |
| 2026-10-14 | Release run R1 1.0.0 (attempt 2) | release | ~10 min | 4 min | 21:44:49-21:48:57 |
| 2026-10-14 | CI on a push (main, 9f94c89) | ci | ~10 min | 10 min | 21:51:48-22:01:56 |
| 2026-10-14 | Release 1.0.1 files agent | agent | 10 min | <1 min | 22:07 |
| 2026-10-14 | Overlay-follows-mode e2e + 2 flaky checks made to wait (1 agent) | agent | 15 min | 3 min | 22:07-22:10 |
| 2026-10-14 | Quick tests (typecheck + all check scripts) | test | ~1 min | 1 min | 22:10-22:11 |
| 2026-10-14 | Overlay footer wrap (footer agent) | agent | 2-6 min | 1 min | 22:11-22:12 |
| 2026-10-14 | Overlay footer e2e incl. old-code proof (e2e agent) | agent | ~6 min | 2 min | 22:11-22:13 |
| 2026-10-14 | Overlay FROM row to the bottom + 24px pin (fromrow agent) | agent | 2-6 min | 1 min | 22:14-22:15 |
| 2026-10-14 | FROM row e2e incl. old-code proof (e2e agent) | agent | ~6 min | 2 min | 22:14-22:16 |
| 2026-10-14 | Port test_spec_line.py (specline agent) | agent | 2-6 min | 1 min | 22:20 |
| 2026-10-14 | Port test_program_map_covers_files.py + 41 map entries (mapcheck agent) | agent | 2-6 min | 1.5 min | 22:20-22:21 |
| 2026-10-14 | npm run test:checks (all 20 check scripts) | test | ~1 min | ~1 min | 22:22 |
| 2026-10-14 | Full run before push: replay 483 + 8 real logs + all checks | test | ~7 min | 5 min | 22:23-22:28 |
| 2026-10-14 | Problem tint: 4 screen agents + unit + docs/audit (parallel) | agent | 2-6 min | 1-2 min each | 22:41-22:42 |
| 2026-10-14 | Problem tint e2e incl. old-code proof | agent | ~6 min | 3 min | 22:41-22:44 |
| 2026-10-14 | Quick tests + 7 targeted replay scenarios | test | ~4 min | 4 min | 22:45-22:49 |
| 2026-10-14 | Location naming: panel, unit, e2e, audit, docs (parallel) | agent | 2-6 min | 1-4 min each | 22:48-22:52 |
| 2026-10-14 | Panel fix after quick tests caught 2 regressions | agent | 2-6 min | 1 min | 22:53-22:54 |
| 2026-10-14 | Quick tests + 10 targeted replay scenarios | test | ~4 min | 4 min | 22:55-22:59 |
| 2026-10-14 | Final 1.0.1 items: overlay, capture, cols, keys, audit, docs agents (parallel) | agent | 2-6 min | 1-3 min each | 23:02-23:06 |
| 2026-10-14 | e2e for all final items incl. old-code proofs (one agent, staggered) | agent | ~6 min | 10 min | 23:02-23:12 |
| 2026-10-14 | Final full run: typecheck, checks, replay 529, 8 real logs | test | ~7 min | 6 min | 23:13-23:19 |
| 2026-10-14 | 3 CI-timing tests made to wait (shared-by, init-once, start-mode-auto-fixed; lead) | agent | 2-6 min | 2 min | 23:39-23:41 |
| 2026-10-14 | OCR timing analysis: 4 parallel read-only agents (chain, history, bench, contention) | study | rough guess 10-15 min | 4-7 min each | 23:58-00:04 |
| 2026-10-15 | Full run before push of e2285c2 (529 replay, 8 real logs) | test | ~7 min | 6 min | 00:03-00:09 |
| 2026-10-15 | Batch 13 single reader (dropped later): 6 parallel agents (reader, where, hold, afk, e2e, docs) | agent | 2-6 min | 2-3 min each | 00:46-00:49 |
| 2026-10-15 | Full run (batch 13 single reader, 536 replay, 8 real logs) | test | ~7 min | 6 min | 00:53-00:59 |
| 2026-10-15 | Review agents: retrace, audit, old-fail, memory (read-only / scratch) | study | 1-8 min | 1-3 min each | 00:58-01:00 |
| 2026-10-15 | Two-reader rework (dropped): 3 agents (where2, e2e, docs) | agent | 2-6 min | 1-2 min each | 01:06-01:08 |
| 2026-10-15 | AFK-only: reset docs/code to 1.0.1 + quick tests + 4 targeted scenarios (lead) | test | ~1 + 1-3 min | 1 min | 01:09-01:10 |
| 2026-10-15 | Full run on aaf01ca before push (530 pass, 1 fail update-window "check by hand" button wait; passed alone on re-run) | test | ~7 min | 8 min | 09:22-09:30 |
| 2026-10-15 | Batch 14 zones share reader: 2 agents (where2, docs) | agent | 2-6 min | 1-2 min each | 09:23-09:24 |
| 2026-10-15 | Batch 14 quick tests + 13 WHERE/AFK scenarios (lead) | test | ~1 + 1-3 min | 2 min | 09:31-09:33 |
| 2026-10-15 | Full run on b15bf55 (release 1.0.2) before push: 531 pass, 0 fail, 8 real logs | test | ~7 min | 7 min | 09:50-09:57 |
| 2026-10-15 | Batch 15 one reader: 5 build agents (reader, where, settings, e2e, docs) + ci-digest | agent | 2-6 min | 1-6 min each | 10:16-10:22 |
| 2026-10-15 | Batch 15 gold proof (real reader, 11 reads) + re-trace (read-only) | study | 1-8 min | 3 min each | 10:21-10:24 |
| 2026-10-15 | Full run batch 15 (538 pass, 0 fail, 8 real logs) | test | ~7 min | 7 min | 10:25-10:32 |
| 2026-10-15 | Batch 16 delete & block: 7 agents (memory, bodies, blocked, page, fix, e2e, docs) + 4 fix-ups | agent | 2-6 min | 1-5 min each | 10:34-10:45 |
| 2026-10-15 | Batch 17 OCR split: 4 agents (ocrsplit, resolver, e2e, docs) + marker fix-up; study + re-traces | agent | 2-6 min | 1-7 min each | 10:46-11:01 |
| 2026-10-15 | Full run 1.0.4 (587 pass, 0 fail, 8 real logs) | test | ~7 min | 6 min | 11:02-11:08 |
