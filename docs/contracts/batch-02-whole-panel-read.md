<!-- Copy of the batch contract the lead gave the agents (CONTRACT2.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 2 contract: whole-panel read, fixes a–f, recorder, accuracy, live, tracked mission (lead owns)

Repo /home/user/sc-features, branch features (last commit 3492945). Read CONTRACT.md in this folder for batch 1 background.
Rules: edit ONLY your files; no commits/pushes; no player names in code/tests/fixtures (handle = PLAYER);
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before you finish
(errors in other agents' files mid-build are expected — report them). Final report: files, exports, results, start/end clock.

## User-approved items (all of them)
C1 Whole-panel read: zone 2 OCRs the whole r_DisplayInfo panel; extract EVERY field into DisplayInfo (types already added in
   src/other/otherWhere.ts: zones, shipPos, planetZone, planetPos, solarPos, rootPos, radiusM, altitudeM, elevationM, xyPos,
   playerLocation, playerLocationIndex, serverTime, universeTime, trackedMission, checks). Use, best first, each only if its
   sense check passes (record each in `checks`):
   1. near a body: planet zone line (Zone: OOC_<Sys>_<n>[a-z]?_<Body> Pos: km) or CamPos Planet Zone (m) + roster body centre.
      Checks: km line ≈ CamPos (within 1 km) when both present; |pos| ≈ radius + altitude (within 5 km) when those are present;
      playerLocationIndex (Stanton1 = Hurston, 2 Crusader, 3 ArcCorp, 4 microTech; moons "1a" etc. may appear) agrees with the
      body when present. Presence of the planet zone line alone = near that body (Radius/Altitude may be cut off).
      If Altitude present and > 100 km -> use 2. instead.
   2. SolarSystem line, check == Root within 1 km (if Root present). Else Root alone.
   3. caller falls back to zone 1 (map line), then log clues.
   Label near a body: "Hurston · 50 km up · 422 km from HDPC-Cassillo" (name = nearest place only within 50 km).
C2 fix a: system names -> known systems by prefix (Stanton, Pyro, Nyx), ignoring trailing digits/l/I/| and "SolarSystem"/"System".
C3 fix b: OCR tolerance: OOC/00C/0OC/O0C, spaces for underscores, unit per number (m, km, Km, "Kkm" typo), stray commas
   ("12849498.,1180km"), leading junk ("~~"), a "Pos:" whose numbers wrap to the next line.
C4 fix c: travel(): a system counts as known only if some roster Location has it; unknown/null on either side = same system.
   Normalise names before comparing (Stanton1/Stantonl/StantonSolarSystem -> stanton).
C5 fix d: name matching treats O/o as 0 (and I/l as 1 if safe) inside tokens that contain a digit (S1DCO6 = S1DC06).
C6 fix e: the real OCR texts (below) are test inputs.
C7 fix f: a read with no system is OK (system null); nearest-place naming then searches all systems.
C8 Hotkey recorder: click the field -> "Press keys…"; next combo becomes the hotkey (Electron accelerator, e.g.
   CommandOrControl+Shift+L); Esc cancels; Backspace/Delete clears (= off); needs Ctrl/Shift/Alt unless F1–F24; modifier-only
   ignored; while recording ALL app global hotkeys are paused (IPC); warn on conflict with ocrHotkey / Ctrl+Shift+D (debug) /
   the other hotkey; after saving, show "in use by another app" when registration fails (IPC check).
O1 The recorder also replaces the upstream OCR hotkey text field (src/renderer/src/pages/SettingsPage.tsx, minimal edit:
   swap the input for the component; record the re-tie in STANDALONE.md).
N1 Position accuracy 0–10 (Where.accuracy at read time; whereAccuracy() for now; ACCURACY table in otherWhere.ts).
   Clue bases: inventory 7, objective 6, tick 5; display info body 10 / space 9; map place 8 / body 4 / coords 3; typed = no score (null).
   Shown on the overlay start line and under STARTING AT on the Next tab with the word (accuracyWord) and number.
N2 Read feedback after every WHERE AM I read (overlay ~4 s): "📍 Read OK · display info · ACC 10" /
   "📍 Panel unreadable → used map line · ACC 3" / "📍 Couldn't read the map, try again" (previous start kept).
   WhereRunResult.note carries the fallback text; live reads ('live') are silent unless the user turned live on and it fails 3x in a row (then one quiet message).
N3 Fading: −1 per 5 min since where.at, never below 1 (whereAccuracy).
N4 Colour: smooth gradient red (0) -> orange (5) -> green (10) using the theme's red/amber/green; overlay: coloured "ACC n" tag +
   thin 10-segment bar; Next tab: small slider with the full gradient behind and a marker at the score. Number + word always
   shown (colour-blind safe). Plain CSS.
O2 Tracked mission: DisplayInfo.trackedMission.id (uuid; OCR may garble — match an active job whose missionId starts with the
   same first 8 hex chars, tolerant of O/0, I/1) -> store field `trackedMissionId` (doc field); the overlay shows a "TRACKED" tag on
   that job and jumps the card to its next stop when a new tracked id arrives; the Next tab shows the tag too.
O3 Live position: settings otherWhereLive (default false) + otherWhereLiveSec (45, range 30–120): main re-reads zone 2 only every N s
   (skip while a run is busy or recording a hotkey); broadcasts only ok results (why 'live'); diagnostics count live reads.
O4 ServerTime: parsed to ISO UTC; if it differs from the PC clock by > 2 min, the read is "maybe stale": accuracy −3 (min 1),
   recorded in checks and diagnostics.

## Real OCR texts from the user's export (tests)
NEAR HURSTON (was read as "Open space", system "Stantonl"): expect body Hurston, system Stanton, point = Hurston centre +
(-500748.1, 922872.0, -1516.49) m ≈ 50 km up, nearest HDPC-Cassillo ≈ 422 km, accuracy 10.
```
Zone: MISC Hull B <zone-id> Pos: -0.94m 26.39m 0.52m

Zone: 00C Stanton 1 Hurston Pos: -500.7481km 922.8720km -1516.49m

Zone: SolarSystem <zone-id> Pos: 12849498.1180km 427.5609km -1516.49m
Zone: Root Pos: 12849498.,1180km 427.5609km -1516.49m

FPS 82.6 - 12.2ms [11.9ms]
```
SPACE, TOP 3 LINES ONLY (failed before: no system): expect ok, star-frame point, system null, accuracy 9.
```
Zone: MISC Hull B <zone-id> Pos: -2.91m 14.90m 0.56m

Zone: SolarSystem <zone-id> Pos: 12472406.2902km 231654.0157km -233.7724Km
~~ Zone: Root Pos: 12472406.2902km 231654.0157km -233.7724km

FPS 111.3 - 9.0ms [8.8ms]
```
SPLIT LAYOUT:
```
Zone: MISC Hull B <zone-id> Pos:

-2.91m 14.90m 0.56m

Zone: SolarSystem <zone-id> Pos: 12472406.2902km 231654.0157km -233.7724km
12472406.2902km 231654.0157km -233.7724Kkm
```
Full panel samples (clean): the blocks in CONTRACT.md plus these lines seen in screenshots:
`ServerTime: Wed Oct 14 14:05:05 2026`, `UniverseTime: Sun Sep 19 12:30:33 2990`,
`Tracked mission : FTL_Courier_Stanton_Chlorine_Rank1_0 [<id>]`,
`XYPos: -913952.603423 -262582.740992 Page: 3 (-Y)`, `Radius: 1000000.000000 ElevationUnderCam: 1064.250000 Altitude 7.436596`.
Screenshots: <session-files>/images/ (9,10,11 panels; 13,14 the user's app after batch 1).
Distances test: with where.system "Stantonl", HUR-L1 Green Glade Station gets ≈1.29 Gm, jumps 0.

## IPC additions (main agent owns main side + channels + preload)
- otherHotkeysPause 'otherHotkeys:pause' (invoke): unregister all app global shortcuts (upstream OCR + WHERE AM I) while recording.
- otherHotkeysResume 'otherHotkeys:resume' (invoke): re-register (call upstream registerHotkey path via a callback passed into registerOther, or re-run both registrations).
- otherHotkeyCheck 'otherHotkeys:check' (invoke, accelerator: string) -> { ok: boolean; reason?: 'invalid' | 'in-use' }: try to register then unregister (only while paused) — or report the result of the last real registration per key.
- preload: otherHotkeysPause(), otherHotkeysResume(), otherHotkeyCheck(accel), plus existing where methods.
- WhereRunResult.why / note / info filled by main; live timer in whereAmI.ts restarts when otherWhereLive/otherWhereLiveSec change
  (settings patch handler re-tie: call a register-side function; keep upstream edits minimal and listed for docs).

## Store/doc (state agent)
- Where.accuracy set for every clue (ACCURACY table). Doc field trackedMissionId?: string (+ trackedAt?) set from applyWhere when
  r.info?.trackedMission matches an active job (match rule in O2). jobs.ts isWhere accepts accuracy (0–10).
- otherDiag SNAPSHOT: whereAmI shows the full parsed info (all fields), checks, note, why, accuracy now (whereAccuracy), word;
  live read count; trackedMissionId.
- resolveOrigin (geo agent) returns accuracy: number | null (null for typed) using whereAccuracy.

## AFK button (user-approved, added to this build)
Overlay button AFK (next to TURN IN / ABANDON). Click = start, click again = stop. While on: amber, "AFK ON · next key in 12 s".
Each cycle every otherAfkIntervalSec (15): bring the Star Citizen window to the front (process StarCitizen / window title
"Star Citizen"; Windows foreground-lock workaround allowed), press otherAfkFirstKey (F2, map) on the first cycle, then
otherAfkCycleKey (F1) every later cycle. Stops: button, game window gone, otherAfkMaxMin (120; 0 = none), app quit.
On stop: leave the game focused (no extra key). otherAfkWhereRead (true): about once a minute while AFK is on, run a WHERE AM I
read (why 'live', quiet) after a key press settles (~2 s).
Key sending = Windows SendInput with SCAN CODES (games read scan codes), via a persistent PowerShell child process with an
Add-Type C# helper (no new npm packages, no native build). Non-Windows: start returns { on:false, lastError:'Windows only' }.
Test seam: env SC_AFK_DRYRUN=1 -> no focus/keys sent; each press is recorded in state (presses, lastKeys) so replay can assert.
Settings (already added in workMode.ts): otherAfkIntervalSec 15, otherAfkFirstKey 'F2', otherAfkCycleKey 'F1', otherAfkMaxMin 120, otherAfkWhereRead true.
IPC (main agent adds channels + preload; afk agent owns src/other/main/afk.ts and exports registerOtherAfkIpc(getSettings) +
stopOtherAfk(); main agent calls registerOtherAfkIpc in registerOther and stopOtherAfk on quit):
- otherAfkStart 'otherAfk:start' (invoke) -> AfkState; otherAfkStop 'otherAfk:stop' (invoke) -> AfkState; otherAfkGet 'otherAfk:get' (invoke) -> AfkState
- evtOtherAfk 'evt:other:afk' broadcast to all windows on every change.
- preload: otherAfkStart(), otherAfkStop(), otherAfkGet(), onOtherAfk(cb).
- AfkState (export from new src/other/otherAfk.ts, afk agent writes it FIRST): { on: boolean; startedAt?: string; nextAt?: string;
  endsAt?: string; presses: number; lastKeys?: string[]; lastError?: string; dryRun?: boolean }
Diagnostics: state agent adds AFK state (on, presses, lastError) to the SNAPSHOT via preload otherAfkGet when available.
UI: ui-cards adds the overlay button + state line; ui-settings adds AFK settings (interval, first key, cycle key, time limit, read
while AFK) in the OTHER MODE block, with the hint: "Presses keys in Star Citizen for you. Check RSI's terms before using it;
the game window is brought to the front every cycle."
