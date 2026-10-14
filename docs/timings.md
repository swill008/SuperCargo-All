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
