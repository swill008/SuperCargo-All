# SuperCargo FAQ

## Getting started

**What is SuperCargo?**
A free desktop app for Star Citizen haulers. It takes a pile of hauling contracts and
turns them into one plan: a combined manifest, box-size math, an ordered route, a 3D
loading guide, and your earnings per run.

**Is it really free?**
Yes. Free and open source, no cost, no ads, no account needed.

**How do I get it?**
Grab the latest build from the [Releases page](https://github.com/swill008/SuperCargo-All/releases).
There's a Windows installer (`...-Setup.exe`) and a portable zip (`...-Portable.zip`, unzip and run), plus an
experimental Linux AppImage.

**Windows / SmartScreen says it's unsafe. Is something wrong?**
No. The builds aren't code-signed (certificates are pricey for a free tool), so Windows
shows its generic "unknown app" warning. Click "More info", then "Run anyway". After that
the installer keeps itself updated.

**Does it run on Mac?**
Not yet. Windows is the main platform, with Linux as experimental.

## Safety and privacy

**Will this get me banned? Does it touch the game?**
No. SuperCargo never modifies, injects into, or automates Star Citizen. It only reads the
game's own log file to follow your contracts, the same read-only approach many community
tools use. It is not a cheat or a hack.

**How does it know about my contracts then?**
It watches the game log for hauling contract accepts, objectives, completions, and abandons
as they happen. Read-only, and it ignores everything else.

**What's the screen-capture / OCR feature?**
OCR stands for Optical Character Recognition, which reads text out of an image. The log
doesn't include max box size or reward, so SuperCargo can optionally read the mobiGlas
contract screen to fill those in for you to confirm. It's opt-in and only runs when you
ask it to.

**Does it send my data anywhere?**
By default, no. Nothing leaves your machine. There's a single opt-in setting to share
anonymized capture samples that help train the reader. It's off unless you switch it on,
and you can switch it back off anytime.

**Where's my data kept?**
Locally on your PC, in one folder: `%USERPROFILE%\SuperCargo-OtherModes` on Windows (`~/SuperCargo-OtherModes` on
Linux). Jobs, run history, learned places, logs and exports all live there. Settings → GENERAL → DATA FOLDER shows it,
opens it, and can move it: CHANGE… uses the folder you pick exactly as it is, copies your data in if it has none yet,
then asks you to restart. Uninstalling never deletes it.
Older builds kept their files in `%APPDATA%\SuperCargo`; this release starts fresh and leaves that folder alone.

**The app says "SuperCargo data can't be read". What now?**
One of its files is damaged (for example after a crash or a full disk). Choose **Reset and continue** and the app moves
all its files from the data folder into a `Moved for Repair` folder (named with the date and time) inside the data
folder, then starts with empty data. Your settings are kept, and nothing is deleted, so you can look at the old files or
attach them to a bug report. **Quit** closes the app without changing anything.
The same check runs when you pick a new data folder that already holds SuperCargo files: you get a warning with RESET
AND CONTINUE or CANCEL.

## Using it

**It says "cargo grid not optimized for this ship." What's that?**
Each ship's real cargo bays are hand-mapped so the 3D loading guide is accurate. Ships not
mapped yet show that warning and fall back to a basic layout. More are being added. If yours
is wrong or missing, let us know (see below).

**A cargo grid or ship stat looks wrong.**
Report it. Those fixes sync out to everyone automatically on the next data update, no
reinstall needed.

**What's StarStrings, and do I need it?**
Optional. If you run StarStrings, SuperCargo can also show blueprint chances and reputation.
Everything else works fine without it.

**How do updates work?**
The app checks for a new version when it starts (on by default; turn it off in Settings → GENERAL → UPDATES) and
whenever you press CHECK FOR UPDATES there. If there is one, a window opens with what's new in each version since yours.
The installed copy offers **Update Now**: it downloads with a progress bar, checks the download, then **Install and
Restart**. The portable zip offers **Open Release Page** instead. **Skip This Version** stops the start-up reminder for
that version (a newer one still shows). After updating, a short "Updated" note links to what's new.

**Where do ship, place and cargo-grid data come from?**
From the original SuperCargo author's data, refreshed in the background, so you don't reinstall for data fixes. The
Check for Updates window shows whether each file is up to date, was updated, or couldn't be downloaded or checked (the
app then keeps the copy it had), with a CHECK NOW button.

## Getting help

**Where do I report bugs, request features, or flag bad data?**
Open an [issue on GitHub](https://github.com/AquatikJustice/SuperCargo/issues), or join the
[community Discord](https://discord.gg/GyjvYRTJfk) and post in the matching channel. One item per report, and search first
so we skip duplicates.
