// WHERE AM I parse/resolve check: bundles src/other/otherWhere.ts and feeds it the map bottom lines and
// r_DisplayInfo 3 blocks transcribed from real screenshots, plus OCR-noisy variants and garbage.
// Roster = data/uex/other-positions.json. Usage: node test/replay/where_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-where-'))
const outfile = path.join(tmp, 'otherWhere.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherWhere.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const W = await import(pathToFileURL(outfile).href)
const geofile = path.join(tmp, 'otherGeo.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherGeo.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: geofile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const G = await import(pathToFileURL(geofile).href)
fs.rmSync(tmp, { recursive: true, force: true })

const roster = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const AT = '2026-10-14T14:25:00.000Z'
const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'runs', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  }
}
const loc = (n) => roster.find((l) => l.name === n)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const j = (v) => JSON.stringify(v)

// Map bottom lines, exactly as on screen (screenshots 5, 6, 7, 8, 12).
const MAP = {
  station: 'STANTON > CRUSADER > SERAPHIM STATION > 0.01° -172.00° 19.15GM',
  space: 'STANTON SYSTEM > 0.00° -171.90° 19.17GM',
  moon: 'STANTON > CRUSADER > CELLIN > 0.00° -171.88° 19.17GM',
  planet: 'STANTON > HURSTON > 0.00° 0.00° 12.85GM',
  spaceNearHurston: 'STANTON SYSTEM > 0.00° 1.06° 12.47GM'
}

// r_DisplayInfo 3 blocks (screenshots 9 = Hurston surface, 11 = open space), the lines that matter plus neighbours.
const DI_SURFACE = `CamDir: 108 -57  170 FOV: 70 Focal: 3.00 FStop: 64.0
Zone: MISC_Hull_B 881455961181 Pos: -0.94m 26.40m 0.52m
Zone: OOC_Stanton_1_Hurston Pos: -663.0188km -725.4411km -190.4883km
Zone: SolarSystem_862399811847 Pos: 12850255.8664km 961.9598km -190.4883km
Zone: Root Pos: 12850255.8664km 961.9598km -190.4883km
FPS 50.3 [36..54], - 20.1ms [19.7ms]
Current player location : Stanton1
Planet:OOC_Stanton_1_Hurston (working) (Load Complete)
CamPos Planet Zone: -663018.807425 -725441.096333 -190488.315800
Radius: 1000000.000000 ElevationUnderCam: 1064.250000 Altitude 7.436596
XYPos: -913952.603423 -262582.740992 Page: 3 (-Y)`

const DI_SPACE = `Zone: MISC_Hull_B 881455961181 Pos: -0.94m 26.40m 0.52m
Zone: SolarSystem_862399811847 Pos: 12472406.2780km 231654.0188km -233.7737km
Zone: Root Pos: 12472406.2780km 231654.0188km -233.7737km
Current player location : StantonSolarSystem
Planet:OOC_Stanton_1_Hurston  (Load Complete)
CamPos Planet Zone: -284885066.755108 -339744759.870347 -233773.703463
Radius: 1000000.000000 ElevationUnderCam: 1348.062500 Altitude 442378915.108479
XYPos: -838526.776433 -688.086298 Page: 3 (-Y)`

safe('parseMapLine real', () => {
  const s = W.parseMapLine(MAP.station)
  check('parseMapLine real', 'station line', s?.system === 'Stanton' && s.body === 'CRUSADER' && s.place === 'SERAPHIM STATION' && s.latDeg === 0.01 && s.lonDeg === -172 && s.distGm === 19.15, j(s))
  const sp = W.parseMapLine(MAP.space)
  check('parseMapLine real', 'system-only line', sp?.system === 'Stanton' && sp.body === undefined && sp.place === undefined && sp.lonDeg === -171.9 && sp.distGm === 19.17, j(sp))
  const m = W.parseMapLine(MAP.moon)
  check('parseMapLine real', 'moon line', m?.body === 'CRUSADER' && m.place === 'CELLIN' && m.lonDeg === -171.88, j(m))
  const p = W.parseMapLine(MAP.planet)
  check('parseMapLine real', 'planet line', p?.system === 'Stanton' && p.body === 'HURSTON' && !p.place && p.latDeg === 0 && p.lonDeg === 0 && p.distGm === 12.85, j(p))
  const h = W.parseMapLine(MAP.spaceNearHurston)
  check('parseMapLine real', 'space near Hurston line', h?.system === 'Stanton' && h.lonDeg === 1.06 && h.distGm === 12.47, j(h))
})

