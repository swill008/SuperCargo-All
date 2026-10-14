// Next list order check: bundles src/other/otherNext.ts and calls listOpenStops directly.
// The UI order is not in the saved doc, so this is the pure check of 'distance' / 'route' / 'manual'.
// Usage: node test/replay/next_order.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-next-order-'))
const outfile = path.join(tmp, 'otherNext.mjs')

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherNext.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const N = await import(pathToFileURL(outfile).href)
const locFile = path.join(tmp, 'otherCurrentLocation.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherCurrentLocation.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: locFile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const C = await import(pathToFileURL(locFile).href)
const snapFile = path.join(tmp, 'otherLocationSnap.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherLocationSnap.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: snapFile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const S = await import(pathToFileURL(snapFile).href)

const locations = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
const byName = (n) => locations.find((l) => l.name === n)
const START = 'ARC-L5 Yellow Core Station' // from here greedy route != start-distance order
const PLACES = ['Port Tressler', 'Everus Harbor', 'Baijini Point', 'Seraphim Station']
const OFF_MAP = 'Nowhere Gulch Camp 7' // not in UEX
for (const n of [START, ...PLACES]) {
  const l = byName(n)
  if (!l || l.x == null || l.y == null || l.z == null) throw new Error(`UEX place missing coords: ${n}`)
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// one go step per job; the off-map job sits first so "last" can't be a fluke of input order
const job = (i, place) => ({
  id: `job-${i}`,
  ref: `R${i}`,
  title: `Job ${i}`,
  kind: 'delivery',
  reward: 1000,
  status: 'active',
  createdAt: i,
  steps: [{ id: `s${i}`, kind: 'go', label: `Go to ${place}`, location: place, have: 0, need: 1, done: false }]
})
const jobs = [job(0, OFF_MAP), ...PLACES.map((p, i) => job(i + 1, p))]
const placeOf = (r) => r.step.location

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'runs', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  }
}
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-9)
const offMapLast = (name, rows) => {
  const last = rows[rows.length - 1]
  check(name, 'non-UEX stop is last', last && placeOf(last) === OFF_MAP, rows.map(placeOf).join(' > '))
  check(name, 'non-UEX stop has noDistance true', last?.noDistance === true, `noDistance=${last?.noDistance}`)
  const others = rows.filter((r) => placeOf(r) !== OFF_MAP)
  check(name, 'UEX stops have noDistance false', others.every((r) => !r.noDistance), others.map((r) => r.noDistance).join(','))
}
const legsSum = (name, rows) => {
  const legs = rows.map((r) => r.leg).filter((v) => v != null)
  const sum = legs.reduce((a, b) => a + b, 0)
  check(name, 'legs sum to routeTotal', typeof N.routeTotal === 'function' && near(N.routeTotal(rows), sum), `sum=${sum} routeTotal=${N.routeTotal?.(rows)}`)
}

safe('distance', () => {
  const rows = N.listOpenStops(jobs, START, locations, { listOrder: 'distance' })
  check('distance', 'lists every job', rows.length === jobs.length, `${rows.length} rows`)
  const d = rows.filter((r) => placeOf(r) !== OFF_MAP).map((r) => r.distance)
  check('distance', 'UEX rows carry a number distance', d.every((v) => typeof v === 'number'), d.join(','))
  check('distance', 'non-decreasing by distance', d.every((v, i) => i === 0 || v >= d[i - 1]), d.map((v) => Math.round(v / 1e6)).join(' <= ') + ' Mm')
  const start = byName(START)
  const okExact = rows.filter((r) => placeOf(r) !== OFF_MAP).every((r) => near(r.distance, dist(start, byName(placeOf(r)))))
  check('distance', 'distance is start -> place', okExact)
  const src = rows.filter((r) => r.distance != null).map((r) => r.distanceSource)
  check('distance', 'distanceSource set on measured rows', src.every((s) => typeof s === 'string' && s.length > 0), src.join(','))
  offMapLast('distance', rows)
})

