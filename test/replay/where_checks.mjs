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

let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