safe('parseMapLine noisy', () => {
  const variants = [
    ['o for degree', 'STANTON SYSTEM > 0.00o 1.06o 12.47GM'],
    ['º and missing degree', 'STANTON SYSTEM > 0.00º 1.06 12.47GM'],
    ['› for >', 'STANTON SYSTEM › 0.00° 1.06° 12.47GM'],
    ['» and spaced unit', 'STANTON SYSTEM » 0.00* 1.06* 12.47 GM'],
    ['Gm lowercase', 'STANTON SYSTEM > 0.00° 1.06° 12.47Gm'],
    ['leading icon junk', '@ STANTON SYSTEM > 0.00° 1.06° 12.47GM'],
    ['comma decimals', 'Stanton System > 0,00° 1,06° 12,47gm'],
    ['multi-line OCR', 'MY LOCATION 2\nSTANTON SYSTEM > 0.00° 1.06° 12.47GM\n11,378,844']
  ]
  for (const [what, t] of variants) {
    const r = W.parseMapLine(t)
    check('parseMapLine noisy', what, r?.system === 'Stanton' && Math.abs(r.lonDeg - 1.06) < 1e-9 && Math.abs(r.distGm - 12.47) < 1e-9, j(r))
  }
  const pl = W.parseMapLine('9 STANTON › HURSTON › 0.00o 0.00o 12.85 GM')
  check('parseMapLine noisy', 'planet line with junk + ›', pl?.body === 'HURSTON' && pl.distGm === 12.85, j(pl))
  const py = W.parseMapLine('PYRO SYSTEM > 1.20° -45.00° 31.62GM')
  check('parseMapLine noisy', 'Pyro system name', py?.system === 'Pyro', j(py))
})

safe('garbage', () => {
  for (const t of ['', 'HOME HEALTH COMMS CONTRACTS MAPS', 'STANTON > CRUSADER', '0.00° 1.06° 12.47GM', 'SEARCH LOCATIONS...']) {
    const r = W.parseMapLine(t)
    check('garbage', `parseMapLine(${j(t)}) is null`, r === null, j(r))
  }
  for (const t of ['', 'FPS 50.3 [36..54]\nGraphics Renderer : Vulkan', 'Current player location : Stanton1']) {
    const r = W.parseDisplayInfo(t)
    check('garbage', `parseDisplayInfo(${j(t.slice(0, 30))}) is null`, r === null, j(r))
  }
})