safe('route', () => {
  const rows = N.listOpenStops(jobs, START, locations, { listOrder: 'route' })
  check('route', 'lists every job', rows.length === jobs.length, `${rows.length} rows`)
  // greedy: from start, always the nearest remaining
  let at = byName(START)
  const remaining = PLACES.slice()
  const want = []
  const wantLegs = []
  while (remaining.length) {
    remaining.sort((a, b) => dist(at, byName(a)) - dist(at, byName(b)))
    const nxt = remaining.shift()
    want.push(nxt)
    wantLegs.push(dist(at, byName(nxt)))
    at = byName(nxt)
  }
  const got = rows.filter((r) => placeOf(r) !== OFF_MAP).map(placeOf)
  check('route', 'first row is nearest to start', got[0] === want[0], `got ${got[0]}, want ${want[0]}`)
  check('route', 'each next row is nearest remaining to previous', got.join('|') === want.join('|'), `got ${got.join(' > ')}; want ${want.join(' > ')}`)
  const legs = rows.filter((r) => placeOf(r) !== OFF_MAP).map((r) => r.leg)
  check('route', 'leg is previous stop -> this stop', legs.every((v, i) => near(v, wantLegs[i])), legs.map((v) => Math.round((v ?? NaN) / 1e6)).join(',') + ' Mm')
  const byStart = PLACES.slice().sort((a, b) => dist(byName(START), byName(a)) - dist(byName(START), byName(b)))
  check('route', 'fixture: greedy order differs from start-distance order', want.join('|') !== byStart.join('|'), `greedy ${want.join(' > ')}; by start ${byStart.join(' > ')}`)
  legsSum('route', rows)
  offMapLast('route', rows)
})

safe('manual', () => {
  const order = ['job-3', 'job-0', 'job-1', 'job-4', 'job-2']
  const rows = N.listOpenStops(jobs, START, locations, { listOrder: 'manual', jobOrder: order })
  check('manual', 'follows jobOrder', rows.map((r) => r.job.id).join(',') === order.join(','), rows.map((r) => r.job.id).join(','))
  const d = rows.filter((r) => placeOf(r) !== OFF_MAP).map((r) => r.distance)
  check('manual', 'still shows distances', d.every((v) => typeof v === 'number'), d.join(','))
})

safe('no start', () => {
  for (const listOrder of ['distance', 'route']) {
    const rows = N.listOpenStops(jobs, '', locations, { listOrder })
    check(`no start/${listOrder}`, 'every distance is null', rows.every((r) => r.distance == null), rows.map((r) => r.distance).join(','))
    check(`no start/${listOrder}`, 'order is the fallback (job order)', rows.map((r) => r.job.id).join(',') === jobs.map((j) => j.id).join(','), rows.map((r) => r.job.id).join(','))
  }
})

// auto start: the real inventory-request line names the roster place (real format, handle replaced)
safe('current location', () => {
  const line = '<2026-10-14T09:54:01.249Z> [Notice] <RequestLocationInventory> Player[PLAYER] requested inventory for Location[RR_CRU_L1] [Team_CoreGameplayFeatures][Inventory]'
  const arrive = '<2026-10-14T09:53:57.930Z> [Notice] <Update Inventory Location> Player [PLAYER] is changing location. Landing [0] -> [1510935576]. Location [0] -> [1510935576]. Pending [0] [Team_CoreGameplayFeatures][Inventory]'
  const leave = '<2026-10-14T09:59:30.678Z> [Notice] <Update Inventory Location> Player [PLAYER] is changing location. Landing [1510935576] -> [0]. Location [1510935576] -> [1105811199]. Pending [0] [Team_CoreGameplayFeatures][Inventory]'
  const got = C.currentLocationFromLine(line, locations)
  check('current location', 'RR_CRU_L1 -> CRU-L1 Ambitious Dream Station', got === 'CRU-L1 Ambitious Dream Station', `got ${got}`)
  check('current location', 'unknown code gives null', C.currentLocationFromLine(line.replace('RR_CRU_L1', 'Pyro_Nowhere'), locations) === null)
  const t = C.createCurrentLocationTracker(locations)
  for (const l of [arrive, line]) t.push(l)
  check('current location', 'tracker current after request', t.current() === 'CRU-L1 Ambitious Dream Station', `current=${t.current()}`)
  t.push(leave)
  check('current location', 'leaving clears current, keeps last', t.current() === null && t.last() === 'CRU-L1 Ambitious Dream Station', `current=${t.current()} last=${t.last()}`)
})

// ---- batch 2026-10-14: formatDistance, row place fields, legs without a start, origin, groups ----
const has = (name, fn) => {
  const ok = typeof N[fn] === 'function'
  if (!ok) check(name, `${fn} exported`, false, 'missing')
  return ok
}

safe('formatDistance', () => {
  if (!has('formatDistance', 'formatDistance')) return
  for (const [m, want] of [
    [450, '450 m'],
    [830000, '830 km'],
    [1.9e9, '1.9 Gm'],
    [null, '—']
  ]) {
    const got = N.formatDistance(m)
    check('formatDistance', `${m} -> ${want}`, got === want, `got ${JSON.stringify(got)}`)
  }
})

