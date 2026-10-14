# Decisions

Every decision the user has made about SuperCargo-OtherModes (this fork of SuperCargo with Other mode),
grouped by subsystem. All dates are 2026-10-14 (the working session); times are UTC, from the chat.
"Batch" refers to the batch contracts in `docs/contracts/`; commits are on branch `features`.
Quotes are the user's own words, shortened.

The behaviour spec these decisions turned into: `src/other/STANDALONE.md` (numbered job rules) and
`docs/SYSTEM-MAP.md`. Where this file and the spec disagree, ask the user; never settle it silently.

Marked **(superseded ...)**: an earlier decision the user later changed; kept for the record.
Marked **NOT DOING**: decided against, or left out on purpose.

## 1. Scope and upstream

- Other mode is a second work mode beside upstream Haul mode, kept separate so upstream SuperCargo can
  still be merged in. "the intent was to keep the two separate for upstream integration compatibility" (09:32).
- Other mode is the light-weight mode for small "go here, do x" contracts; Haul mode is the heavyweight
  for big hauls with a load plan and manifest. "Other mode is light weight ... haul mode is the
  heavyweight im hauling 900+scu" (09:45).
- Haul mode is only for hauling: in Haul mode the Other side never creates jobs (job rule 1, commit `7c578f8`).
- Debug logging and the debug window are for this program only, not offered upstream. "i want this
  intergrated into the program we are working.. not for upstream offering" (10:10).
- Merge upstream v0.9.1 and keep the fork's own look so nothing changes for Other mode. "merge it and add
  my desgin to the look back, so nothings changed for my other mode" (10:21, commits `3836b92`, `cc5d47e`).
- For now the work is on Other mode only. "right now I only care about the other mode for now" (10:41).
- New work stays inside Other mode unless the user says otherwise ("this is only touching other mode yes?", 18:17).
- **NOT DOING:** fixing Haul's "NB Int. Spaceport" cut-off: Haul recovers it through its own lookup, so
  upstream code is left alone (11:40, approved with "yes proceed").
- **NOT DOING (for now):** the Electron 33 upgrade. "plan them all but the electron" (11:38).

## 2. Other mode jobs and log parsing

- Jobs kept as active after a restart are a feature: after a game crash you rejoin with your contracts.
  "That is a feature actually ... Sometimes the game can crash" (10:05).
- Two outcomes only: completed or abandoned; the reason (Fail, Abandon, "Player left") does not matter.
  "we have only two outcomes to all these missions, completed or abandoned. so the reason of why is moot" (11:03). Job rule 2.
- "Player left" comes from being kicked or joining another party; it counts as abandoned (11:01).
- The latest ending wins, and a new accept for the same mission (a party member re-sharing it) makes the
  job active again, even if archived. "if they reshare it - the mission is re accepted" (11:05). Job rules 3-4.
- Never mark jobs ended because they look stale. "in a game crash, when I rejoin the game I will have my
  contracts still, so we dont want to automark any jobs, let the user do that" (11:12). Job rule 6.
  - (superseded 11:12: the earlier plan "stale jobs from an old session clear when a new session starts".)
- Endings that the log actually records may mark jobs automatically during play. "automark is fine for
  in gameplay loop.... not for crashes" (11:13).
- Quitting ends contracts: "request disconnect means I quit the game.. which closes all contracts" (11:13).
  Quit to menu (server hopping) and quit game have the same effect on contracts (11:17). Job rule 5.
- The objective parser is built from the user's real Game.logs; special-event missions are not the
  standard case (10:59). Every objective type seen in the logs becomes a step (commit `7c578f8`).
- Build all ten suggestions, with their switches in the options: auto-tick from Objective Complete,
  Objective Withdrawn, crash notice, contract-limit toast, rep on the job, shared badge and short-loop
  hiding, marker-position distances, session summary in History, finish the Haul-switch prompt, real log
  excerpts as tests. "I want you to do everything, 1-10. if we can have options, or configurations then
  put them in the options tab" (11:32, commit `7c578f8`).
- Extra work approved alongside: build clean-up (tsconfig, type errors, stale patch, dead code), CI, and an
  independent reviewer (11:40, "yes proceed").
- Rep ranges like "[100-500 Rep]" are read and shown as "+100-500 REP" (batch 12, overlay fix O2, approved 20:24 "2, yes").

## 3. Next page, distances and the overlay

