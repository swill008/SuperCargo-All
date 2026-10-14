// Marker calibration checks: bundles src/other/otherMarkers.ts and calls it directly.
// Roster = data/uex/locations.json merged with data/uex/other-positions.json {places} (as mergeLocations does).
// Usage: node test/replay/marker_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-marker-checks-'))
const outfile = path.join(tmp, 'otherMarkers.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherMarkers.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const M = await import(pathToFileURL(outfile).href)

// same merge rule as otherPlaces.mergeLocations: haul roster first, extra places fill gaps
const haul = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
const extra = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const by = new Map()
for (const l of haul) by.set(l.name.toLowerCase(), l)
for (const l of extra) {
  const k = l.name.toLowerCase()
  const prev = by.get(k)
  if (!prev) by.set(k, l)
  else if (prev.x == null && l.x != null) by.set(k, { ...prev, ...l })
}
const roster = [...by.values()]
const byName = (n) => roster.find((l) => l.name === n)

let fails = 0
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' · ' + JSON.stringify(info) : ''}`)
  if (!ok) fails++
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// 1. real marker line (J74, user's export) -> Hurston body frame, ~4 km from HDPC-Cassillo
const line =
  '<2026-10-14T15:12:49.694Z> [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [c240a60b-1597-4d36-baf0-98e06dd1fe5c], generator name [FTL_Courier], contract [FTL_Courier_Stanton_Iron_Rank1], contractDefinitionId[0d41bca1-0bd1-4aad-bf63-9436567a221a], objectiveId [dropoff_f1fc9593-e30c-4303-8a4e-7e1509141107_0], markerEntityId [7145], zoneHostId [862321816216], position [x: -790556.763184, y: 614240.106819, z: -6055.992337] [Team_MissionFeatures][Missions]'
const mm = line.match(/zoneHostId \[(\d+)\], position \[x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+)\]/)
const real = { zoneHostId: mm[1], x: +mm[2], y: +mm[3], z: +mm[4] }
const hur = M.bodyRadius('Hurston', roster)
const mic = M.bodyRadius('microTech', roster)
check('bodyRadius Hurston ~1000 km', hur != null && Math.abs(hur - 1_000_000) < 30_000, { hur: Math.round(hur) })
check('bodyRadius microTech ~1000 km', mic != null && Math.abs(mic - 1_000_000) < 30_000, { mic: Math.round(mic) })
check('bodyRadius unknown body = null', M.bodyRadius('Nowhere Prime', roster) === null)
check('bodyCentre Hurston = roster entry', (() => { const c = M.bodyCentre('Hurston', roster); const h = byName('Hurston'); return c && c.x === h.x && c.y === h.y && c.z === h.z })())
check('real marker: not root, not small, no z-match', !M.isRootFrame(real) && !M.isSmallZone(real) && M.markerUexPlace(real, roster) === null)
const r1 = M.calibrateZone({}, real, roster)
const pos1 = M.resolveMarker(r1.zones, real)
const cass = byName('HDPC-Cassillo')
const d1 = pos1 ? dist(pos1, cass) : null
check('real marker -> body frame Hurston', r1.change === 'body' && r1.body === 'Hurston' && r1.place === 'HDPC-Cassillo', { change: r1.change, body: r1.body, place: r1.place, why: r1.bodyWhy })
check('real marker lands ~4 km from HDPC-Cassillo', d1 != null && d1 > 3000 && d1 < 5000, { meters: d1 && Math.round(d1) })
// the haul-only roster lacks Hurston's places: no body fit (why the merged roster matters)
const rHaul = M.calibrateZone({}, real, haul)
check('haul-only roster: real marker not calibrated', rHaul.change === 'none', { why: rHaul.bodyWhy })

// 2. microTech-radius fake, pointing away from every place -> uncalibrated
const mt = M.bodyCentre('microTech', roster)
let fake = null
for (let i = 0; i < 360 && !fake; i += 7) {
  for (let j = -80; j <= 80 && !fake; j += 13) {
    const a = (i * Math.PI) / 180, b = (j * Math.PI) / 180
    const u = { x: Math.cos(b) * Math.cos(a), y: Math.cos(b) * Math.sin(a), z: Math.sin(b) }
    const m = { zoneHostId: 'fake-mt', x: u.x * mic, y: u.y * mic, z: u.z * mic + 0.37 }
    const p = { x: mt.x + m.x, y: mt.y + m.y, z: mt.z + m.z }
    const hur0 = M.bodyCentre('Hurston', roster)
    const ph = { x: hur0.x + m.x, y: hur0.y + m.y, z: hur0.z + m.z }
    const near = roster.some((l) => l.x != null && (dist(p, l) < 50_000 || dist(ph, l) < 50_000))
    if (!near && M.markerUexPlace(m, roster) === null) fake = m
  }
}
check('found a microTech-radius direction with no place near', !!fake)
const r2 = M.calibrateZone({}, fake, roster)
check('microTech-radius fake with no near place -> uncalibrated', r2.change === 'none' && !r2.zones['fake-mt'] && M.resolveMarker(r2.zones, fake) === null, { why: r2.bodyWhy })

// 3. two bodies both fit -> uncalibrated. Synthetic roster: A and B, same radius, a place on each at the same local offset.
const mk = (name, body, x, y, z) => ({ name, code: '', maxContainerSize: 0, uexId: 0, body, x, y, z })
const R = 500_000
const two = [
  mk('Alpha', undefined, 1e9, 0, 0), mk('Alpha Base', 'Alpha', 1e9 + R, 0, 0.5),
  mk('Beta', undefined, 2e9, 0, 0), mk('Beta Base', 'Beta', 2e9 + R, 0, 0.5)
]
const amb = { zoneHostId: 'amb', x: R - 2000, y: 0, z: 0.25 }
const r3 = M.calibrateZone({}, amb, two)
check('two bodies fit -> uncalibrated', r3.change === 'none' && !r3.zones.amb && /more than one/.test(r3.bodyWhy ?? ''), { why: r3.bodyWhy })
const one = two.slice(0, 2)
const r3b = M.calibrateZone({}, amb, one)
check('same marker with one body -> body frame', r3b.change === 'body' && r3b.body === 'Alpha' && r3b.place === 'Alpha Base', { change: r3b.change })

// 4. z-match path unchanged: marker whose z matches exactly one place calibrates by z (not body)
const zplace = roster.find((l) => l.x != null && l.z != null && Math.abs(l.z) > 1 && M.markerUexPlace({ zoneHostId: 'z', x: 100_000, y: 0, z: l.z }, roster)?.name === l.name)
const zm = { zoneHostId: 'zz', x: 123_456, y: -98_765, z: zplace.z }
const r4 = M.calibrateZone({}, zm, roster)
const c4 = r4.zones.zz
check('z-match -> change new (not body)', r4.change === 'new' && r4.place === zplace.name && !r4.body, { change: r4.change, place: r4.place })
check('z-match centre = place - marker', c4 && c4.x === zplace.x - zm.x && c4.y === zplace.y - zm.y && c4.z === zplace.z - zm.z && c4.n === 1)
// an already-known zone is not re-calibrated by the body path
const r5 = M.calibrateZone(r4.zones, { ...real, zoneHostId: 'zz' }, roster)
check('known zone: body path not used', r5.change === 'none' && r5.zones === r4.zones)
// root and small markers never take the body path
const rRoot = M.calibrateZone({}, { zoneHostId: 'root', x: 2e9, y: 3e9, z: 5 }, roster)
check('root marker -> root', rRoot.change === 'root')
const rSmall = M.calibrateZone({}, { zoneHostId: 'small', x: 100, y: 200, z: 3 }, roster)
check('small marker -> none', rSmall.change === 'none' && !rSmall.bodyWhy)

// 5. planet table radius (otherBodies) used when present, estimate when the table doesn't know the body
check('bodyRadius: table radius wins', M.bodyRadius('Hurston', roster, (n) => (n === 'Hurston' ? 999_000 : null)) === 999_000)
check('bodyRadius: table null -> estimate', M.bodyRadius('Hurston', roster, () => null) === hur)
check('bodyRadius: table junk (0/NaN) -> estimate', M.bodyRadius('Hurston', roster, () => 0) === hur && M.bodyRadius('Hurston', roster, () => NaN) === hur)
check('bodyRadius: table knows a body the roster has no places for', M.bodyRadius('Nowhere Prime', roster, () => 300_000) === 300_000)
// a table radius far from |position| removes the body from the candidates: real Hurston marker no longer fits
const rTab = M.calibrateZone({}, real, roster, (n) => (n === 'Hurston' ? 800_000 : null))
check('calibrateZone uses the table radius (Hurston 800 km -> no fit)', rTab.change === 'none' && !rTab.zones[real.zoneHostId], { why: rTab.bodyWhy })
const rTab2 = M.calibrateZone({}, real, roster, (n) => (n === 'Hurston' ? 1_000_000 : null))
check('calibrateZone with exact table radius 1000 km -> body Hurston', rTab2.change === 'body' && rTab2.body === 'Hurston', { change: rTab2.change, why: rTab2.bodyWhy })

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