safe('row places', () => {
  const pick = {
    ...job(9, 'Everus Harbor'),
    steps: [{ id: 's9', kind: 'go', label: 'Deliver to Everus Harbor', location: 'Everus Harbor', pickupLocation: 'Port Tressler', pickedUp: false, have: 0, need: 1, done: false }]
  }
  const [r] = N.listOpenStops([pick], START, locations, { listOrder: 'distance' })
  check('row places', 'place is the pickup before pick-up', r?.place === 'Port Tressler', `place=${r?.place}`)
  check('row places', 'pickup flag and dest set', r?.pickup === true && r?.dest === 'Everus Harbor', `pickup=${r?.pickup} dest=${r?.dest}`)
  const picked = { ...pick, steps: [{ ...pick.steps[0], pickedUp: true }] }
  const [r2] = N.listOpenStops([picked], START, locations, { listOrder: 'distance' })
  check('row places', 'place is the dest after pick-up', r2?.place === 'Everus Harbor' && r2?.pickup === false, `place=${r2?.place} pickup=${r2?.pickup}`)
})

safe('noDistanceWhy', () => {
  const withStart = N.listOpenStops(jobs, START, locations, { listOrder: 'distance' })
  const off = withStart.find((r) => placeOf(r) === OFF_MAP)
  check('noDistanceWhy', "off-map place -> 'not-in-uex'", off?.noDistanceWhy === 'not-in-uex', `why=${off?.noDistanceWhy}`)
  const uex = withStart.filter((r) => placeOf(r) !== OFF_MAP)
  check('noDistanceWhy', 'measured rows -> null', uex.every((r) => r.noDistanceWhy === null), uex.map((r) => r.noDistanceWhy).join(','))
  const noStart = N.listOpenStops(jobs, '', locations, { listOrder: 'distance' })
  const uexNo = noStart.filter((r) => placeOf(r) !== OFF_MAP)
  // with no start a UEX row still has a leg from the stop before it; only a row with nothing to show says 'no-start'
  check('noDistanceWhy', "UEX rows with no start and no leg -> 'no-start', with a leg -> null", uexNo.some((r) => r.leg == null) && uexNo.every((r) => r.noDistanceWhy === (r.leg == null ? 'no-start' : null)), uexNo.map((r) => `${r.leg == null ? '-' : 'leg'}:${r.noDistanceWhy}`).join(','))
  const offNo = noStart.find((r) => placeOf(r) === OFF_MAP)
  check('noDistanceWhy', "off-map with no start -> 'not-in-uex'", offNo?.noDistanceWhy === 'not-in-uex', `why=${offNo?.noDistanceWhy}`)
})

safe('legs without a start', () => {
  for (const listOrder of ['distance', 'route', 'manual']) {
    const rows = N.listOpenStops(jobs, '', locations, { listOrder, jobOrder: jobs.map((j) => j.id) })
    const pairs = rows.map((r, i) => [rows[i - 1], r]).slice(1).filter(([a, b]) => placeOf(a) !== OFF_MAP && placeOf(b) !== OFF_MAP)
    const ok = pairs.length > 0 && pairs.every(([a, b]) => near(b.leg, dist(byName(placeOf(a)), byName(placeOf(b)))))
    check(`no start/${listOrder}`, 'legs between UEX stops still computed', ok, rows.map((r) => (r.leg == null ? '-' : Math.round(r.leg / 1e6))).join(',') + ' Mm')
    check(`no start/${listOrder}`, 'first row has no leg', rows[0]?.leg == null, `leg0=${rows[0]?.leg}`)
  }
})

safe('resolveOrigin', () => {
  if (!has('resolveOrigin', 'resolveOrigin')) return
  const now = Date.parse('2026-10-14T12:00:00Z')
  const min = 60000
  const typed = N.resolveOrigin({ typed: 'Port Tressler', current: 'Everus Harbor', currentAt: now - min, autoStart: true, now })
  check('resolveOrigin', 'typed start wins over current', typed?.name === 'Port Tressler' && typed?.kind === 'typed', JSON.stringify(typed))
  const cur = N.resolveOrigin({ typed: '', current: 'Everus Harbor', currentAt: now - 4 * min, autoStart: true, now })
  check('resolveOrigin', 'no typed + auto -> current, not stale at 4 min', cur?.name === 'Everus Harbor' && cur?.kind === 'current' && cur?.stale === false, JSON.stringify(cur))
  const old = N.resolveOrigin({ typed: '', current: 'Everus Harbor', currentAt: now - 6 * min, autoStart: true, now })
  check('resolveOrigin', 'current older than 5 min is stale', old?.name === 'Everus Harbor' && old?.stale === true, JSON.stringify(old))
  const off = N.resolveOrigin({ typed: '', current: 'Everus Harbor', currentAt: now - min, autoStart: false, now })
  check('resolveOrigin', 'auto start off ignores current', !off?.name && off?.kind !== 'current', JSON.stringify(off))
  const none = N.resolveOrigin({ typed: '  ', current: null, currentAt: null, autoStart: true, now })
  check('resolveOrigin', 'nothing set -> no name', !none?.name && none?.stale !== true, JSON.stringify(none))
  const iso = N.resolveOrigin({ typed: '', current: 'Everus Harbor', currentAt: new Date(now - 6 * min).toISOString(), autoStart: true, now })
  check('resolveOrigin', 'currentAt as ISO string also goes stale', iso?.stale === true, JSON.stringify(iso))
  const typedOld = N.resolveOrigin({ typed: 'Port Tressler', current: 'Everus Harbor', currentAt: now - 60 * min, autoStart: true, now })
  check('resolveOrigin', 'typed start is never stale', typedOld?.stale === false, JSON.stringify(typedOld))
})

