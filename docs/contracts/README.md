# Batch contracts

Each Other-mode batch was planned with the user, approved, and then written down as a contract the lead
gave to the parallel agents: the user's decisions, the shared types and function names, and which agent
owns which files. These are copies, kept as the record of what each batch was meant to do. The live
behaviour spec is `src/other/STANDALONE.md` (job rules) and `docs/SYSTEM-MAP.md`; the decisions are
listed by subsystem in `docs/DECISIONS.md`.

Game ids (mission ids, zone ids) and repo owner handles are replaced with placeholders. Paths marked
`<scratchpad>` or `<session-files>` were session-only working files and are not in the repo.

| Batch | File | Topic | Commit |
|---|---|---|---|
| 1 | [batch-01-where-am-i-start-modes.md](batch-01-where-am-i-start-modes.md) | WHERE AM I (map screen, two zones), AUTO/FIXED start, location clues, multi-system and surface distances | `3492945` |
| 2 | [batch-02-whole-panel-read.md](batch-02-whole-panel-read.md) | Whole r_DisplayInfo panel read, OCR fixes a-f, hotkey recorder, accuracy 0-10 with colour scale, live position, tracked mission, AFK button | `0fcf528` |
| 3 | [batch-03-diagnostics-additions.md](batch-03-diagnostics-additions.md) | 15 diagnostics export additions (note, overlay snapshot, read history, AFK log, capture, opt-in images, ...) | `e46aba2` |
| 4 | [batch-04-generic-places-pickup-clipboard.md](batch-04-generic-places-pickup-clipboard.md) | Body-frame markers, "near" labels for generic places, zone tables per server, pickup before delivery, export copies to clipboard | `a7eb226` |
| 4b | [batch-04b-planet-table-learned-sites.md](batch-04b-planet-table-learned-sites.md) | Local planet table (radius from the panel) and learned generic sites | `a7eb226` |
| 5 | [batch-05-refresh.md](batch-05-refresh.md) | REFRESH for active jobs (markers only, watermark untouched), auto once per version, OS-user sanitiser fix | `f45af9f` |
| 6 | [batch-06-pickup-distance-bad-reads-copy.md](batch-06-pickup-distance-bad-reads-copy.md) | Pickup measured from the pickup place, reject bad position reads, COPY TEXT / COPY IMAGES | `b7d2422` |
| 7 | [batch-07-stop-place-resolver.md](batch-07-stop-place-resolver.md) | One evidence-scored stop-place resolver ("choice 2") with a match tag on every stop | `ecff83e` |
| 8 | [batch-08-match-memory.md](batch-08-match-memory.md) | Match memory (learning + corrections + undo), data source switches, OCR typo matching, OCR tune-up, Wiki game data | `adde3ba` |
| 9 | [batch-09-one-resolver.md](batch-09-one-resolver.md) | One name/place resolver for every Other-mode lookup; imports keep the text as read | `d0c0b18` |
| 10 | [batch-10-other-mode-settings-tab.md](batch-10-other-mode-settings-tab.md) | Settings tabs GENERAL / OTHER MODE with large section headings | `a0834ec` |
| 11 | [batch-11-learned-data-tab.md](batch-11-learned-data-tab.md) | LEARNED DATA main tab (Places, Sites, Planets) | `ab1edb7` |
| 12a | [batch-12a-data-folder-releases.md](batch-12a-data-folder-releases.md) | First plan: user data folder, movable folder, Setup.exe + Portable.zip releases, R1 versioning (parts superseded by 12b) | not yet committed |
| 12b | [batch-12b-final-scope.md](batch-12b-final-scope.md) | Final batch 12 scope: data folder like Gremlin, damaged-data check and "Moved for Repair", updates like Gremlin, reference data status, overlay fixes O1-O3, release notes in the workflow | not yet committed |

Earlier work (debug logging, the upstream v0.9.1 merge, the first Other-mode fix batch with options 1-10,
the replay tests, distances on the Next page and overlay) was planned in the chat without a written
contract; see `docs/DECISIONS.md` and the git log (`47cc3d0` .. `89dbd88`).

Where 12a and 12b disagree, 12b wins (it was approved later, 2026-10-14).