safe('parseDisplayInfo', () => {
  const s = W.parseDisplayInfo(DI_SURFACE)
  check('parseDisplayInfo', 'surface system/body', s?.system === 'Stanton' && s.body === 'Hurston', j(s))
  check('parseDisplayInfo', 'surface planetPos from CamPos (m)', s?.planetPos && Math.abs(s.planetPos.x - -663018.807425) < 1e-3 && Math.abs(s.planetPos.z - -190488.3158) < 1e-3, j(s?.planetPos))
  check('parseDisplayInfo', 'surface solarPos km -> m', s?.solarPos && Math.abs(s.solarPos.x - 12850255866.4) < 1 && Math.abs(s.solarPos.y - 961959.8) < 1, j(s?.solarPos))
  check('parseDisplayInfo', 'radius / altitude', s?.radiusM === 1000000 && Math.abs(s.altitudeM - 7.436596) < 1e-9, `${s?.radiusM} ${s?.altitudeM}`)
  const sp = W.parseDisplayInfo(DI_SPACE)
  check('parseDisplayInfo', 'space system from StantonSolarSystem', sp?.system === 'Stanton' && sp.body === 'Hurston', j(sp))
  check('parseDisplayInfo', 'space solarPos', sp?.solarPos && Math.abs(sp.solarPos.x - 12472406278) < 1, j(sp?.solarPos))
  const noCam = W.parseDisplayInfo(DI_SURFACE.split('\n').filter((l) => !l.startsWith('CamPos')).join('\n'))
  check('parseDisplayInfo', 'planetPos falls back to OOC zone (km -> m)', noCam?.planetPos && Math.abs(noCam.planetPos.x - -663018.8) < 0.01, j(noCam?.planetPos))
  const moon = W.parseDisplayInfo('Zone: OOC_Stanton_1a_Arial Pos: 10.5km -20km 3km\nPlanet:OOC_Stanton_1a_Arial (Load Complete)')
  check('parseDisplayInfo', 'moon zone OOC_Stanton_1a_Arial', moon?.system === 'Stanton' && moon.body === 'Arial' && moon.planetPos?.y === -20000, j(moon))
  const noisy = W.parseDisplayInfo(
    'Zone: OOC Stanton 1 Hurston Pos: –663,0188km −725,4411km -190,4883km\nCurrent player location : Stanton 1\nPlanet:OOC Stanton 1 Hurston (working)\nCamPos Planet Zone: –663018.807425 - 725441.096333 -190488.315800\nRadius: 1000000,000000 ElevationUnderCam: 1064,25 Altitude 7,436596'
  )
  check('parseDisplayInfo', 'OCR noise (spaces for _, en-dash minus, comma decimals)', noisy?.body === 'Hurston' && noisy.system === 'Stanton' && Math.abs(noisy.planetPos?.y - -725441.096333) < 1e-3 && Math.abs(noisy.altitudeM - 7.436596) < 1e-9, j(noisy))
})

safe('resolveDisplayInfo', () => {
  const s = W.resolveDisplayInfo(W.parseDisplayInfo(DI_SURFACE), roster, AT)
  check('resolveDisplayInfo', 'Hurston surface -> HDRSO-Stott', s?.name === 'HDRSO-Stott' && s.source === 'displayinfo' && s.at === AT, j(s))
  check('resolveDisplayInfo', 'label shows 22.8 km', /HDRSO-Stott · 22\.8 km/.test(s?.label ?? ''), s?.label)
  check('resolveDisplayInfo', 'surface point carries system/body', s?.point?.system === 'Stanton' && s.point.body === 'Hurston' && s.body === 'Hurston', j(s?.point))
  const sp = W.resolveDisplayInfo(W.parseDisplayInfo(DI_SPACE), roster, AT)
  check('resolveDisplayInfo', 'open space -> name null', sp && sp.name === null, j(sp))
  const km = Number((/Open space · ([\d,]+) km from Hurston/.exec(sp?.label ?? '')?.[1] ?? '').replace(/,/g, ''))
  check('resolveDisplayInfo', 'label ~443,380 km from Hurston', Math.abs(km - 443380) <= 5, sp?.label)
  check('resolveDisplayInfo', 'space point = solarPos', sp?.point && Math.abs(sp.point.x - 12472406278) < 1 && sp.body === null, j(sp?.point))
})

safe('resolveMapLine', () => {
  const sp = W.resolveMapLine(W.parseMapLine(MAP.spaceNearHurston), roster, AT)
  const di = W.parseDisplayInfo(DI_SPACE).solarPos
  check('resolveMapLine', 'space map point within 10 Mm of display-info solar point', sp?.point && dist(sp.point, di) < 10e6, `${sp?.point && Math.round(dist(sp.point, di) / 1e3)} km`)
  check('resolveMapLine', 'space -> name null, open-space label from nearest body, source map', sp?.name === null && /^Open space · [\d,.]+ (km|Gm) from (Hurston|Ita|Arial|Aberdeen|Magda)$/.test(sp.label) && sp.source === 'map', sp?.label)
  const p = W.resolveMapLine(W.parseMapLine(MAP.planet), roster, AT)
  const H = loc('Hurston')
  check('resolveMapLine', 'Hurston 0/0 -> body Hurston point', p?.body === 'Hurston' && p.name === 'Hurston' && p.point && dist(p.point, H) < 1, j(p))
  const st = W.resolveMapLine(W.parseMapLine(MAP.station), roster, AT)
  check('resolveMapLine', 'station line -> Seraphim Station', st?.name === 'Seraphim Station' && st.label === 'Seraphim Station' && st.body === 'Crusader' && st.system === 'Stanton', j(st))
  const m = W.resolveMapLine(W.parseMapLine(MAP.moon), roster, AT)
  check('resolveMapLine', 'moon line -> Cellin', m?.name === 'Cellin' && m.body === 'Cellin', j(m))
  const s6 = W.resolveMapLine(W.parseMapLine(MAP.space), roster, AT)
  const cru = loc('Crusader')
  check('resolveMapLine', 'system-only near Crusader -> coords near Crusader', s6?.name === null && s6.point && dist(s6.point, cru) < 50e6, `${s6?.label}`)
  const zero = W.resolveMapLine({ system: 'Stanton', latDeg: 0, lonDeg: 0, distGm: 12.85 }, roster, AT)
  check('resolveMapLine', 'system-only 0/0 is no position', zero === null, j(zero))
})

