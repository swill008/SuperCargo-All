# <img src="assets/logo/SuperCargo-Logo.png" alt="SuperCargo logo" height="48" align="bottom"> SuperCargo

[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/GyjvYRTJfk)

A desktop app for Star Citizen haulers who stack a pile of contracts into one run.
It pulls everything into a single manifest: box-size math, a route that orders your
stops, a 3D loading guide, and per-run earnings, in a holographic mobiGlas-style
interface.

**New here? Read the [FAQ](FAQ.md). Questions, bugs, or feature ideas? Join the community on [Discord](https://discord.gg/GyjvYRTJfk).**

## Download

Grab the latest build (**R1 1.0.0**) from the [Releases page](https://github.com/swill008/SuperCargo-All/releases).

- **Windows installer** (`SuperCargo-OtherModes-R1-<version>-Setup.exe`) installs for your user only (no admin
  needed), lets you pick the install folder, and can update itself (see Updates below). The desktop shortcut is
  optional and unticked. Uninstalling never removes your data.
- **Windows portable** (`SuperCargo-OtherModes-R1-<version>-Portable.zip`) is the unpacked app: unzip it anywhere and
  run `SuperCargo-OtherModes.exe`. It doesn't update itself; it tells you when a new version is out and links to the
  release page.
- **Linux** (`SuperCargo-OtherModes-R1-<version>.AppImage`) make it executable and run it (see Linux notes below).

### Updates

The app checks for a new version once when it starts (you can turn that off: Settings → GENERAL → UPDATES, "Check for
updates at start-up"), and any time you press CHECK FOR UPDATES there. When a new version is out, a "Check for
Updates" window opens and shows what's new in every version since yours (newest first), with a link to the full
release notes on GitHub.

- **Update Now** (installed copy) downloads the update with a progress bar and checks the file before it is used.
  **Cancel**, or closing the window, stops the download (like Gremlin); Update Now starts it again.
  Then **Install and Restart** finishes it, or **Later** leaves a small "Update ready" bar so you can do it when it
  suits you. If the download fails, **Try Again** or open the release page.
- **Open Release Page** (portable copy) takes you to the download.
- **Skip This Version** stops the start-up reminder for that version. Checking by hand still shows it, and a newer
  version is offered as normal.

After an update the app shows "Updated — now R1 <version>" once, with a link to what's new.

The same window has a **Reference data** panel: ships, places, commodities, cargo grids and contract box sizes come from
the original SuperCargo author's data and are refreshed in the background. The panel shows each file's state (up to
date, updated, couldn't download, fingerprint didn't match, format not understood) and when it was last checked, with a
CHECK NOW button. If a download is bad, the app keeps the copy it had. Settings → UPDATES shows a warning line when a
file couldn't be updated.

### Where your data lives

Everything the app saves (jobs, history, learned places, logs, game data, exports) is in one folder in your user
folder: `%USERPROFILE%\SuperCargo-OtherModes` on Windows (for example `C:\Users\<you>\SuperCargo-OtherModes`),
`~/SuperCargo-OtherModes` on Linux. The installer and the portable copy share it, and uninstalling leaves it alone.

To keep it somewhere else, open Settings → GENERAL → DATA FOLDER and press CHANGE…. The folder you pick is used
exactly as it is (no extra folder is made inside it):

- if it holds no SuperCargo data yet, your current data is copied in (nothing is overwritten);
- if it already holds SuperCargo data that reads fine, that data is used;
- if it holds SuperCargo data that can't be read, a warning lists the damaged files. RESET AND CONTINUE moves the old
  files aside (see below) and copies your current data in; CANCEL keeps your current folder.

Then restart. RESET TO DEFAULT moves back, OPEN FOLDER shows it. Your settings (`settings.json`) always stay in the
default folder, so the app can find a moved folder. If the chosen folder can't be used (an unplugged drive, no write
access) the app runs on the default folder and says why in that section.

**Damaged data.** At start-up the app checks its files. If one can't be read, it asks before doing anything: **Reset
and continue** moves all SuperCargo files in the data folder into `Moved for Repair\<date and time>` inside that
folder (so you can look at them or send them with a bug report) and starts with empty data; your settings are kept.
**Quit** closes the app and changes nothing.

Large re-downloadable files (the OCR language data and model) stay in Electron's own app folder.

**Fresh start:** this release does not read or move anything from the folder older SuperCargo builds used
(`%APPDATA%\SuperCargo`); that folder is left as it was. Delete it yourself if you no longer need it.

The builds are not code-signed, so Windows SmartScreen may warn you on first run. Click
"More info", then "Run anyway".

### Linux notes

The Linux AppImage is **new and untested**, so treat it as experimental for now.

1. Make it executable: `chmod +x SuperCargo-OtherModes-*.AppImage` (or right-click, Properties, Allow executing).
2. Run it by double-clicking, or from a terminal: `./SuperCargo-OtherModes-*.AppImage`.
3. If it will not start, install FUSE: `sudo apt install libfuse2` on Debian/Ubuntu, or your
   distro's equivalent.

If you hit problems, please open an issue with your distro and what happened.

### Release notes

Each version's notes are in [`release-notes/`](release-notes/README.md) and become the "What's new" text in the update
window. They are written as the work is done: every batch of changes adds its lines to the next version's file. A
release can't go out without them: the release workflow and the test run both stop when the notes for the version are
missing, empty, still hold placeholders, or are a copy of the previous version's.

## Features

- **Automatic contract tracking.** Picks up hauling accepts, objectives, completions, and abandons
  from the game log as they happen.
- **Manifest.** Every active contract's cargo in one place, grouped by destination or by contract,
  with per-stop SCU and box totals and a live hold-capacity bar.
- **Guided loading.** One walk plans the whole load: what to grab at each stop, where it goes in the
  3D hold, and what to drop along the way. Drag any box anywhere at any step, and undo any move.
- **3D cargo grid.** A packed view of your hold, color-coded by destination, loaded in delivery
  order so you never dig one stop out from under another.
- **Current ship list.** New ships and their cargo grids come with the regular data updates, no new
  version needed.
- **Personal storage.** Park Stor-All crates in your hold; the planner packs and routes around them.
- **Off-grid cargo.** Carry loose boxes on a pad beside your bays and drag them on and off any time.
- **Route optimization.** Orders your stops to cut travel, and shows the run's total distance. Drag
  to override whenever you want.
- **OCR capture.** Reads the mobiGlas contract screen to fill in objectives, pickups, max box size,
  and reward for you to confirm. Can also scan the game log to catch contracts you accepted while
  the app was closed.
- **Multi-pickup contracts.** Every pickup on a split haul shows up as its own stop. The game only
  gives a total for these, so you enter what's actually waiting when you arrive, and the plan
  adjusts from there.
- **Community contract data.** Known contracts arrive with their box sizes already confirmed, no
  scan needed, and the list grows from anonymous community corrections.
- **Shared contracts.** Shares show up from the log with your split of the reward, and the full
  payout comes back automatically when the sharer leaves the contract.
- **Crew Mode (beta).** Start a crew and paste the code into chat. Everyone who joins sees your
  route, manifest, and cargo grid as you work, and can look around on their own. You see who's
  connected.
- **Edit anything.** Change a contract after you add it. Pickup, reward, rank, max box size, and
  each objective's commodity, amount, and destination are all editable inline.
- **Turn-in tracking.** On submit, record a full, partial, or no turn-in per stop, including partial
  payouts and the reputation line.
- **Runs and history.** Work is grouped into runs. One trip is one run. History keeps each run's
  contracts and earnings.
- **Compact overlay.** A small always-on-top "next stop" card you can pin over the game, with
  adjustable size, opacity, and corner. The card keeps the same height as you step between stops (long place names
  are cut short with "…"; hover for the full name), and reputation ranges show as "+100–500 REP". In Other mode, the height shown on the start line ("Hurston · 436 km up") is
  worked out from your position when the screen reading of the altitude is unclear.
- **StarStrings compatible.** When it's present, blueprint chances and reputation show up.

## Screenshots

Click any shot to view it full size.

<table>
  <tr>
    <td width="50%">
      <a href="assets/screens/manifest.png"><img src="assets/screens/manifest.png" alt="Cargo manifest grouped by destination" width="100%"></a>
      <br><sub><b>Manifest:</b> every contract's cargo, grouped by destination</sub>
    </td>
    <td width="50%">
      <a href="assets/screens/contracts.png"><img src="assets/screens/contracts.png" alt="Contracts page with inline editing" width="100%"></a>
      <br><sub><b>Contracts:</b> inline-edit anything the log did not capture</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="assets/screens/cargo-grid.png"><img src="assets/screens/cargo-grid.png" alt="3D cargo grid color-coded by destination" width="100%"></a>
      <br><sub><b>3D cargo grid:</b> color-coded by destination</sub>
    </td>
    <td width="50%">
      <a href="assets/screens/ocr-capture.png"><img src="assets/screens/ocr-capture.png" alt="OCR capture of a contract screen" width="100%"></a>
      <br><sub><b>OCR capture:</b> reads the mobiGlas contract screen</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="assets/screens/manual-entry.png"><img src="assets/screens/manual-entry.png" alt="Manual contract entry" width="100%"></a>
      <br><sub><b>Manual entry:</b> add a contract by hand</sub>
    </td>
    <td width="50%">
      <a href="assets/screens/history.png"><img src="assets/screens/history.png" alt="Run history with contracts and earnings" width="100%"></a>
      <br><sub><b>History:</b> past runs with their contracts and earnings</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="assets/screens/overlay.png"><img src="assets/screens/overlay.png" alt="Compact next-stop overlay" width="100%"></a>
      <br><sub><b>Compact overlay:</b> pin the next stop over the game</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Requirements

- Windows or Linux
- Star Citizen installed

## Privacy

SuperCargo runs on your PC. It sends a small **anonymous** usage snapshot on launch so we can
see roughly how many people use it and which features are worth developing. That snapshot is a
random device ID, app version, which OCR engine you use and how accurately it reads your
contracts, your screen resolution, the ships you haul with, and a few toggle settings. It never includes your contracts,
screenshots, or any personal information, and you can turn it off under **Settings -> Usage
Stats**. Everything else that leaves your machine (OCR training uploads) is strictly opt-in.

## Credits

Community data sources: [UEXcorp](https://uexcorp.space) (ships, commodities, locations,
distances), [sc-cargo.space](https://sc-cargo.space) and [Ratjack](https://ratjack.net/Star-Citizen/Cargo-Grids/)
(cargo-grid layouts), and [scunpacked](https://github.com/StarCitizenWiki/scunpacked-data)
(datamined reference). Thank you.

> ### Star Citizen - Made by the Community
>
> SuperCargo is an **unofficial** Star Citizen community tool. It is **not** endorsed by,
> sponsored by, or affiliated with Cloud Imperium Games or Roberts Space Industries.
>
> Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered
> trademarks of Cloud Imperium Rights LLC. All game content and related marks are the property
> of Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd. See the
> [Star Citizen Fankit](https://robertsspaceindustries.com/en/fankit) and the Fankit & Fandom
> FAQ for community-use guidelines.
>
> The **"Made by the Community"** badge is an official Fankit asset, included under those
> guidelines in [`assets/MBTC-logos/`](assets/MBTC-logos/) (the app loads it from
> `src/renderer/public/made-by-community.png`). The Settings -> ABOUT panel always shows the
> text attribution above.