// two jobs pick up at Port Tressler: one stop group there, then the two drop-offs; no 0 km leg
const groupJobs = [
  { ...job(20, 'Everus Harbor'), steps: [{ id: 'g20', kind: 'go', label: 'Deliver to Everus Harbor', location: 'Everus Harbor', pickupLocation: 'Port Tressler', pickedUp: false, have: 0, need: 1, done: false }] },
  { ...job(21, 'Baijini Point'), steps: [{ id: 'g21', kind: 'go', label: 'Deliver to Baijini Point', location: 'Baijini Point', pickupLocation: 'Port Tressler', pickedUp: false, have: 0, need: 1, done: false }] },
  job(22, 'Seraphim Station')
]
const gRows = (g) => g?.rows ?? g?.items ?? g?.stops ?? []
safe('groupByPlace', () => {
  if (!has('groupByPlace', 'groupByPlace')) return
  for (const listOrder of ['distance', 'route']) {
    const rows = N.listOpenStops(groupJobs, START, locations, { listOrder })
    const groups = N.groupByPlace(rows)
    const name = `groupByPlace/${listOrder}`
    check(name, 'every row lands in one group', groups.reduce((a, g) => a + gRows(g).length, 0) === rows.length, groups.map((g) => `${g.place}:${gRows(g).length}`).join(' | '))
    const pt = groups.filter((g) => g.place === 'Port Tressler')
    check(name, 'same pickup merges into one group of two', pt.length === 1 && gRows(pt[0]).length === 2, `groups at Port Tressler=${pt.length} rows=${gRows(pt[0]).length}`)
    const places = groups.map((g) => g.place)
    check(name, 'no place repeats back to back', places.every((p, i) => i === 0 || p !== places[i - 1]), places.join(' > '))
    check(name, 'no 0 km legs', groups.every((g) => g.leg == null || g.leg > 0), groups.map((g) => g.leg).join(','))
    let at = byName(START)
    const want = groups.map((g) => {
      const d = dist(at, byName(g.place))
      at = byName(g.place)
      return d
    })
    check(name, 'legs recomputed place to place (start first)', groups.every((g, i) => near(g.leg, want[i])), groups.map((g) => Math.round((g.leg ?? NaN) / 1e6)).join(',') + ' Mm')
  }
})

// OCR misreads a Lagrange code; the place still snaps to the UEX name
safe('ocr snap', () => {
  const got = S.snapOtherLocationOcr('CRU-LS5 Beautiful Glen Station', locations)
  const name = typeof got === 'string' ? got : got?.name ?? got?.location ?? got?.value
  check('ocr snap', 'CRU-LS5 Beautiful Glen Station -> CRU-L5 Beautiful Glen Station', name === 'CRU-L5 Beautiful Glen Station', JSON.stringify(got))
})

safe('remainingRoute', () => {
  if (!has('remainingRoute', 'remainingRoute') || typeof N.groupByPlace !== 'function') return
  const groups = N.groupByPlace(N.listOpenStops(groupJobs, START, locations, { listOrder: 'route' }))
  const sumFrom = (i) => groups.slice(i).reduce((a, g) => a + (g.leg ?? 0), 0)
  for (const i of [...new Set([0, 1, groups.length - 1])]) {
    const r = N.remainingRoute(groups, i)
    check('remainingRoute', `from group ${i}: stops = groups left`, r?.stops === groups.length - i, `stops=${r?.stops} of ${groups.length}`)
    check('remainingRoute', `from group ${i}: distance = legs from there on`, near(r?.distance, sumFrom(i)), `got ${r?.distance} want ${sumFrom(i)}`)
  }
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