// ---- batch 2: real OCR texts from the user's export, whole panel, accuracy ----
const REAL_NEAR_HURSTON = `Zone: MISC Hull B 881455961181 Pos: -0.94m 26.39m 0.52m

Zone: 00C Stanton 1 Hurston Pos: -500.7481km 922.8720km -1516.49m

Zone: SolarSystem 862321811808 Pos: 12849498.1180km 427.5609km -1516.49m
Zone: Root Pos: 12849498.,1180km 427.5609km -1516.49m

FPS 82.6 - 12.2ms [11.9ms]`

const REAL_SPACE_TOP3 = `Zone: MISC Hull B 881455961181 Pos: -2.91m 14.90m 0.56m

Zone: SolarSystem 862321811808 Pos: 12472406.2902km 231654.0157km -233.7724Km
~~ Zone: Root Pos: 12472406.2902km 231654.0157km -233.7724km

FPS 111.3 - 9.0ms [8.8ms]`

const REAL_SPLIT = `Zone: MISC Hull B 881455961181 Pos:

-2.91m 14.90m 0.56m

Zone: SolarSystem 862321811808 Pos: 12472406.2902km 231654.0157km -233.7724km
12472406.2902km 231654.0157km -233.7724Kkm`

// full panel (clean), surface on Hurston, ServerTime matching the read time
const FULL_AT = '2026-10-14T14:06:00.000Z'
const DI_FULL = `ServerTime: Wed Oct 14 14:05:05 2026
UniverseTime: Sun Sep 19 12:30:33 2990
Tracked mission : FTL_Courier_Stanton_Chlorine_Rank1_0 [6844f110-b18a-49ef-ae09-b9617767c5cd]
${DI_SURFACE}`

const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol

safe('real OCR texts', () => {
  const H = loc('Hurston')
  const C = loc('HDPC-Cassillo')
  const i1 = W.parseDisplayInfo(REAL_NEAR_HURSTON)
  check('real OCR texts', 'near Hurston: system Stanton, body Hurston, planet zone', i1?.system === 'Stanton' && i1.body === 'Hurston' && /Hurston$/.test(i1.planetZone ?? ''), j(i1))
  check('real OCR texts', 'near Hurston: per-number units (km/m)', i1?.planetPos && near(i1.planetPos.x, -500748.1, 0.01) && near(i1.planetPos.z, -1516.49, 1e-6), j(i1?.planetPos))
  check('real OCR texts', 'near Hurston: stray comma Root == SolarSystem', i1?.rootPos && near(i1.rootPos.x, 12849498118, 1) && near(i1.solarPos?.x, 12849498118, 1), j(i1?.rootPos))
  check('real OCR texts', 'near Hurston: ship zone', i1?.shipPos && near(i1.shipPos.y, 26.39, 1e-9) && i1.zones?.length === 4, j(i1?.shipPos))
  const w1 = W.resolveDisplayInfo(i1, roster, AT)
  const want = { x: H.x - 500748.1, y: H.y + 922872.0, z: H.z - 1516.49 }
  check('real OCR texts', 'near Hurston: point = Hurston centre + zone pos', w1?.point && dist(w1.point, want) < 1 && w1.body === 'Hurston' && w1.system === 'Stanton', j(w1?.point))
  check('real OCR texts', 'near Hurston: ~422 km from HDPC-Cassillo', w1?.point && near(dist(w1.point, C) / 1000, 422, 1.5), `${w1?.point && dist(w1.point, C) / 1000} km`)
  // no Radius line on this panel: "km up" = |pos| - radius; roster estimate for Hurston is ~1001 km -> 49 km up
  check('real OCR texts', 'near Hurston: label (roster estimate radius)', w1?.label === 'Hurston · 49 km up · 422 km from HDPC-Cassillo' && w1.name === null, w1?.label)
  // planet table radius (otherBodies) wins over the estimate
  const asked = []
  const table = (n) => { asked.push(n); return n === 'Hurston' ? 1_000_000 : null }
  const wt = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_NEAR_HURSTON), roster, AT, { bodyRadius: table })
  check('real OCR texts', 'near Hurston: table radius 1000 km -> 50 km up', wt?.label === 'Hurston · 50 km up · 422 km from HDPC-Cassillo' && asked.includes('Hurston'), `${wt?.label} asked=${asked}`)
  const wt2 = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_NEAR_HURSTON), roster, AT, { bodyRadius: () => 990_000 })
  check('real OCR texts', 'near Hurston: table radius 990 km -> 60 km up', /^Hurston · 60 km up · /.test(wt2?.label ?? ''), wt2?.label)
  const wn = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_NEAR_HURSTON), roster, AT, { bodyRadius: () => null })
  check('real OCR texts', 'near Hurston: table without the body -> estimate', wn?.label === w1?.label, wn?.label)
  check('real OCR texts', 'near Hurston: accuracy 10', w1?.accuracy === 10, j(w1?.accuracy))

  const i2 = W.parseDisplayInfo(REAL_SPACE_TOP3)
  check('real OCR texts', 'space top 3: parses with system null', i2 && i2.system === null && i2.body === null && near(i2.solarPos?.z, -233772.4, 0.01), j(i2))
  const w2 = W.resolveDisplayInfo(i2, roster, AT)
  check('real OCR texts', 'space top 3: ok, star-frame point, system null', w2?.point && near(w2.point.x, 12472406290.2, 1) && w2.system === null && w2.name === null, j(w2))
  check('real OCR texts', 'space top 3: open-space label from nearest body (all systems)', /^Open space · [\d,]+ km from \w+/.test(w2?.label ?? ''), w2?.label)
  check('real OCR texts', 'space top 3: accuracy 9, Root check recorded', w2?.accuracy === 9 && i2.checks?.some((c) => c.item === 'SolarSystem line == Root' && c.ok), j(i2?.checks))

  const i3 = W.parseDisplayInfo(REAL_SPLIT)
  check('real OCR texts', 'split layout: wrapped ship Pos numbers', i3?.shipPos && near(i3.shipPos.x, -2.91, 1e-9) && near(i3.shipPos.z, 0.56, 1e-9), j(i3?.shipPos))
  check('real OCR texts', 'split layout: SolarSystem line', near(i3?.solarPos?.y, 231654015.7, 0.01), j(i3?.solarPos))
  const w3 = W.resolveDisplayInfo(i3, roster, AT)
  check('real OCR texts', 'split layout: ok, accuracy 9', w3?.point && w3.accuracy === 9 && w3.system === null, j(w3))
})

