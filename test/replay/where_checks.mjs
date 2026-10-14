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
  // batch 6 (B3): near a body the star-frame lines are not used -> null
  const bad = W.parseDisplayInfo(DI_FULL.replace('Stanton1\n', 'Stanton2\n'))
  const wb = W.resolveDisplayInfo(bad, roster, FULL_AT)
  check('full panel', 'index mismatch near a body -> null (no SolarSystem fallback)', wb === null && bad.checks?.some((c) => c.item === 'player location index agrees with body' && !c.ok) && bad.checks.some((c) => c.item === 'position' && !c.ok && /near Hurston but the body position failed/.test(c.why)), j(bad?.checks))
  check('full panel', 'sane screen altitude kept (O3: source screen)', f?.altitudeSource === 'screen' && near(f.altitudeComputedM, 1071.7, 1), `${f?.altitudeSource} ${f?.altitudeComputedM}`)
  // O3: a screen altitude of 250 km while the position says ~1 km is garbled -> computed from position, body path kept
  const high = W.parseDisplayInfo(DI_FULL.replace('Altitude 7.436596', 'Altitude 250000'))
  const wh = W.resolveDisplayInfo(high, roster, FULL_AT)
  check('full panel', 'garbled altitude > 100 km -> computed from position, still HDRSO-Stott', wh?.name === 'HDRSO-Stott' && wh.accuracy === 10 && high.altitudeSource === 'computed' && high.checks.some((c) => c.item === 'altitude from position'), j(wh))
  // Solar != Root -> nothing usable -> null (caller falls back to the map line)
  const split = W.parseDisplayInfo('Zone: SolarSystem_1 Pos: 1000km 2000km 3000km\nZone: Root Pos: 9000km 2000km 3000km')
  check('full panel', 'SolarSystem != Root -> null', W.resolveDisplayInfo(split, roster, AT) === null, j(split?.checks))
  const rootOnly = W.resolveDisplayInfo(W.parseDisplayInfo('Zone: Root Pos: 12472406.2902km 231654.0157km -233.7724km'), roster, AT)
  check('full panel', 'Root alone is used', rootOnly?.accuracy === 9 && near(rootOnly.point?.x, 12472406290.2, 1), j(rootOnly))
})