- The Next page must show distances and prove it is sorted by distance (12:24-12:27, "do it all, lets
  code it", commit `3d38301`).
- The overlay card is the main screen in game and must show distance. "the user wont have the main window up
  during game play. the overlay card is the primary method to communicate" (12:46).
- The overlay/Next distance batch (items 1-21) approved in full, with the no-distance wording: "Not found in
  UEX", or "open station inventory or manually set a start" (12:55, commit `3e97dcc`).
- Places UEX can't place must be fixed at the source of the place list, not called "not found" (13:21,
  commits `9f23957`, `89dbd88`).
- STARTING AT: AUTO starts from a typed location and then follows the position the app finds; the other mode
  (FIXED) sorts from the known, typed start. "wouldnt you want auto to begin by a typed location, then auto
  update as it the app finds your location?" (13:26). AUTO is the default: "make it auto on a start" (14:21, batch 1).
- Distances are system-aware (Stanton, Pyro, Nyx via gateways, "+ 1 jump") and stops on the same planet or
  moon are measured over the surface (13:44, 13:54, batch 1).
- Pickup before delivery: an open pickup comes before the delivery of the same item (batch 4, approved 16:08).
- A stop not yet picked up is measured from the pickup place, never from the drop-off marker (batch 6,
  "code as recommended. approved", 17:12).
- REFRESH button on the Next and Jobs screens (not the overlay), so jobs pick up newly placeable locations
  (16:15; "push this batch, then add refresh on the next batch" 16:17; approved 16:29, batch 5).