safe('full panel', () => {
  const f = W.parseDisplayInfo(DI_FULL)
  check('full panel', 'zones (4) + ship/solar/root', f?.zones?.length === 4 && near(f.shipPos?.y, 26.4, 1e-9) && near(f.rootPos?.x, 12850255866.4, 1) && f.planetZone === 'OOC_Stanton_1_Hurston', j(f?.zones))
  check('full panel', 'planetPos from CamPos', near(f?.planetPos?.y, -725441.096333, 1e-6), j(f?.planetPos))
  check('full panel', 'radius / altitude / elevation', f?.radiusM === 1000000 && near(f.altitudeM, 7.436596, 1e-9) && near(f.elevationM, 1064.25, 1e-9), `${f?.radiusM} ${f?.altitudeM} ${f?.elevationM}`)
  check('full panel', 'XYPos', near(f?.xyPos?.x, -913952.603423, 1e-6) && near(f.xyPos.y, -262582.740992, 1e-6), j(f?.xyPos))
  check('full panel', 'player location + index', f?.playerLocation === 'Stanton1' && f.playerLocationIndex === 1, `${f?.playerLocation} ${f?.playerLocationIndex}`)
  check('full panel', 'ServerTime -> ISO UTC', f?.serverTime === '2026-10-14T14:05:05.000Z', f?.serverTime)
  check('full panel', 'UniverseTime raw', f?.universeTime === 'Sun Sep 19 12:30:33 2990', f?.universeTime)
  check('full panel', 'tracked mission', f?.trackedMission?.name === 'FTL_Courier_Stanton_Chlorine_Rank1_0' && f.trackedMission.id === '6844f110-b18a-49ef-ae09-b9617767c5cd', j(f?.trackedMission))
  const w = W.resolveDisplayInfo(f, roster, FULL_AT)
  check('full panel', 'resolves to HDRSO-Stott, accuracy 10', w?.name === 'HDRSO-Stott' && w.accuracy === 10 && /HDRSO-Stott · 22\.8 km/.test(w.label), j(w))
  const items = (f?.checks ?? []).map((c) => `${c.ok ? '+' : '-'}${c.item}`)
  check('full panel', 'checks: zone≈CamPos, radius+alt, index, ServerTime all pass', ['planet zone line ≈ CamPos', '|pos| ≈ radius + altitude', 'player location index agrees with body', 'ServerTime vs PC clock'].every((n) => items.includes(`+${n}`)), items.join(', '))
  // index disagrees (Stanton2 = Crusader) -> near step dropped, SolarSystem line used
  const bad = W.parseDisplayInfo(DI_FULL.replace('Stanton1\n', 'Stanton2\n'))
  const wb = W.resolveDisplayInfo(bad, roster, FULL_AT)
  check('full panel', 'index mismatch -> SolarSystem line, accuracy 9', wb?.accuracy === 9 && bad.checks?.some((c) => c.item === 'player location index agrees with body' && !c.ok), j(bad?.checks))
  // altitude over 100 km -> step 2
  const high = W.parseDisplayInfo(DI_FULL.replace('Altitude 7.436596', 'Altitude 250000'))
  const wh = W.resolveDisplayInfo(high, roster, FULL_AT)
  check('full panel', 'altitude > 100 km -> SolarSystem line', wh?.accuracy === 9 && wh.body === null, j(wh))
  // Solar != Root -> nothing usable -> null (caller falls back to the map line)
  const split = W.parseDisplayInfo('Zone: SolarSystem_1 Pos: 1000km 2000km 3000km\nZone: Root Pos: 9000km 2000km 3000km')
  check('full panel', 'SolarSystem != Root -> null', W.resolveDisplayInfo(split, roster, AT) === null, j(split?.checks))
  const rootOnly = W.resolveDisplayInfo(W.parseDisplayInfo('Zone: Root Pos: 12472406.2902km 231654.0157km -233.7724km'), roster, AT)
  check('full panel', 'Root alone is used', rootOnly?.accuracy === 9 && near(rootOnly.point?.x, 12472406290.2, 1), j(rootOnly))
})

safe('ServerTime staleness', () => {
  const f = W.parseDisplayInfo(DI_FULL)
  const fresh = W.resolveDisplayInfo(f, roster, '2026-10-14T14:06:30.000Z')
  check('ServerTime staleness', '85 s off -> accuracy stays 10', fresh?.accuracy === 10, j(fresh?.accuracy))
  const stale = W.resolveDisplayInfo(W.parseDisplayInfo(DI_FULL), roster, '2026-10-14T14:10:00.000Z')
  const sc = W.parseDisplayInfo(DI_FULL)
  W.resolveDisplayInfo(sc, roster, '2026-10-14T14:10:00.000Z')
  check('ServerTime staleness', '5 min off -> accuracy 7, check recorded', stale?.accuracy === 7 && sc.checks.some((c) => c.item === 'ServerTime vs PC clock' && !c.ok && /stale/.test(c.why)), j(sc.checks))
  const low = W.resolveDisplayInfo(W.parseDisplayInfo('ServerTime: Wed Oct 14 14:05:05 2026\nZone: Root Pos: 1km 2km 3km'), roster, '2026-10-14T18:00:00.000Z')
  check('ServerTime staleness', 'stale space read -> 9 - 3 = 6', low?.accuracy === 6, j(low?.accuracy))
  const noisy = W.parseDisplayInfo('ServerTime: Wed Oct l4 14:O5:05 2026\nZone: Root Pos: 1km 2km 3km')
  check('ServerTime staleness', 'OCR O/l in the time', noisy?.serverTime === '2026-10-14T14:05:05.000Z', noisy?.serverTime)
})

