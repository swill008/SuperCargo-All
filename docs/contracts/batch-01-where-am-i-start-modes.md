<!-- Copy of the batch contract the lead gave the agents (CONTRACT.md), kept as a record. Game ids, zone ids and repo owner handles are replaced with placeholders; <scratchpad> and <session-files> paths were session-only and are not in the repo. -->

# WHERE AM I / start modes / multi-system — shared contract (lead owns this file)

Repo: /home/user/sc-features (branch `features`, <fork-owner>/SuperCargo-All). Electron + React + zustand + TS.
Read src/other/STANDALONE.md first (job rules). Never put player names/ids in code, tests or fixtures
(the handle in screenshots is PLAYER). Do NOT commit or push; the lead commits. Do not run the full
replay suite (lead runs it at the end). Typecheck: `npm run typecheck`. Log progress lines:
`echo "$(date +%H:%M)  <agent> <what>" >> /home/user/SuperCargo-activity.log`.
Edit ONLY the files you own. Need a change in someone else's file? Say so in your final report.

## Approved behaviour (user)
A. STARTING AT modes, setting `otherStartMode` ('auto' default | 'fixed') replaces `otherAutoStart` (removed; unreleased fork, no compat).
   - auto: the NEWER of (typed start, typed at `startTypedAt`) and the latest location clue (`where.at`) wins.
   - fixed: the typed start only; empty typed = no start.
   - AUTO/FIXED toggle replaces today's AUTO/PINNED toggle (writes the setting).
B. Location clues (each sets `where` with its source; newest wins in auto):
   B1 'tick': user ticks a step DONE / GO HERE / TURN IN -> that step's active place (before the tick changes it).
   B2 'objective': log Objective Complete ticks a step -> that step's place (log time).
   B3 'inventory': existing RequestLocationInventory / Update Inventory Location 'location' events.
   B4 quantum / ATC: DROPPED (no log line names the place).
   B5 UI shows the source: typed / tick / objective / inventory / map / display info.
C. WHERE AM I (map screen): hotkey `otherWhereHotkey` (default CommandOrControl+Shift+L) + ONE button on the
   overlay card's start line. One screenshot, two zones: zone 2 (r_DisplayInfo text, upper right) read first when
   `otherWhereUseZone2`; else/fallback zone 1 (map bottom line). Result -> `where` (source 'map' or 'displayinfo').
   Failure -> message "couldn't read the map, try again".
D. Multi-system + surface: distances are system-aware (gateways, "+ 1 jump"), sort by jumps then metres; same-body
   stops measured over the surface ("≈490 km surface").

## Types (already written by lead — implement, don't rename)
- src/other/otherGeo.ts: GeoPoint, Travel, travel(), compareTravel(), formatTravel()
- src/other/otherWhere.ts: WhereSource, Where, MapLine, DisplayInfo, parseMapLine, parseDisplayInfo,
  resolveMapLine, resolveDisplayInfo, WhereRunResult
- src/other/workMode.ts settings: otherStartMode, otherWhereHotkey, otherWhereZone1, otherWhereZone2, otherWhereUseZone2

## Doc / store fields (state agent)
OtherJobsDoc + store: replace `currentLocation` / `currentLocationAt` with `where?: Where | null`; add `startTypedAt?: string`
(ISO, set by setStartLocation when non-empty). Store action `applyWhere(w: Where)` (main window applies + saves; passive
window ignores). Where-events NEVER touch the log watermark (lastLogEventAt/Count). Inventory 'location' events with
name null: where -> null only if the current where.source is 'inventory'.

## resolveOrigin (geo agent, otherNext.ts) — new signature
```ts
resolveOrigin(o: { typed?: string; typedAt?: string; where?: Where | null; mode: 'auto' | 'fixed'; now?: number;
  locations: Location[] }): { name: string | null; label: string | null; point?: GeoPoint;
  kind: WhereSource | null; stale: boolean }
```
typed -> point from findRosterLocation (with system/body). where -> where.point, else roster lookup of where.name.
stale = non-typed and older than 5 min. listOpenStops gets `opts.origin?: GeoPoint` (used instead of looking up
startLocation when given). OpenStopRow gains `jumps?: number` and `surface?: boolean`; groups/route totals carry them.
noDistanceWhy gains 'no-gateway'.

