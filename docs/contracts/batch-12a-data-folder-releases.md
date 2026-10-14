<!-- Copy of the batch contract the lead gave the agents (CONTRACT13.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# Batch 12 contract: user data folder + Gremlin-style releases (user-approved). Lead owns this file.

Repo /home/user/sc-features, branch features. Rules: edit ONLY your files; no commits; no player names;
log `echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`; `npm run typecheck` before finishing.
Do NOT run npm run build (lead builds/tests at the end). Final report: files, exports, results, start/end clock times.

## User decisions
1 Data folder = %USERPROFILE%\SuperCargo (like Gremlin's %USERPROFILE%\Gremlin Platforms). 2 FRESH START: no migration from
%APPDATA%\SuperCargo; leave the old folder alone. 3 Outputs: Setup exe (installer) + Portable zip (standalone); drop the single
portable exe. 4 Publish from <fork-owner>/SuperCargo-All; release files named SuperCargo-OtherModes-<ver>-Setup.exe and
SuperCargo-OtherModes-<ver>-Portable.zip. Also approved: movable data folder (P2), updates like Gremlin (P5), installer like
Gremlin (P6: per-user, no admin, desktop shortcut optional and unticked, uninstall never touches user data).

## Paths (NEW src/main/paths.ts, agent paths-core writes it FIRST; everyone imports it)
```ts
export const DATA_FOLDER_NAME = 'SuperCargo'
export function defaultDataFolder(): string        // path.join(os.homedir(), 'SuperCargo')  (USERPROFILE on Windows)
export function dataFolder(): string               // settings.dataFolder if set and usable (exists or creatable, writable), else default; cached; mkdir -p
export function dataPath(...parts: string[]): string   // path.join(dataFolder(), ...parts), parent dirs created
export function settingsFile(): string             // ALWAYS path.join(defaultDataFolder(), 'settings.json') (like Gremlin's configuration.json)
export function cachePath(...parts: string[]): string  // app.getPath('userData') (Electron's hidden folder) for big re-downloadable caches
export function setDataFolderOverride(p: string | null): void  // used at boot after settings load (no import cycle with store.ts)
export function dataFolderStatus(): { folder: string; isDefault: boolean; fallback?: string }  // fallback = why the chosen one wasn't used
```
Electron's own userData stays where Electron puts it (Chromium caches, Local Storage); no app.setPath.
Placement:
- settings.json -> settingsFile() (default folder always).
- In dataFolder(): manifest.json, history.json, window-state.json, other-jobs.json, other-matches.json, other-bodies.json,
  other-uex-places.json, uex-*.json caches, game-data/, logs/ (supercargo.log, trace*.jsonl), ocr-samples/, other-ocr-session/,
  outbox/ + upload-queue.json, exports/ (default folder for the diagnostics and run-export save dialogs:
  dataPath('exports', name)).
- In cachePath(): tessdata/, ocr-model/ (large downloads).
Boot order: settings load from settingsFile() first, then setDataFolderOverride(settings.dataFolder ?? null), then everything else.

## Agents and files
- paths-core: NEW src/main/paths.ts; every src/main/* file that builds a userData path (store.ts, uex.ts, dataSync.ts, logger.ts,
  trace.ts, telemetry.ts, debugWindow.ts, ocr/onnxEngine.ts, ocr/samples.ts, ocr/tesseractEngine.ts, diagnostics.ts default
  save path, index.ts run-export default path + boot order). Logger may start before settings load: make it lazy or re-point
  after boot so logs land in the data folder.
- paths-other: src/other/main/{bodies,gameData,jobs,matchMemory,ocrSession,uex,whereAmI}.ts -> dataPath()/cachePath() (whereAmI
  tessdata -> cachePath('tessdata') same as the upstream engine).
- folder-ui: Settings → GENERAL new section "DATA FOLDER" in src/renderer/src/pages/SettingsPage.tsx (minimal): shows the current
  folder (+ "default" / fallback reason), buttons CHANGE… (folder picker), OPEN FOLDER, RESET TO DEFAULT. Changing: main copies
  the current data files into the new folder if it holds no SuperCargo data yet (never overwrite existing files), saves
  settings.dataFolder, then asks to restart (RESTART NOW). NEW src/main/dataFolderIpc.ts (IPC dataFolder:get / :choose / :reset /
  :open / :restart), wiring line in index.ts (coordinate: index.ts belongs to paths-core; send the lead the one line to add if
  needed), channels.ts + preload/index.ts (data-folder lines), AppSettings.dataFolder?: string in src/shared/types.ts.
- release: electron-builder.yml (appId space.supercargo.othermodes, productName SuperCargo-OtherModes; win targets nsis + zip only;
  nsis artifact `SuperCargo-OtherModes-${version}-Setup.${ext}`, zip `SuperCargo-OtherModes-${version}-Portable.${ext}`;
  perMachine false, oneClick false, allowToChangeInstallationDirectory true, deleteAppDataOnUninstall false; desktop shortcut
  optional and unticked via an NSIS include (build/installer.nsh) with a checkbox; remember the choice so a silent update
  keeps an existing shortcut; publish github owner <fork-owner> repo SuperCargo-All), package.json (scripts: dist = build + win
  nsis+zip, no publish), NEW .github/workflows/release-win.yml (workflow_dispatch with `publish` input; windows-latest; npm ci;
  version from package.json; require release-notes/<ver>.md; electron-vite build + electron-builder --win --publish never; check
  both files exist; upload Setup.exe, Portable.zip, latest.yml, *.blockmap; publish -> softprops/action-gh-release creating
  tag v<ver> release "SuperCargo-OtherModes <ver>" with the notes + a "How to install" section; else upload as workflow
  artifact), .github/workflows/release-linux.yml (names + repo only), NEW release-notes/README.md + release-notes/<current
  version>.md, NEW test/replay/release_checks.mjs (notes file exists and starts "## What's new in <ver>"; builder config
  targets/names/publish owner as decided), src/main/updater.ts (installed copy: as today, from the new repo; zip copy
  (no "Uninstall *.exe" next to process.execPath): no download, just "New version X available" with a link to the release
  page in the existing update UI).
- e2e-docs: test/replay/replay.mjs harness: app data files now live under <HOME>/SuperCargo (settings.json there too); keep
  Electron's userData path for anything Chromium; update every helper that reads/writes app files (setup, e.jobs, e.settings,
  memFile, log paths…). New scenario 'data-folder': files land in HOME/SuperCargo, not in Electron userData; settings.json in
  the default folder; CHANGE to another folder copies data + restart uses it; unreachable chosen folder falls back to default
  with the reason shown. Docs: README.md (downloads: Setup.exe / Portable.zip; where data lives; fresh start note),
  FAQ.md (data location), src/other/STANDALONE.md, docs/SYSTEM-MAP.md, docs/OTHER-MODE-AUDIT.md.

## ADDENDUM (user): release version "R1 1.0.0" (like Gremlin's "Gremlin-Platforms-R1-<ver>")
- package.json version becomes 1.0.0 (the app's semver; electron-updater compares it). The release line is R1.
- Files: SuperCargo-OtherModes-R1-1.0.0-Setup.exe and SuperCargo-OtherModes-R1-1.0.0-Portable.zip
  (artifactName `SuperCargo-OtherModes-R1-${version}-Setup.${ext}` / `-Portable.${ext}`); latest.yml must name the Setup file.
- Tag and release: tag `SuperCargo-OtherModes-R1-1.0.0`, release title "SuperCargo-OtherModes R1 1.0.0".
  electron-updater must still find updates (check it accepts this tag form; if it needs a v-prefixed semver tag, keep the
  GitHub release tag `v1.0.0` and put "R1" in the title and file names, and report which was used and why).
- release-notes/1.0.0.md starts with "## What's new in R1 1.0.0".
- The app's About/version line shows "R1 1.0.0".