safe('tracked mission', () => {
  const g = W.parseDisplayInfo(`Tracked mission : FTL_Courier_Stanton_Chlorine_Rank1_0 [6844fl1O-b18a-49ef-ae09-b9617767c5cd]\n${DI_SPACE}`)
  check('tracked mission', 'garbled l/O in uuid -> normalised', g?.trackedMission?.id === '6844f110-b18a-49ef-ae09-b9617767c5cd' && g.trackedMission.name === 'FTL_Courier_Stanton_Chlorine_Rank1_0', j(g?.trackedMission))
  const p = W.parseDisplayInfo(`Tracked mission: Some_Job_0 (6844f110-b18a 49ef-ae09-b9617767c5cd\n${DI_SPACE}`)
  check('tracked mission', '( bracket, space in uuid, no closing bracket', p?.trackedMission?.id === '6844f110-b18a49ef-ae09-b9617767c5cd' && p.trackedMission.id.startsWith('6844f110'), j(p?.trackedMission))
})

safe('OCR tolerance', () => {
  for (const [what, sys] of [['Stantonl', 'Stanton'], ['Stanton1', 'Stanton'], ['StantonSolarSystem', 'Stanton'], ['Stanton|', 'Stanton'], ['PyroSolarSystem', 'Pyro'], ['Nyx2', 'Nyx'], ['STANTON SYSTEM', 'Stanton']]) {
    check('OCR tolerance', `knownSystem(${what})`, W.knownSystem(what) === sys, W.knownSystem(what))
  }
  const l = W.parseDisplayInfo(`Current player location : Stantonl\n${REAL_SPACE_TOP3}`)
  check('OCR tolerance', 'player location "Stantonl" -> Stanton, index 1', l?.system === 'Stanton' && l.playerLocationIndex === 1, j({ s: l?.system, i: l?.playerLocationIndex }))
  for (const z of ['OOC', '0OC', 'O0C', '00C']) {
    const r = W.parseDisplayInfo(`Zone: ${z}_Stanton_1_Hurston Pos: -500.7481 km 922.8720km -1.51649Km`)
    check('OCR tolerance', `${z} zone prefix`, r?.body === 'Hurston' && near(r.planetPos?.z, -1516.49, 1e-6), j(r))
  }
  const wrap = W.parseDisplayInfo('Zone: OOC Stanton 1 Hurston Pos:\n-500.7481km 922.8720km\n-1516.49m')
  check('OCR tolerance', 'planet zone Pos wrapped over two lines', near(wrap?.planetPos?.z, -1516.49, 1e-6) && near(wrap.planetPos.y, 922872, 1e-6), j(wrap?.planetPos))
  const stanton2 = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_NEAR_HURSTON.replace('00C Stanton 1', '00C Stantonl 1')), roster, AT)
  check('OCR tolerance', '"Stantonl" in the zone -> still Stanton / Hurston', stanton2?.system === 'Stanton' && stanton2.body === 'Hurston', j(stanton2))
})

safe('name matching', () => {
  const r = W.resolveMapLine({ system: 'Stanton', body: 'HURSTON', place: 'HDRSO-STOTT', latDeg: 0, lonDeg: 0, distGm: 12.85 }, roster, AT)
  check('name matching', 'map place -> accuracy 8', r?.name === 'HDRSO-Stott' && r.accuracy === 8, j(r))
  const b = W.resolveMapLine(W.parseMapLine(MAP.planet), roster, AT)
  check('name matching', 'map body -> accuracy 4', b?.accuracy === 4, j(b?.accuracy))
  const c = W.resolveMapLine(W.parseMapLine(MAP.spaceNearHurston), roster, AT)
  check('name matching', 'map coords -> accuracy 3', c?.accuracy === 3, j(c?.accuracy))
})

