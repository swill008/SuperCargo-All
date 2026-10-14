<!-- Copy of the batch contract the lead gave the agents (CONTRACT11.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 10 contract: OTHER MODE settings tab (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features (HEAD d0c0b18). Rules: edit ONLY your files; no commits; no player names;
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing.
Do NOT run npm run build (the lead builds/tests at the end). Final report: files, results, start/end clock times.

## User's words
"create an Other Mode settings tab in the Settings tab. All specific other mode options will be there. Anything vanilla and
specific to the main program will be in the original settings area... all headings in this new Other Mode will be enlarged so
they are prominent... make the new settings user friendly and easy to understand."

## Approved layout
SETTINGS page: a tab bar at the top: GENERAL | OTHER MODE (button text exactly these). The chosen tab is remembered
(localStorage key 'sc.settingsTab', wrapped in try/catch; default GENERAL). The Work mode selector (WorkModeSection, shown by
App.tsx above SettingsPage in Haul mode) stays where it is (GENERAL). The OTHER MODE tab is shown in both work modes; in Haul
mode its top line says "These settings apply when Work mode is Other."
GENERAL = today's vanilla sections unchanged (Game, Data, Display, Overlay, OCR Capture, Contribute, Contract Data, Updates,
Usage Stats, Debug, About) with the Other block REMOVED from it.
OTHER MODE = NEW src/other/renderer/OtherSettingsPage.tsx, sections in this order, each with a LARGE heading (clearly bigger than
the GENERAL section titles: ~20px display font, accent colour, letter-spacing, a rule under it) and a one-line plain description:
1 "Jobs & Objectives" — Include aUEC (scan), auto-tick objectives, withdrawn steps, crash notice, contract-limit toast, show
  reputation, shared badge, session summary, short-loop hiding (otherHideShortLoopsSec), Haul-switch prompt (+ min SCU).
2 "Distances & Route" — start mode (auto/fixed), distance from mission markers, distances on the overlay.
3 "Where Am I (position reading)" — hotkey (recorder), zones (SET UP ZONES), use zone 2, live position + interval.
4 "Places & Matching" — sub-heading "Data Sources" (DataSources.tsx) and sub-heading "Learned Places" (LearnedPlaces.tsx).
5 "AFK" — AFK key presser note (RSI terms), interval, first key, cycle key, time limit, read position while AFK.
Every setting row: plain label + one-line hint saying what it changes in game terms (rewrite hints where unclear; keep the setting
keys and behaviour EXACTLY as today; no setting added/removed/renamed).
A jump list under the tab bar: "Jobs · Distances · Where Am I · Places · AFK" (buttons that scroll the section into view).

## Agents and files
- other-tab: NEW src/other/renderer/OtherSettingsPage.tsx (default export, props { rowStyle; keyStyle; Toggle } same as today's
  block), src/other/renderer/settingsBlock.tsx (split into exported section components used by the page; or move everything into
  the page and leave settingsBlock re-exporting it; your call, keep one copy of each control). DataSources.tsx / LearnedPlaces.tsx
  only if a heading inside them must change.
- tabs: src/renderer/src/pages/SettingsPage.tsx: the tab bar + remembered tab; GENERAL renders today's sections without
  <OtherSettingsBlock …/>; OTHER MODE renders <OtherSettingsPage rowStyle keyStyle Toggle/>. Minimal edit (re-tie), keep the
  upstream code otherwise identical. Also the OCR hotkey recorder's conflict list there stays.
- e2e-docs: test/replay/replay.mjs: helpers that open Settings and look for DATA SOURCES / LEARNED PLACES / AFK / zones must
  click the "OTHER MODE" tab first (find all of them: grep SETTINGS, DATA SOURCES, LEARNED PLACES, SET UP ZONES, AFK, Hotkey);
  add scenario 'settings-tabs': GENERAL shows vanilla sections and no Other rows; OTHER MODE shows the 5 headings in order, each
  rendered with a font size larger than a GENERAL section title (getComputedStyle), the jump list scrolls to AFK, the tab is
  remembered after an app restart, and a toggle on the OTHER MODE tab still saves (e.g. otherShowRep). Docs: src/other/STANDALONE.md
  (re-tie: SettingsPage tab bar), docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md.