- Overlay header has a fixed height so the card stops jumping when stepping between stops (batch 12, O1,
  from the user's report at 19:44; approved 20:24).

## 4. WHERE AM I (position reading) and OCR

- Read the position from the game's star map with OCR, using the user's existing crop tools (13:29).
  Use the coordinates line at the bottom of the map (13:33). A map at 0/0 is a bug and is ignored (13:53).
- Use the map screen only, with two zones in one setup screen: zone 1 = the map line above the title bar,
  zone 2 = the r_DisplayInfo text in the upper right (14:14).
- Fire it with a hotkey and a button (14:16). One button only, on the overlay start line; no second
  WHERE AM I on overlay page 2. "why do I need another where am i on page 2 of the overlay?" (14:20).
- Build batch 1 together, test at the end, then push (14:21, commit `3492945`).
- OCR reads the whole display-info panel; the top 4 lines and the planet information are used, falling back
  to other methods when a value doesn't make sense (15:20-15:22). A 5 s read is fine (15:23).
- The hotkey field records the next key combination you press (15:23).
- Show position accuracy as a 0-10 score on the overlay and the Next tab, with a red (0) - orange (5) -
  green (10) gradient (15:28, 15:32).
- "lets do it all and test at the end, like before. then push" (15:33): all of batch 2, including the
  recorder on the upstream OCR hotkey field, tracked mission, live position (off by default) and server time.
- AFK must be a button, added to the batch 2 build (15:35-15:36, "you are approved, code it all as planned").
- Planet data is saved locally (radius per planet) and used for later lookups (16:09, "approved code it,
  and yes go ahead and push it", batch 4b).
- When the screen's Altitude is garbled, work the altitude out from the position and the planet's size
  (batch 12, O3, approved 20:24).

## 5. Place matching: resolver, match memory, learned data

- Prevent wrong matches showing as correct, with a streamlined design instead of more rules. "we need a
  better way to prevent traveling to places that are not correct" (17:13); "lets do choice 2, as
  recommended. approved, code it" (17:18, batch 7, commit `ecff83e`).
- Learning must come with a way for the user to correct mistakes (17:30, batch 8 M1-M8).
- The user can fix a wrong place directly where they see it (17:59, the match tag fix panel).
- Every data source other than UEX can be switched on or off. "If we use other data sources than UEX, I need
  the abilty to select or deselect those options as data sources" (17:37, batch 8).
- Star Citizen Wiki game data (scunpacked-data) is used as a switchable source (17:43, batch 8 addendum 3).
  (superseded 17:43: "actually leave out the wiki", 17:41.)
- One name/place system for all of Other mode, learning and editable everywhere. "I asked you to streamline
  the process... that means the entire name/place resolution" (18:02); approved as one batch, tested at the
  end (18:08, batch 9, commit `d0c0b18`).
- LEARNED DATA is a main tab, not a Settings tab. "lets make a new main tab ... the tab is called "Learned
  Data"" (18:53). (superseded 18:53: a LEARNED PLACES tab inside Settings, 18:50.) With Places, Sites and
  Planets sections and suggestions S1-S4 and S7; Data Sources stays in Settings; shown only in Other mode
  ("lets do what you suggested", 18:54, batch 11, commit `ab1edb7`).
- **NOT DOING:** S5 bulk clean-up and S6 export/import of learned places (not picked, 18:54).

## 6. Settings

- Configurable behaviour goes into the options (11:32).
- Settings gets two tabs, GENERAL (upstream sections) and OTHER MODE, with large headings and plain,
  easy-to-understand wording (batch 10 layout approved 18:30, commit `a0834ec`).
- Settings has a section to change the user data folder (20:01).
- Update checks are on by default once they point at this fork's repo. "is it pointing to my repo, if yes,
  then make it default" (20:24).

## 7. Data folder

- User data lives in the Windows user folder, like Gremlin-Platforms (19:33, "1 yes" 19:37).
- Fresh start: old data in `%APPDATA%\SuperCargo` is not moved and not deleted ("2, fresh start", 19:37).
- The app must never change folder behaviour the user didn't approve. The lead's unasked change (a
  `SuperCargo` subfolder inside a picked folder) was reverted (19:54).
- Defaults like Gremlin "for both" (20:09): the program in `%LOCALAPPDATA%\Programs\SuperCargo-OtherModes`
  (the installer asks), user data in `C:\Users\<you>\SuperCargo-OtherModes`, separate folders.
  (superseded 20:09: data in `%USERPROFILE%\SuperCargo` (19:37); program in `C:\SuperCargo-OtherModes` with
  data in `AppData\Local\Programs\SuperCargo-OtherModes` (20:01); program and data in one folder (20:03).)
- A picked data folder is used as it is (no subfolder); a chosen folder missing at start-up falls back to the
  default and says why (20:09, "like gremlin for both").
- A folder "has SuperCargo data" only when SuperCargo's own files are in its root (20:14).
- One rule whenever a data folder is opened (start-up, after install, after CHANGE...): good data is used;
  damaged data gets a warning with Reset or Cancel. "If its corrupted or not acceptable warn the user, give
  the ability to reset" (20:17); "If I am installing the program over the exisiting program ... we should use
  it" (20:18); "if you pick a diffrent folder, thats the same usecase" (20:19).
- One damaged file warns for the whole folder; Reset moves all SuperCargo files and folders into
  `Moved for Repair` so the user can look at them (20:22), each reset in its own dated folder, and
  `settings.json` is not moved (20:24).
- An empty folder picked with CHANGE... gets the current data copied in first (batch 12).
- Big re-downloadable OCR files (about 20-40 MB) stay in the hidden AppData folder ("question 5 is leave it
  in the appdata folder", 20:29).

## 8. Installer, releases and updates

- A self-installing exe and a standalone, like Gremlin-Platforms (19:33): Setup.exe (installer) plus a
  Portable.zip; the single portable exe is dropped ("3. zip is stand alone and exe installer", 19:37).
- Releases come from this fork's repo (SuperCargo-All), never upstream; release files are named
  SuperCargo-OtherModes (answer "c", 19:38). (superseded 19:38: "push from SuperCargo-OtherModes Repo" (19:37);
  no repo of that name exists.)
- Version: "the version number for the release will be R1 1.0.0" (19:40); tag
  `SuperCargo-OtherModes-R1-<ver>`, `package.json` stays plain semver.
- Installer like Gremlin: per-user, no admin, the user chooses the install folder, desktop shortcut optional
  and unticked, uninstall never touches user data (19:37-19:39, "approved"; 19:58).
- Updates look and act like Gremlin-Platforms (20:28): a Check for Updates window, release notes, Update
  Now / Skip This Version / Later, progress and a checked download, an "Updated" notice, Try Again; checks once
  at start-up. The portable copy only links to the release page.
- Release notes like Gremlin's "what changed" notes (20:35). The window shows the What's new part, every
  skipped version newest first, a link to the full notes, and "Release notes unavailable." when missing
  (4a-4e, "yes approved" 20:38).
- Notes are written before a release and the workflow enforces it. "make sure the notes are doucmented and
  written prior to release so its used in the release. make sure that is in the workflow" (20:37). Rule: each
  batch commit adds its lines to `release-notes/<next version>.md` (see `release-notes/README.md`).

- Releases run from the `features` branch; `main` is updated to match it ("we run it from Features, and update
  main to match", 2026-10-14).

- Batch 12 follow-up questions (2026-10-14, answered with full context after "these are decisions and I need to
  understand the reason why, and what the impacts are"):
  - Q1: the release workflow keeps refusing an already released version even with publish unticked ("this will be a
    release, not a test build").
  - Q2: closing the update window during a download cancels it, like Gremlin.
  - Q3: Check for Updates works while in a crew (it already did; no change).
  - Q4: keep the "(SKIPPED)" marker on the Settings version status.
  - Q5: CHANGE... copies SuperCargo files and folders only.
  - Q6: a picked folder counts as holding SuperCargo data only when it has SuperCargo's own files (not a logs,
    exports, outbox or game-data folder).
  - Q7: if Reset can't move a locked file at start-up, the app shows an error and closes.
  - Q8: the start label stays as it is ("the label is fine"; the problem was the squished overlay rows, fixed by O1).
  - Q9: rep shows exactly what the contract says ("just show what the contract says, nothing more"); no range totals.
  - Q10: a file missing from the author's list or one that can't be saved counts as a failure and shows the warning.

- R1 1.0.0 released 2026-10-14 (from `features`, `main` updated to match).
- Overlay follows the work mode (2026-10-14, "approved as recommend", option A): every settings change is sent to the
  other windows, not only six overlay keys; ships in R1 1.0.1. Found on the user's first run of the 1.0.0 installer:
  the overlay kept the Haul card after switching to Other until "show all objectives" was toggled.

## 9. Reference data (ships, places, cargo grids, contract box sizes)

- Reference data keeps coming from the original author's repo, "since I still use thier program"; the
  program and everything else come from this fork (20:33).
  (superseded 20:33: "4, my repo" (20:24); "we will use our repo for these" with a check for newer files (20:28);
  "c" = check both repos (20:29).)
- The download is checked and the result shown, not silent: "can we put a check in place to see if it was
  sucessful?" (20:33); "it should be in the update window and not be silent" (20:34). Per-file status in the
  update window, a CHECK NOW button, a warning line in Settings, a REFERENCE DATA section in diagnostics.
- How upstream refreshes its data files is a to-do: "lets make that a todo for this app" (20:31). After
  20:33 it applies only if the fork ever stops using the author's data (`docs/TODO.md`).

- Console noise reviewed (2026-10-14): fix the double download of the UEX place list ("ok, fix #2. for the next
  release"): done in batch 12, overlapping refreshes share one download. Left as is for now: the Supabase "Node.js 20"
  warning (needs the Electron upgrade, see 1), and Tesseract's "Estimating resolution" / "Image too small to scale"
  lines (to confirm with a diagnostics export first; see docs/TODO.md).

## 10. Diagnostics and logging

- Better logging and a live debug window the user can copy from (10:03); a debug button (10:36); the window
  must be movable (10:37, commit `ca4b1b4`).
- A diagnostics export that logs everything the app found and decided, for Claude to review how the whole
  program performs in game and suggest changes (12:27-12:30, commit `3d38301`).
- All 15 proposed diagnostics additions (15:59, "build them all. approved, code it", batch 3).
- Export saves the file and copies the whole text to the clipboard (16:04-16:08, batch 4).
- COPY TEXT and COPY IMAGES buttons; images joined into one picture (17:10-17:12, batch 6).
- Personal data is removed from exports (player handle, ids, OS user); pictures are opt-in because they can't
  be cleaned. The OS-user cleaning only replaces the name inside paths ("yes", 16:29, batch 5).
- Export pictures go next to the export file (17:05, confirmed as intended).

## 11. Testing

- Test against the user's real Game.logs (10:49-11:00) and their diagnostics exports; cleaned excerpts
  become permanent tests (11:32).
- Every fix comes with a check that fails on the old code and passes on the new.
- Build the whole batch, test at the end, then push (14:21, 15:33, 18:08).
- CI runs typecheck, build and the replay tests on every push (11:40).

## 12. Docs

- The code audit and system map go in the repo (09:21, "push those to repo" 10:41, commit `40299e5`).
- The system map, decisions, memory and rules are written to the repo and pushed (this file, `CLAUDE.md`,
  `docs/contracts/`, `docs/SYSTEM-MAP.md`; 2026-10-14 evening).