## Gateways (data)
Location names "<Other> Gateway" with system = the system they sit in: Pyro Gateway (Stanton), Stanton Gateway (Pyro),
Nyx Gateway (Stanton), Stanton Gateway (Nyx), Nyx Gateway (Pyro), Pyro Gateway (Nyx). Ignore Terra/Magnus. Compare
systems case-insensitively. Each system's coords have its own star at the origin.

## Map / display info facts (verified with the user's screenshots)
- Map line: `SYSTEM [SYSTEM] > [BODY] > [PLACE] > lat° lon° distGM`, e.g. `STANTON SYSTEM > 0.00° 1.06° 12.47GM`,
  `STANTON > HURSTON > 0.00° 0.00° 12.85GM`. Star frame: x=r·cosLat·cosLon, y=r·cosLat·sinLon, z=r·sinLat.
  Accuracy ±5–10 Mm (distance truncated to 0.01 Gm). On a planet/moon it is the body centre. 0.00°/0.00° = ignore as a position.
  Most specific name wins; coords only cross-check (flag > 50 Mm gap in a debug log).
- r_DisplayInfo 3 (surface on Hurston):
  `Zone: OOC_Stanton_1_Hurston Pos: -663.0188km -725.4411km -190.4883km`
  `Zone: SolarSystem_<zone-id> Pos: 12850255.8664km 961.9598km -190.4883km`
  `Current player location : Stanton1`
  `Planet:OOC_Stanton_1_Hurston (working) (Load Complete)`
  `CamPos Planet Zone: -663018.807425 -725441.096333 -190488.315800`   (metres)
  `Radius: 1000000.000000 ElevationUnderCam: 1064.250000 Altitude 7.436596`
  -> Hurston centre (data) + planetPos lands 22.8 km from HDRSO-Stott; the game said 22.82 km. The solar line is
  rotated (planet spin) and must NOT be used for surface places.
- r_DisplayInfo 3 (open space): no `Zone: OOC_…` line;
  `Zone: SolarSystem_<zone-id> Pos: 12472406.2780km 231654.0188km -233.7737km`
  `Current player location : StantonSolarSystem`
  `Planet:OOC_Stanton_1_Hurston  (Load Complete)`
  `CamPos Planet Zone: -284885066.755108 -339744759.870347 -233773.703463`
  `Radius: 1000000.000000 ElevationUnderCam: 1348.062500 Altitude 442378915.108479`
  -> 443,380 km from Hurston; nearest place 376,000 km away = open space. Label "Open space · 443,380 km from Hurston".
- Use planetPos + body centre when altitude < 100 km (100000 m); else solarPos. Name = nearest roster place within
  50 km on a body / 100 km in space, else null. Label shows "<place> · <dist>" or "Open space · <dist> from <body>".
- Screenshots: <session-files>/images/ (9,10 = surface display info,
  11 = space display info, 12 = map in space; 5–8 earlier map shots: station, space, moon, planet).

## IPC (where-main agent owns main side + channels + preload; UI agents call these)
channels.ts (Other block): otherWhereRun 'otherWhere:run', otherWhereCalPreview 'otherWhere:calPreview',
otherWhereCalTest 'otherWhere:calTest', evtOtherWhere 'evt:other:where'.
preload (window.supercargo): otherWhereRun(): Promise<WhereRunResult>; otherWhereCalPreview(): Promise<string | null>;
otherWhereCalTest(zone: 1 | 2): Promise<WhereRunResult>; onOtherWhere(cb: (r: WhereRunResult) => Unsubscribe-style).
A run (hotkey or button) broadcasts evtOtherWhere to ALL windows; the main window's store calls applyWhere(r.where) when
ok; both windows may show the message. Test seam: env SC_WHERE_TEXT_FILE = path of JSON {"zone1"?: string, "zone2"?: string}
used instead of capture + OCR (same parse/resolve path after it).
Hotkey: whereAmI.ts exports registerOtherWhereHotkey(getSettings); upstream registerHotkey() calls globalShortcut.unregisterAll(),
so index.ts calls it at the end of registerHotkey() and re-runs registerHotkey() when patch.otherWhereHotkey changes
(re-tie points; docs agent records them in STANDALONE.md).
