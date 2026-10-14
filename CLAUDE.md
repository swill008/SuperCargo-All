# CLAUDE.md

Working rules for this repo (SuperCargo-OtherModes: the SuperCargo fork with Other mode), set by the user.
Read these before doing anything. The user's decisions about the program are in `docs/DECISIONS.md`.

## Where things are

- `docs/SYSTEM-MAP.md`: what every part of the program does, its files and IPC channels.
- `src/other/STANDALONE.md`: the Other-mode spec (numbered job rules) and the list of re-tie points into
  upstream code. Change a rule only with the user.
- `docs/DECISIONS.md`: every user decision by subsystem, with dates and the user's words.
- `docs/contracts/`: the approved contract of each batch (index in its README).
- `docs/TODO.md`: open to-dos. `docs/OTHER-MODE-AUDIT.md`, `docs/AUDIT.md`: the code audits.
- `release-notes/README.md`: release notes rule and release steps.
- Other-mode code lives in `src/other/`; edits to upstream files stay minimal and are listed in STANDALONE.md,
  so upstream SuperCargo can still be merged.

## Plan, ask, then build

1. **Plan first.** For any change, give the plan with options, your recommendation and the effort of each.
   There is no timing table for this repo: label every figure "rough guess".
2. **Build only after an explicit go** ("approved", "code it", "go", "do it"). A question, "I like that" or
   "let's keep planning" is not a go. The user has stopped unasked coding more than once
   ("why are you coding? i never told you do so"; "I didnt say go..."). While waiting, don't build ahead.
3. **Never change program behaviour without asking the user first** (user, 2026-10-14). That includes
   "improvements" found in review: report them as questions, don't apply them. If a contract is unclear or
   would change behaviour, stop and ask.
4. **Ask in plain language with full context.** Say what the thing is, where the user sees it and what each
   answer would do. The user: "use better language to ask these questions. I dont even have context".
   Number the questions and keep them short; offer a recommended answer.
5. **Answer what was asked.** When the user asks for a list or a comparison "nothing else", give only that.
6. When the user corrects a fact about the game (how contracts end, quits, crashes, sharing), take it as the
   spec, write it into STANDALONE.md / DECISIONS.md, and don't argue it back.
7. Record every new user decision in `docs/DECISIONS.md` in the same batch (superseded ones stay, marked).

## Privacy

- **Never put player names, handles, org names, mission ids, player ids or any personal data** in code,
  tests, fixtures, docs, commit messages or release notes. Game logs and exports contain them: use the
  sanitiser (`src/main/sanitize.ts`: handle -> PLAYER, other players -> OWNER-n), placeholders, or leave it out.
- Fixtures from real logs are made with `test/replay/make_fixture.py` (cleaned). Screenshots and OCR pictures
  can't be cleaned: never commit them.
- No email addresses or OS user names in the repo.

## Agents

- Split work into parallel agents whenever the files allow it; the user wants more agents, not fewer
  ("can you use more agents? why so little?"). The cloud has no PC limit; the real limit is one owner per file.
- Before starting agents, show the split table, then a "Left out:" line:

  | Agent | Files | Job | Why parallel / why one |
  |---|---|---|---|

- Write the shared contract first (types, function names, IPC channels, file owners); keep a copy in
  `docs/contracts/batch-NN-<topic>.md`. The lead owns shared files and wires `src/main/index.ts`.
- Test-only agents (end-to-end scenarios in `test/replay/replay.mjs`) and a docs agent run alongside.
- Every agent logs its steps so the user can watch:
  `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`.
- Each agent reports its files, test results, open questions, and start/end clock times.
- Run long jobs (builds, replay suites, real-log runs) in the background and keep working or reporting.

## Tests

- Every fix gets a check that fails on the old code and passes on the new one. Real cases (the user's logs,
  exports, the stop case table `test/replay/fixtures/stop_cases.json`) are the test data; a new problem is a
  new row or scenario.
- Build the whole batch, then test at the end. Commands:
  - `npm run typecheck` (node + web), before anything is called done;
  - unit checks: `node test/replay/<name>_checks.mjs` (resolve, where, memory, paths, update, release,
    refresh, sources, sitecodes, bodies, diag, sanitize, afk, marker, import, logparse, places),
    `node test/replay/next_order.mjs`,
    `node test/replay/resolver_guard.mjs`;
  - `npm run test:replay`: builds, then drives the real app through every scenario in `replay.mjs`;
  - `npm run test:replay:logs`: builds, then replays every cleaned real log (`run_all.mjs`, live and scan
    modes; it also runs the release-notes check).
- CI (`.github/workflows/ci.yml`) runs typecheck, build and the replay tests on every push.

## Commits, pushes, releases

- One commit per approved batch, pushed to branch `features`. Hold the commit until the batch's tests pass;
  never commit half-written agent work. No pull requests unless the user asks. The user pulls with GitHub Desktop.
- Commit messages: a short title, then plain bullets of what changed for the user and the tests.
- End every commit message with the attribution lines the session gives you, in the form used by recent
  commits (`Co-Authored-By: ...` and `Claude-Session: ...`; see `git log -1`).
- Release notes: each batch commit adds its lines to `release-notes/<next version>.md` (format and release
  steps in `release-notes/README.md`). The release workflow refuses missing, placeholder or repeated notes.
- Releases: version line "R1" (e.g. R1 1.0.0; `package.json` stays plain semver), built by the
  "Release Windows (Setup + Portable)" workflow started by hand, published from this fork's repo, never
  upstream. Reference data (ships, places, cargo grids) still comes from the original author's repo.
- The program is unreleased: no data migration or compatibility shims unless the user asks for them
  (R1 1.0.0 is a fresh start).

## After each batch

- Update `docs/SYSTEM-MAP.md`, `src/other/STANDALONE.md` (rules and re-tie points), `docs/DECISIONS.md`,
  `docs/TODO.md`, README/FAQ where users see a change, and the release notes, in the same commit.
- Tell the user what changed in plain words, what the tests showed, and what to try in game.