// O3: altitude from position. Made-up panel 436 km above Hurston (CamPos = 1,436 km along (0.6, 0.8, 0)).
safe('altitude from position', () => {
  const H = loc('Hurston')
  const P = { x: 861600, y: 1148800, z: 0 }
  const kmS = (m) => `${(m / 1000).toFixed(4)}km`
  const panel = (altLine, extra = '') => `Zone: OOC_Stanton_1_Hurston Pos: ${kmS(P.x)} ${kmS(P.y)} ${kmS(P.z)}
${extra}Current player location : Stanton1
Planet:OOC_Stanton_1_Hurston (working) (Load Complete)
CamPos Planet Zone: ${P.x}.000000 ${P.y}.000000 ${P.z}.000000
Radius: 1000000.000000 ElevationUnderCam: 0.000000 ${altLine}`
  const run = (text, opts) => {
    const i = W.parseDisplayInfo(text)
    return { i, w: i && W.resolveDisplayInfo(i, roster, AT, opts) }
  }
  // garbled small value (decimal point misread): was null (|pos| ≈ radius + altitude failed)
  const g = run(panel('Altitude 43.6'))
  check('altitude from position', 'garbled 43.6 m -> "Hurston · 436 km up"', /^Hurston · 436 km up\b/.test(g.w?.label ?? '') && g.i.altitudeSource === 'computed' && near(g.i.altitudeComputedM, 436000, 1), `${g.w?.label} ${g.i?.altitudeSource}`)
  // garbled big value: was "> 100 km -> SolarSystem line" (open space)
  const b = run(panel('Altitude 4360000000.0'))
  check('altitude from position', 'garbled 4,360,000 km -> "Hurston · 436 km up"', /^Hurston · 436 km up\b/.test(b.w?.label ?? '') && b.i.altitudeSource === 'computed', `${b.w?.label}`)
  // unreadable / missing
  const m = run(panel('Altitude'))
  check('altitude from position', 'missing -> "Hurston · 436 km up", source computed', /^Hurston · 436 km up\b/.test(m.w?.label ?? '') && m.i.altitudeSource === 'computed', `${m.w?.label} ${m.i?.altitudeSource}`)
  // no Radius line: planet table radius (exact)
  const t = run(panel('Altitude 43.6').replace('Radius: 1000000.000000 ', ''), { bodyRadius: (n) => (n === 'Hurston' ? 1_000_000 : null) })
  check('altitude from position', 'no Radius line, table radius -> 436 km up', /^Hurston · 436 km up\b/.test(t.w?.label ?? '') && t.i.altitudeSource === 'computed', `${t.w?.label}`)
  // sane and agreeing within 5 km (ground 3 km high): screen value kept, the existing > 100 km rule still applies
  const solar = `Zone: SolarSystem_1 Pos: ${kmS(H.x + P.x)} ${kmS(H.y + P.y)} ${kmS(H.z)}\nZone: Root Pos: ${kmS(H.x + P.x)} ${kmS(H.y + P.y)} ${kmS(H.z)}\n`
  const s = run(panel('Altitude 433000.0', solar))
  check('altitude from position', 'screen 433 km agrees (within 5 km) -> kept, > 100 km -> SolarSystem line', s.i?.altitudeSource === 'screen' && s.w?.accuracy === 9 && s.w.body === null, `${s.i?.altitudeSource} ${j(s.w)}`)
  // near the ground: screen 2 km, position 2.5 km -> screen kept for the label
  const lowP = { x: 601500, y: 802000, z: 0 }
  const low = W.parseDisplayInfo(`Zone: OOC_Stanton_1_Hurston Pos: ${kmS(lowP.x)} ${kmS(lowP.y)} 0km\nPlanet:OOC_Stanton_1_Hurston\nCamPos Planet Zone: ${lowP.x} ${lowP.y} 0\nRadius: 1000000 Altitude 2000.0`)
  const wl = W.resolveDisplayInfo(low, roster, AT)
  check('altitude from position', 'screen 2.0 km vs 2.5 km from position -> screen kept', low?.altitudeSource === 'screen' && /· 2,?0?00 m up|· 2 km up/.test(wl?.label ?? ''), `${wl?.label} ${low?.altitudeSource}`)
  // garbled position (inside the body): the altitude is not replaced, the old check still rejects the read
  const inside = W.parseDisplayInfo(panel('Altitude 436000.0').replaceAll(kmS(P.x), '86.1600km').replaceAll(kmS(P.y), '114.8800km').replace(`${P.x}.000000 ${P.y}.000000`, '86160.000000 114880.000000'))
  const wi = W.resolveDisplayInfo(inside, roster, AT)
  check('altitude from position', 'position inside the body -> not used to fix the altitude', wi === null && inside?.altitudeSource !== 'computed' && inside.checks.some((c) => c.item === 'altitude from position' && !c.ok), `${j(wi)} ${j(inside?.checks)}`)
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

safe('resolver hook', () => {
  // the one resolver decides place names: a learned/user answer applies, an unsure one does not
  const stott = loc('HDRSO-Stott')
  const learned = (t) => ({ text: t, label: 'HDRSO-Stott', match: stott, status: 'user', confidence: 10, evidence: [], candidates: [], source: 'roster', memoryKey: t })
  const unsure = (t) => ({ text: t, label: t, match: stott, status: 'unsure', confidence: 3, evidence: [], candidates: [], source: null, memoryKey: t })
  const line = { system: 'Stanton', body: 'HURSTON', place: 'STOTT PLACE', latDeg: 0, lonDeg: 0, distGm: 12.85 }
  const r = W.resolveMapLine(line, roster, AT, learned)
  check('resolver hook', 'map place via resolve (user entry) -> HDRSO-Stott, accuracy 8', r?.name === 'HDRSO-Stott' && r.accuracy === 8 && r.body === 'Hurston', j(r))
  const u = W.resolveMapLine(line, roster, AT, unsure)
  check('resolver hook', 'unsure resolver answer is not used -> body Hurston', u?.name === 'Hurston' && u.accuracy === 4, j(u))
  let asked = []
  const spy = (t) => (asked.push(t), unsure(t))
  W.resolveDisplayInfo(W.parseDisplayInfo(DI_SURFACE), roster, AT, { resolve: spy })
  check('resolver hook', 'display info: known body found by findBody, resolver not needed', asked.length === 0, j(asked))
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

// ---- batch 6: real raw zone2 texts from WHERE AM I HISTORY (export 2026-10-14 12:02), at Covalex S1DC06 on Hurston ----
const HIST = [
  { at: "2026-10-14T16:58:20.008Z", was: "Rappel · 46.4 km", text: "-17.32m 6.30m\nkm 671.0478Kkm\nkm 671.0478Km\n\n\\     Zone: int s1 dclcvlx s1dco6 Pos: -41.6\nZon   00C Stanton 1 Hurston Pos: 743.1541km 15.55\n862321811808 Pos: 12850766.4244km -675.89\nZone: Root Pos: 12850766.4244km -675.8950km 671.0478km\nFPS 63.7 - 15.8ms [15.5ms]\n\n=                    Phys: 0.0ms Stall: 390.8fs Event: 0.0ms\n&&rver FPS 5.3 [3,8.)7.6] - 186.9ms [131.7..260%], Hitches: 1\nha-4102-12913470-game-178, restarts 0, pop. [shard 483, srv 80]\nNet: ping 42.5ms, loss 0.0% BwIn 93.684kbps, BwOut 38.536kbps\n2a         RL: eptitfies: 53862, tick: 0.06ms,   Sync: 0.28ms\n\n\\   ServerTime: Wed Oct 14   :58:20 2026\n\n|   UniverseTime: Mon Sep 20 05:50:03 2990\n\nWorking Set (0S): 18.08 GiB Committed (0S)#F 41.14 GiB\nender: MT: 15.5ms RT: 3.8msRGPU: 8.4ms\n\n.                     \\                            Graphics Renderer : Vulkan (DLSS-57%)\n\nt player location :  ——— lb=ne siydys (LZ gS ant nl DistributionCentre Covalex S1DC06)\n\n~ Rlanet:00C Stanton 1 Hurston (working) (Load Complete)\nCamPos Planet Zone: 743154.0 5029 15554.289546 671047 .838195\nRadius: 1000000.000000 ElevationUnder am; 1368.875000 Altitude 42.672056\nXYPos: 20930.101407 902972.696592 Page: 0 (4X)\n\\   Virtual Terrain Cache: Disabled\nEntities: 91612, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\n                                \\       Component updates:   31242, Events handled:     873\nME                                             Game: 0.00ms\nA\n\nog\n> =\n" },
  { at: "2026-10-14T16:59:04.290Z", was: "Covalex Distribution Centre S1DC06 · 272 m", text: "Zone: int sl dc_cvlx sldc66 Pos: 31.37m -27.54m 4.98m\n\nZone: 00C Stanton 1 Hurston Pos: 743.1039km 15.5635km 671.1012km\n\nZone: SolarSystem 862321811808 Pos: 12850787.6470km -665.7174km 671.1012km\nZone: Root Pos: 12850787.6470km -665.7174km 671.1012Km\n\nJ                                     FPS 64.6 - 15.6ms [15.1ms]\n\nF                                             Phys: 0.0ms Stall: 227.6ms Event: 0.0ms\nServer EPS 6:90 5:6..7.7] - 145.5ms™i30Ebrrydsvidy Hitches: ©\n\nserver(@h-useio- sc-atpha-102-12913070-game 173, restarts 0, pop. [shard 481, srv 78]\nNet: ping 63.2ms, loss 0.0% BwIn 102.518kbps, BwOut 35.067kbps\n\nJ                      RL: entities: 53862, tick: 0.06ms, MTSync: 0.43ms\n\nNE——                            ServerTime: Wed Oct 14 16:59:05 2026\nUniverseTime: Mon Sep 20 05:54:33 2990\n\nWorking Set (0S): 13.07 GiB Committed (0S): 40.85 GiB\n\nRender: MT: 15.2ms RT: 4.0ms GPU: 9.0ms\n\nGraphics Renderer : Vulkan (DLSS-57%)\n\nt player location : Stantonl DistributionCentre_Covalex S1DCO6 (LZ : Stantonl DistributionCentre_Covalex_ S1DC06)\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nCamPos Planet Zone: 743103.921488 15563.466321 671101.163797\n\nRadius: 1000000.000000 ElevationUnderCam: 1369.562500 Altitude 40.658970\n\nXYPos: 20943.861843 903105.434379 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91612, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: ©, QdSOC: ©\nComponent updates:   31879, Events handled:     883\n\nGame: 0.00ms\nJ\n" },
  { at: "2026-10-14T16:59:52.738Z", was: "Open space", text: "t player location\n\nZone: int sl dc cvlx sldcO6 Pos: 43.91m 120.61m 4.99m\n\nZone: 00C Stanton 1 Hurston Pos: 743.0986km 15.4152km 671.1105km\n\nZone: SolarSystem 862321811808 Pos: 12850808.5268km -654.9255km 671.1105Kkm\nZone: Root Pos: 12850808.5268km -654.9255km 671.1105km\n\n____eesmem                                     EESTA5.5 - 922 25 Z1=6ms |\n\na                                               Phys: 0.0ms Stall: 0.0ms Event: 0.0ms\nServer FPS 10.6 [10.3..10.8] - 94.1ms [92.4..96.9], Hitches: ©\n\nserver@-useio- sc-stpha-4102-12913470-game 178, restarts 0, pop. [shard 478, srv 78]\nNet: ping 55.3ms, loss 0.0% BwIn 158.132kbps, BwOut 34.775kbps\n\n)                      RL: entities: 53862, tick: 0.07ms, MTSync: 3.14ms\nWEm———                            ServerTime: Wed Oct 14 16:59:50 2026\nUniverseTime: Mon Sep 20 05:59:04 2990\n\nWorking Set (0S): 13.11 GiB Committed (0S): 41.38 GiB\n\nRender: MT: 21.6ms RT: 8.9ms GPU: 11.9ms\n\nGraphics Renderer : Vulkan (DLSS-57%)\n\n: Stantonl DistributionCentre_ Covalex S1DCO6 (LZ : Stantonl DistributionCentre_ Covalex S1DC06)\n\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nCamPos Planet Zone: 743098.607798 15415.178456 671110.471692\n\nRadius: 1000000.000000 ElevationUnderCam: 1380.375000 Altitude 29.847563\n\nXYPos: 20744.459042 903124.343449 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91611, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: ©, QdSOC: ©\nComponent updates:   31374, Events handled:     988\n\nGame: 0.00ms\n" },
  { at: "2026-10-14T17:00:36.179Z", was: "Open space", text: "t player location :\n\nZone: 00C Stanton 1 Hurston Pos: 743.1241km 15.3529km 671.0835km\n\nZone: SolarSystem 862321811808 Pos: 12850829.1394km -643.4676km 671.0835km\nZone: Root Pos: 12850829.1394km -643.4676km 671.0835km\n\nEPS OE hms [24 6ms|\n\nEEE                                 Phys: 0,0ms Stall: 176.0ms Event: 0.0ms\n\n‘3                      Servers EERSH Bre ZEn 9B 1155 6ms [[110.9,.122.3], Hitches: ©\n“TH sc-alpha-4102-12913470-game-178, restarts 0, pop. [shard 477, srv 80]\nNet: ping 52.8ms, loss 0.0% BwIn 131.886kbps, BwOut 42.,038kbps\n\nRL: entities: 53837, tick: 0.13ms, MTSync: 1.38ms\n\n|                                   ServerTime: Wed Oct 14 17:00:35 2026\n\nEa                                   UniverseTime: Mon Sep 20 06:03:35 2990\nWorking Set (0S): 13.20 GiB\\ Committed (0S): 41.32 GiB\n\nRender: Mi: 24.7ms RT: 10.7ms GPU: 13.,7ms\n\nGraphics Renderer : Vulkan (DLSS-57%)\n\nStantonl DistributionCentre_ Covalex S1DC06 (LZ : Stantonl DistributionCentre_Covalex S1DCO06)\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nRadius: 1000000.000000 ElevationUnderCam: 1383.937500 Altitude 26.144423\nXYPos: 20659.993258 903057.146818 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91586, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\nComponent updates:   32113, Events handled:     941\n\nGame: 0.00ms\n" },
  { at: "2026-10-14T17:01:16.751Z", was: "Covalex Distribution Centre S1DC06 · 305 m", text: "Zone: 00C Stanton 1 Hurston Pos: 743.1241km 15.3531km 671.0834km\n\nZone: SolarSystem 862321811808 Pos: 12850849.7228km -631.1189km 671.0834km\n\n~~ Zone: Root Pos: 12850849.7228km -631.1189km 671.0834km\n\nEPSESORAR-m hms: [25 1ms:]\n\neam                               Phys: 0.0ms Stall: 1002.5ms Event: 0.0ms\n\n'7i                      Seve ERS BRORIBE Zr Dad = i2r3ms: [97 5m 1224.5], Hitches: ©\nCE er ng as ome restarts 0, pop. [shard 476, srv 81]\n\nNet: ping 49.5ms, loss 0.0% BwIn 63.834kbps, BwOut 23.749Kkbps\nRL: entities: 53837, tick: 0.09ms, MTSync: 2.45ms\n\nServerTime: Wed Oct 14 17:01:21 2026\n\nUniverseTime: Mon Sep 20 06:08:10 2990\n\nPOET           Working Set (0S): 12.82 GiB Committed (0S): 41.33 GiB\n\nARKEUET                 9            Renders Mis 25L Ams Riz OLw/ms GRU 131, 4ms\n\n=                                             Graphics Renderer : Vulkan (DLSS-57%)\n\nt player location : Stantonl DistributionCentre_Covalex S1DCO6 (LZ : Stantonl DistributionCentre Covalex S1DC06)\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nRadius: 1000000.000000 ElevationUnderCam: 1383.937500 Altitude 26.144513\n\nXYPos: 20660.172216 903056.989349 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91586, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\n\nComponent updates:   31523, Events handled:    1712\nGame: 0.00ms\n" },
]

const hist = (k) => HIST.find((h) => h.at.slice(11, 19) === k)
const covalexM = (w) => (w?.name === 'Covalex Distribution Centre S1DC06' ? Number(/ · (\d+) m$/.exec(w.label)?.[1]) : NaN)

safe('real history (batch 6)', () => {
  // B1: garbled system words are unknown, not title-cased
  for (const g of ['Zone', 'Zope', 'Stantepl']) check('real history (batch 6)', `knownSystem(${g}) -> ''`, W.knownSystem(g) === '', j(W.knownSystem(g)))
  const castra = W.parseMapLine('CASTRA SYSTEM > 1.20° -45.00° 31.62GM')
  check('real history (batch 6)', 'map line with an unknown system keeps it (title-cased)', castra?.system === 'Castra', j(castra))

  // 16:58:20 "Rappel · 46.4 km": no planet line, CamPos garbled, no body -> null (Root line not used near a body)
  const r = hist('16:58:20')
  const ri = W.parseDisplayInfo(r.text)
  const rw = ri && W.resolveDisplayInfo(ri, roster, r.at)
  check('real history (batch 6)', '16:58:20 garbled read near a body -> null (was Rappel)', rw === null, j(rw))
  check('real history (batch 6)', '16:58:20 check says why', ri?.checks?.some((c) => c.item === 'position' && !c.ok && /^near a body but the body position failed: star-frame lines not used on a planet$/.test(c.why)), j(ri?.checks))

  // 16:59:52 and 17:00:36 "Open space": "player location" line read the next "Zone" as the system
  for (const k of ['16:59:52', '17:00:36']) {
    const h = hist(k)
    const i = W.parseDisplayInfo(h.text)
    check('real history (batch 6)', `${k} system Stanton (not "Zone")`, i?.system === 'Stanton' && i.body === 'Hurston', j({ s: i?.system, b: i?.body }))
    const w = W.resolveDisplayInfo(i, roster, h.at)
    const m = covalexM(w)
    check('real history (batch 6)', `${k} -> Covalex S1DC06 250-320 m, accuracy 10 (was Open space)`, m >= 250 && m <= 320 && w.accuracy === 10 && w.body === 'Hurston' && w.system === 'Stanton', `${w?.label} acc=${w?.accuracy}`)
  }

  // 17:01:16 already right: unchanged
  const u = hist('17:01:16')
  const uw = W.resolveDisplayInfo(W.parseDisplayInfo(u.text), roster, u.at)
  check('real history (batch 6)', '17:01:16 unchanged: Covalex S1DC06 · 305 m, accuracy 10', uw?.label === 'Covalex Distribution Centre S1DC06 · 305 m' && uw.accuracy === 10, `${uw?.label} acc=${uw?.accuracy}`)

  // B2: system misread as another known system -> the body is found across all systems
  const g = hist('16:59:04')
  const gi = W.parseDisplayInfo(g.text)
  gi.system = 'Pyro'
  const gw = W.resolveDisplayInfo(gi, roster, g.at)
  const gm = covalexM(gw)
  check('real history (batch 6)', '16:59:04 with system misread as Pyro -> Hurston found in Stanton, Covalex 250-320 m', gm >= 250 && gm <= 320 && gw.system === 'Stanton' && gw.accuracy === 10, `${gw?.label} sys=${gw?.system}`)

  // space (not near a body) keeps the SolarSystem path
  const sp = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_SPACE_TOP3), roster, AT)
  check('real history (batch 6)', 'space read keeps the SolarSystem line (accuracy 9)', sp?.accuracy === 9 && sp.name === null, j(sp?.label))
})

// ---- WHERE AM I names the place: station -> POI -> planet (within 100 km) -> open space ----
// The user's real station panel (Seraphim Station hangar, RR_CRU_LEO).
const DI_STATION = `Zone: Hangar MediumFront RestStop 878945478212 Pos: 7.42m -125.91m 7.98m
Zone: rs ext cru-leol Pos: -2536.72m -534.32m -51.02m
Zone: 00C Stanton 2 Crusader Pos: 5873.5499km -1384.6519km 5566.0595km
Zone: SolarSystem 874535716059 Pos: -18960653.6168km -2659120.6337km 5566.0595km
Zone: Root Pos: -18960653.6168km -2659120.6337km 5566.0595km
Current player location : RR_CRU LEO (LZ : RR_CRU_LEO)
Planet:00C Stanton 2 Crusader (working) (Load Complete)
CamPos Planet Zone: 5873549.901329 -1384651.879383 5566059.478207
Radius: 7450010.000000 ElevationUnderCam: 2.500000 Altitude 759547.012265`

safe('place naming', () => {
  const ST = 'Seraphim Station' // RR_CRU_LEO = Crusader's LEO station (otherSiteCodes LEO table)
  check('place naming', `roster has ${ST}`, !!loc(ST), '')
  const solar = { x: -18960653616.8, y: -2659120633.7, z: 5566059.5 }
  const station = (what, text, hangar) => {
    const i = W.parseDisplayInfo(text)
    check('place naming', `${what}: playerLocationCode RR_CRU_LEO`, i?.playerLocationCode === 'RR_CRU_LEO', j(i?.playerLocationCode))
    check('place naming', `${what}: inHangar ${hangar}`, !!i?.inHangar === hangar, j({ inHangar: i?.inHangar, stationZone: i?.stationZone }))
    const w = i && W.resolveDisplayInfo(i, roster, AT)
    const want = hangar ? `${ST} (hangar)` : ST
    check('place naming', `${what}: placeKind station, label "${want}"`, w?.placeKind === 'station' && w.label.startsWith(ST) && w.label.endsWith('(hangar)') === hangar && w.label === want, j({ kind: w?.placeKind, label: w?.label }))
    check('place naming', `${what}: point is the panel's SolarSystem position, not the roster's`, w?.point && dist(w.point, solar) < 1 && dist(w.point, loc(ST)) > 1000, j(w?.point))
    check('place naming', `${what}: a check entry records the naming`, (i?.checks ?? []).some((c) => c.ok && c.item === 'named by player location' && /RR_CRU_LEO|Seraphim/.test(c.why ?? '')), j((i?.checks ?? []).find((c) => c.item === 'named by player location') ?? null))
  }
  station('real station panel', DI_STATION, true)
  station('"tocation" OCR', DI_STATION.replace('player location', 'player tocation'), true)
  station('no hangar zone', DI_STATION.split('\n').filter((l) => !l.includes('Hangar')).join('\n'), false)

  const unk = W.parseDisplayInfo(DI_STATION.replaceAll('RR_CRU_LEO', 'RR_XYZ_Q9'))
  const wu = unk && W.resolveDisplayInfo(unk, roster, AT)
  check('place naming', 'unknown code RR_XYZ_Q9 -> placeKind space, "Open space · …"', unk?.playerLocationCode === 'RR_XYZ_Q9' && wu?.placeKind === 'space' && /^Open space · /.test(wu?.label ?? ''), j({ code: unk?.playerLocationCode, kind: wu?.placeKind, label: wu?.label }))

  const wp = W.resolveDisplayInfo(W.parseDisplayInfo(REAL_NEAR_HURSTON), roster, AT)
  check('place naming', 'planet case still "Hurston · 49 km up · …", placeKind planet', wp?.placeKind === 'planet' && /^Hurston · 49 km up · /.test(wp?.label ?? ''), j({ kind: wp?.placeKind, label: wp?.label }))
})

let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
