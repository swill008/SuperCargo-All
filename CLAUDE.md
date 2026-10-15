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
   Quote efforts from `docs/timings.md` (rule 10 below); with no matching row say "rough guess".
2. **Build only after an explicit go** ("approved", "code it", "go", "do it"). A question, "I like that" or
   "let's keep planning" is not a go. The user has stopped unasked coding more than once
   ("why are you coding? i never told you do so"; "I didnt say go..."). While waiting, don't build ahead.
3. **Never change program behaviour without asking the user first** (user, 2026-10-14). That includes
   "improvements" found in review: report them as questions, don't apply them. If a contract is unclear or
   would change behaviour, stop and ask.
4. **Ask in plain language with full context.** Say what the thing is, where the user sees it and what each
   answer would do. The user: "use better language to ask these questions. I dont even have context".
   Number the questions and keep them short; offer a recommended answer.
5. **One subject per message, said plainly** (user, 2026-10-14: "dont mix subjects and be explict on what you
   are tying to tell me. I dont want to infer what is happening"). State facts directly ("It has not been
   released."), never leave the user to work out the state from a summary.
   Every question carries its own context: what the thing is, where the user sees it in the app, what it does
   now, what each answer would do, and your recommendation. Never a bare list of questions.
6. **Recommendation at the top of every question** (user, 2026-10-15: "restate your questions, with options and your
   recommendations. put your recommendations at top. make this a rule"). Each question is laid out in this order:
   the question in one plain sentence; **Recommendation:** the option I recommend and why, in one or two lines; then
   every option (the recommended one included) with what it does and its effect; then the effort (rule 10). Never
   bury the recommendation in the option list.
7. **Answer what was asked.** When the user asks for a list or a comparison "nothing else", give only that.
8. When the user corrects a fact about the game (how contracts end, quits, crashes, sharing), take it as the
   spec, write it into STANDALONE.md / DECISIONS.md, and don't argue it back.
9. Record every new user decision in `docs/DECISIONS.md` in the same batch (superseded ones stay, marked).

## Privacy

- **Never put player names, handles, org names, mission ids, player ids or any personal data** in code,
  tests, fixtures, docs, commit messages or release notes. Game logs and exports contain them: use the
  sanitiser (`src/main/sanitize.ts`: handle -> PLAYER, other players -> OWNER-n), placeholders, or leave it out.
- Fixtures from real logs are made with `test/replay/make_fixture.py` (cleaned). Screenshots and OCR pictures
  can't be cleaned: never commit them, except gold pictures the user approves after a check for personal data
  (user, 2026-10-15: "keep these images as gold standard, for future tests"): they live in
  `test/replay/fixtures/gold/<date>-<place>/` with a README (source, what each shows, true content, baseline read).
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
- **No push and no release unless the user says so** (user, 2026-10-14: "do not do another release until I tell
  you"; "do not push until I tell you to"). Commit locally when a batch passes its tests, then wait for the user's
  go before pushing. After a push the user asked for, watching CI is fine ("after a push, you can watch CI").
- Releases are run from the `features` branch, and `main` is updated to match it (user, 2026-10-14).
- Releases: version line "R1" (e.g. R1 1.0.0; `package.json` stays plain semver), built by the
  "Release Windows (Setup + Portable)" workflow started by hand, published from this fork's repo, never
  upstream. Reference data (ships, places, cargo grids) still comes from the original author's repo.
- The program is unreleased: no data migration or compatibility shims unless the user asks for them
  (R1 1.0.0 is a fresh start).

## After each batch

- Update `docs/SYSTEM-MAP.md`, `src/other/STANDALONE.md` (rules and re-tie points), `docs/DECISIONS.md`,
  `docs/TODO.md`, README/FAQ where users see a change, and the release notes, in the same commit.
- Tell the user what changed in plain words, what the tests showed, and what to try in game.

## Rules carried over from Gremlin-Platforms (user, 2026-10-14: "use its rules etc, so we dont have to be retrained")

The user works the same way in both repos. These are Gremlin-Platforms' `.claude/CLAUDE.md` rules, mapped to this
repo. Where a rule here and one above disagree, the newer user instruction wins (dates in brackets).

1. **Status line.** Start every message to the user with a one-line status, e.g.
   `[Overlay fix ▓▓▓▓░░░░░░ 40% · e2e test running · next: full test run]`.
2. **Change control.** The intended behaviour is the spec: `src/other/STANDALONE.md` (numbered rules and re-tie
   points) plus `docs/DECISIONS.md`; `docs/SYSTEM-MAP.md` says where things live. Before changing behaviour, read
   them. A change that adds, changes, removes or contradicts a rule or decision goes to the user first; update the
   spec with their answer, then code. Code that differs from the spec is a gap to fix (failing test first), not a
   spec change.
3. **Spec line in commits.** Every commit touching `src/` has a line `Spec: <file> <rule/decision refs>` naming
   what it implements, or `Spec: none (no behaviour change)`. `test/replay/spec_line_checks.mjs` fails otherwise
   (like Gremlin's `test_spec_line.py`).
4. **Keep the map current.** Every batch updates the docs it touches (SYSTEM-MAP files and IPC, STANDALONE rules and
   re-tie points, DECISIONS, TODO, README/FAQ, release notes) in the same commit.
   `test/replay/map_covers_files_checks.mjs` fails when a file under `src/` isn't named in `docs/SYSTEM-MAP.md` or
   `src/other/STANDALONE.md` (like Gremlin's `test_program_map_covers_files.py`). `npm run test:checks` runs every
   check script; CI runs it on every push. Before every release, do a full
   map check (counts, gaps, anything stale).
5. **How we work.** Trace end to end first; fix at the shared owner; tests drive the real path and fail on the old
   code; an independent re-trace of a fix; build in a batch, then test.
6. **Agents: parallel by default, count from the analysis** (Gremlin rule 4; user, 2026-10-14: "what good are
   rules if you ignore them?"). Before any task, and whenever new work appears mid-task, split it into independent
   pieces, one agent each, running at the same time. Every time agents start, the message shows, before the table:
   the files the change touches; their owners; the shared contract (names, data shapes, ids); then the table
   (`| Agent | Files | Job | Why parallel / why one |`) covering: one agent per independent group of program files;
   test-only agents (end-to-end on the real path, carry-through to every path that carries the change, updating
   tests that pin the old behaviour); an audit agent for the same fault elsewhere; spec/map/docs as their own agent;
   then a "Left out:" line (same file, strict order, over ~8-10). The count comes from that analysis, never from
   habit. Stagger an agent that must wait for a file another agent holds. This holds for tasks whose main steps
   must run in order too (commit, push, release, a full run): do the analysis unasked and show the table, and run
   alongside them what can go in parallel: read-only studies of open problems (e.g. a CI failure), prep for the
   plan the user said comes next, and checks of what was just changed (user, 2026-10-15: "why are you not
   analyzing tasks and doing this yourself? why do I have to ask?"). The lead keeps shared files
   (`src/main/index.ts`, `src/shared/*`, `src/preload/index.ts`, `CLAUDE.md`, `package.json`, CI files). Give every
   agent this section and a time budget from `docs/timings.md`.
7. **Overseeing agents.** Watch commands, not only results. When an agent's fix is proven (fails on old code,
   passes on new), stop further proof runs. Tell the user about any agent step over 5 min when it starts.
8. **Live output.** Agents log every step to `/home/user/SuperCargo-activity.log`
   (`echo "$(date +%H:%M)  <agent> <what>"`), and a status line (doing / ETA / finding / plan) at least every 30 s
   when the user is watching. (Gremlin's PowerShell log window is for the user's PC; this cloud session can't open
   one.)
9. **Commits and test runs.** One commit per batch of approved work; small fixes found mid-batch ride along.
   Before a batch commit, run the quick tests: `npm run typecheck`, every `test/replay/*_checks.mjs`,
   `next_order.mjs`, `resolver_guard.mjs` and the replay scenarios for what changed
   (`node test/replay/replay.mjs <names>`). The full run (`npm run test:replay` + `run_all.mjs`, ~7 min) is for a
   very complex batch, and before a push the user asked for; say why when you run it.
10. **Timing table.** `docs/timings.md` is the source for every time quoted. Note the clock when a step starts; add
    a row when it ends (agents, test runs, CI, release runs, the lead's own steps). Every option, recommendation or
    plan shown to the user carries its effort quoted from the table, naming the kind (e.g. "Effort: 3-8 min
    (timings.md: agent fix)"); with no matching kind say "no timing data yet; rough guess N min". Why (user,
    2026-10-10): "I decide what to put into the program based on the effort it requires."
11. **Recommend the cleanest design first.** Compatibility with an old layout (migrations, shims, "keep the old
    behaviour") is offered only as an alternative, never added without the user asking. Note: R1 1.0.0 is released,
    so a change to saved data now needs the user's call on existing data.
12. **One-time code** (code that runs once or reads an old layout), when the user approves it: mark it
    `// ONE-TIME: <what, when it can go>` at the code and list it in `docs/TODO.md` under "One-time code", same
    commit. Before each release, list the open one-time items to the user.
13. **Mock-ups** are drawn inline in the chat, never made by running code; a script-made picture may be offered with
    its effort and made only if the user says yes.
14. **Reports, studies and plans** go to the user in the chat (text, tables, pictures). Don't publish artifacts or
    pages for this repo unless the user asks. (Gremlin's single tracker artifact is Gremlin's; this repo has no
    tracker: open items live in `docs/TODO.md`, decisions in `docs/DECISIONS.md`.)
15. **Pass this section on to every agent you start.**