safe('accuracy', () => {
  const base = { name: null, label: 'x', system: 'Stanton', body: null, source: 'displayinfo', at: AT, accuracy: 10 }
  const t0 = Date.parse(AT)
  check('accuracy', 'fresh = 10', W.whereAccuracy(base, t0) === 10)
  check('accuracy', '4m59 = 10', W.whereAccuracy(base, t0 + 299_000) === 10)
  check('accuracy', '5 min = 9', W.whereAccuracy(base, t0 + 300_000) === 9)
  check('accuracy', '22 min = 6', W.whereAccuracy(base, t0 + 22 * 60_000) === 6)
  check('accuracy', 'never below 1', W.whereAccuracy(base, t0 + 10 * 3600_000) === 1)
  check('accuracy', 'typed -> null', W.whereAccuracy({ ...base, source: 'typed' }, t0) === null)
  check('accuracy', 'null / no accuracy -> 0', W.whereAccuracy(null, t0) === 0 && W.whereAccuracy(undefined) === 0 && W.whereAccuracy({ ...base, accuracy: undefined }, t0) === 0)
  const words = [10, 9, 8, 6, 5, 4, 3, 1, 0].map((n) => W.accuracyWord(n)).join(' ')
  check('accuracy', 'words', words === 'exact exact good good rough rough guess guess none', words)
  check('accuracy', 'ACCURACY table', W.ACCURACY.displayInfoBody === 10 && W.ACCURACY.displayInfoSpace === 9 && W.ACCURACY.mapPlace === 8 && W.ACCURACY.mapBody === 4 && W.ACCURACY.mapCoords === 3)
})

safe('surface arc radius', () => {
  const a = loc('HDPC-Cassillo')
  const b = loc('HDRSO-Stott')
  const H = loc('Hurston')
  const pa = { x: a.x, y: a.y, z: a.z, system: 'Stanton', body: 'Hurston' }
  const pb = { x: b.x, y: b.y, z: b.z, system: 'Stanton', body: 'Hurston' }
  const chord = dist(pa, pb)
  const arc = (r) => r * 2 * Math.asin(Math.min(1, chord / (2 * r)))
  const mean = (dist(pa, H) + dist(pb, H)) / 2
  const t0 = G.travel(pa, pb, roster)
  check('surface arc radius', 'no table -> mean of the two radii', t0?.surface && Math.abs(t0.meters - arc(mean)) < 1, `${t0?.meters} vs ${arc(mean)}`)
  const t1 = G.travel(pa, pb, roster, { bodyRadius: (n) => (n === 'Hurston' ? 800_000 : null) })
  check('surface arc radius', 'opts table radius used for r', t1?.surface && Math.abs(t1.meters - arc(800_000)) < 1 && Math.abs(t1.meters - t0.meters) > 100, `${t1?.meters} vs ${arc(800_000)}`)
  G.setBodyRadiusLookup((n) => (n === 'Hurston' ? 800_000 : null))
  const t2 = G.travel(pa, pb, roster)
  const ex = G.explainTravel(pa, pb, roster)
  G.setBodyRadiusLookup(null)
  check('surface arc radius', 'registered table lookup used (travel + explainTravel)', t2 && Math.abs(t2.meters - t1.meters) < 1e-6 && Math.abs(ex.meters - t1.meters) < 1e-6, `${t2?.meters} ${ex.meters}`)
  const t3 = G.travel(pa, pb, roster, { bodyRadius: () => null })
  check('surface arc radius', 'table without the body -> mean', t3 && Math.abs(t3.meters - t0.meters) < 1e-6, `${t3?.meters}`)
  const off = G.travel({ ...pa, body: 'Hurston' }, { ...pb, body: 'microTech' }, roster, { bodyRadius: () => 800_000 })
  check('surface arc radius', 'different bodies -> straight line', off && !off.surface && Math.abs(off.meters - chord) < 1e-6, j(off))
})

let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
