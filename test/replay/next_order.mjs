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
const geoFile = path.join(tmp, 'otherGeo.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherGeo.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: geoFile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const G = await import(pathToFileURL(geoFile).href)
const resFile = path.join(tmp, 'otherResolve.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherResolve.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resFile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const RS = await import(pathToFileURL(resFile).href)
/** a typed start through resolveOrigin: the resolver's answer (resolveStartText) */
const typedMatch = (text, locs, memory) => N.resolveOrigin({ typed: text, mode: 'fixed', locations: locs, ...(memory ? { memory } : {}) }).match

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
  const iso = (ms) => new Date(ms).toISOString()
  const where = (name, ago, source = 'inventory') => ({ name, label: name, system: 'stanton', body: null, source, at: iso(now - ago) })
  const R = (o) => N.resolveOrigin({ locations, now, ...o })
  const show = (r) => JSON.stringify({ name: r?.name, kind: r?.kind, stale: r?.stale, point: !!r?.point })

  const newerWhere = R({ typed: 'Port Tressler', typedAt: iso(now - 10 * min), where: where('Everus Harbor', 2 * min), mode: 'auto' })
  check('resolveOrigin', 'auto: newer clue beats older typed start', newerWhere.name === 'Everus Harbor' && newerWhere.kind === 'inventory', show(newerWhere))
  check('resolveOrigin', 'auto: clue place gets a roster point', near(newerWhere.point?.x, byName('Everus Harbor').x) && newerWhere.point?.system === 'stanton', show(newerWhere))
  const newerTyped = R({ typed: 'Port Tressler', typedAt: iso(now - min), where: where('Everus Harbor', 2 * min), mode: 'auto' })
  check('resolveOrigin', 'auto: newer typed start beats older clue', newerTyped.name === 'Port Tressler' && newerTyped.kind === 'typed', show(newerTyped))
  check('resolveOrigin', 'typed start gets a roster point', near(newerTyped.point?.x, byName('Port Tressler').x), show(newerTyped))
  const onlyTyped = R({ typed: 'Port Tressler', typedAt: iso(now - 60 * min), where: null, mode: 'auto' })
  check('resolveOrigin', 'auto: typed only -> typed, never stale', onlyTyped.name === 'Port Tressler' && onlyTyped.stale === false, show(onlyTyped))
  const fresh = R({ typed: '', where: where('Everus Harbor', 4 * min, 'tick'), mode: 'auto' })
  check('resolveOrigin', 'auto: clue at 4 min not stale, kind = source', fresh.name === 'Everus Harbor' && fresh.kind === 'tick' && fresh.stale === false, show(fresh))
  const old = R({ typed: '', where: where('Everus Harbor', 6 * min, 'map'), mode: 'auto' })
  check('resolveOrigin', 'auto: clue older than 5 min is stale', old.name === 'Everus Harbor' && old.stale === true, show(old))
  const fixed = R({ typed: 'Port Tressler', typedAt: iso(now - 60 * min), where: where('Everus Harbor', min), mode: 'fixed' })
  check('resolveOrigin', 'fixed: typed start only, newer clue ignored', fixed.name === 'Port Tressler' && fixed.kind === 'typed' && fixed.stale === false, show(fixed))
  const fixedEmpty = R({ typed: '  ', where: where('Everus Harbor', min), mode: 'fixed' })
  check('resolveOrigin', 'fixed: empty typed -> no start', fixedEmpty.name === null && fixedEmpty.kind === null && !fixedEmpty.point, show(fixedEmpty))
  const none = R({ typed: '', where: null, mode: 'auto' })
  check('resolveOrigin', 'nothing set -> no name', none.name === null && none.kind === null && none.stale === false, show(none))
  const pt = { x: 1, y: 2, z: 3, system: 'stanton', body: null }
  const space = R({ where: { name: null, label: 'Open space · 443,380 km from Hurston', point: pt, system: 'stanton', body: null, source: 'displayinfo', at: iso(now - min) }, mode: 'auto' })
  check('resolveOrigin', 'open-space clue: no name, label + point carried', space.name === null && space.label?.startsWith('Open space') && space.point === pt && space.kind === 'displayinfo', show(space))
})

// ---- batch 2: misread systems (fix c), O/0 in names (fix d), origin accuracy ----
safe('systems', () => {
  // the contract's Hurston reading: SolarSystem/Root line, system read as "Stantonl"
  const here = { x: 12849498118.0, y: 427560.9, z: -1516.49, system: 'Stantonl', body: null }
  const gg = byName('HUR-L1 Green Glade Station')
  const t = G.travel(here, N.locationPoint(gg), locations)
  check('systems', '"Stantonl" origin -> HUR-L1 Green Glade ≈1.29 Gm, jumps 0', t?.jumps === 0 && Math.abs(t.meters / 1e9 - 1.29) < 0.01, JSON.stringify(t))
  for (const sys of ['Stanton1', 'StantonSolarSystem', 'Stanton System', 'STANTON']) {
    const u = G.travel({ ...here, system: sys }, N.locationPoint(gg), locations)
    check('systems', `"${sys}" counts as stanton`, u?.jumps === 0 && near(u?.meters, t?.meters), JSON.stringify(u))
  }
  if (typeof G.systemKey === 'function') {
    check('systems', 'systemKey normalises', G.systemKey('Stantonl', locations) === 'stanton' && G.systemKey('Pyro1', locations) === 'pyro' && G.systemKey('Foo', locations) === '', '')
  }
  // a system the roster doesn't have = same system (straight distance)
  const pyroStop = locations.find((l) => l.system === 'pyro' && l.x != null && !/gateway/i.test(l.name))
  const foo = G.travel({ ...here, system: 'Foo' }, N.locationPoint(pyroStop), locations)
  check('systems', 'made-up system "Foo" -> same-system distance', foo?.jumps === 0 && near(foo?.meters, dist(here, pyroStop)), JSON.stringify(foo))
  const pyro = G.travel({ ...here, system: 'Stantonl' }, N.locationPoint(pyroStop), locations)
  check('systems', 'real Pyro stop from "Stantonl" still jumps 1', pyro?.jumps === 1, JSON.stringify(pyro))
  const nul = G.travel({ ...here, system: null }, N.locationPoint(pyroStop), locations)
  check('systems', 'no system -> same-system distance', nul?.jumps === 0, JSON.stringify(nul))
})

safe('names O/0', () => {
  // typed starts go through the one resolver (resolveStartText); OCR O/0 is a 'corrected' match, exact names 'exact'.
  // The UEX S1DC06 entry has no coords (the resolver only picks places it can measure to): use the merged roster
  const merged = [...locations, ...JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places]
  const want = 'Covalex Distribution Center S1DC06'
  const hit = typedMatch('Covalex Distribution Center S1DCO6 on Hurston', merged)
  check('names O/0', 'S1DCO6 on Hurston finds S1DC06', /S1DC06$/.test(hit?.match?.name ?? '') && hit?.match?.x != null, hit?.match?.name)
  check('names O/0', "S1DCO6: status 'corrected'", hit?.status === 'corrected', hit?.status)
  const lower = typedMatch('covalex distribution center s1dco6', merged)
  check('names O/0', 'lower case s1dco6 matches too', /S1DC06$/.test(lower?.match?.name ?? ''), lower?.match?.name)
  check('names O/0', 'S4DC05 still S4DC05', /S4DC05$/.test(typedMatch('Covalex Distribution Center S4DC05', merged)?.match?.name ?? ''), typedMatch('Covalex Distribution Center S4DC05', merged)?.match?.name)
  const gg = typedMatch('HUR-L1 Green Glade Station', locations)
  const pt = typedMatch('Port Tressler', locations)
  check('names O/0', "exact names unchanged, status 'exact'", gg?.match?.name === 'HUR-L1 Green Glade Station' && gg.status === 'exact' && pt?.match?.name === 'Port Tressler' && pt.status === 'exact', `${gg?.status} ${pt?.status}`)
  const off = N.resolveOrigin({ typed: OFF_MAP, mode: 'fixed', locations })
  check('names O/0', 'unknown place: no match, no point, typed name kept', !off.match?.match && !off.point && off.name === OFF_MAP && off.match?.status === 'none', `${off.match?.status} ${off.match?.match?.name}`)
  // UEX "Center" without coords + starmap "Centre" with coords (the real merged roster): take the one with coords
  const twoSpellings = [
    { name: 'Covalex Distribution Center S1DC06', code: '', maxContainerSize: 0, uexId: 1, system: 'stanton' },
    { name: 'Covalex Distribution Centre S1DC06', code: '', maxContainerSize: 0, uexId: 0, system: 'stanton', body: 'Hurston', x: 1, y: 2, z: 3 }
  ]
  const withCoords = N.resolveOrigin({ typed: 'Covalex Distribution Center S1DCO6 on Hurston', mode: 'fixed', locations: twoSpellings })
  check('names O/0', 'S1DCO6 picks the spelling that has coords', withCoords.point?.x === 1 && withCoords.match?.match?.x === 1, withCoords.match?.match?.name)
  const s9 = typedMatch('Covalex Distribution Center S9DC99', locations)
  check('names O/0', 'S9DC99 (no such place) not matched', s9?.match?.name !== want && !/S1DC06$/.test(s9?.match?.name ?? ''), s9?.match?.name)
})

safe('origin accuracy', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const iso = (ms) => new Date(ms).toISOString()
  const w = (ago, accuracy) => ({ name: 'Everus Harbor', label: 'Everus Harbor', system: 'stanton', body: null, source: 'displayinfo', at: iso(now - ago), accuracy })
  const R = (o) => N.resolveOrigin({ locations, now, mode: 'auto', ...o })
  const fresh = R({ where: w(0, 10) })
  check('origin accuracy', 'fresh display-info clue -> 10', fresh.accuracy === 10, String(fresh.accuracy))
  const faded = R({ where: w(11 * 60000, 10) })
  check('origin accuracy', 'fades -1 per 5 min (11 min -> 8)', faded.accuracy === 8, String(faded.accuracy))
  const floor = R({ where: w(500 * 60000, 10) })
  check('origin accuracy', 'never below 1', floor.accuracy === 1, String(floor.accuracy))
  const typed = R({ typed: 'Port Tressler', typedAt: iso(now) })
  check('origin accuracy', 'typed -> null', typed.accuracy === null && typed.kind === 'typed', String(typed.accuracy))
  check('origin accuracy', 'nothing set -> null', R({}).accuracy === null, '')
})

// ---- multi-system + surface (2026-10-14) ----
safe('cross-system', () => {
  const start = byName(START)
  const pyro = locations.filter((l) => l.system === 'pyro' && l.x != null && !/gateway/i.test(l.name))
  pyro.sort((a, b) => dist(start, a) - dist(start, b))
  const P = pyro[0].name
  const rawFarthest = Math.max(...PLACES.map((n) => dist(start, byName(n))))
  check('cross-system', `fixture: ${P} (pyro) is nearer in raw coords than some Stanton stop`, dist(start, pyro[0]) < rawFarthest, `${Math.round(dist(start, pyro[0]) / 1e6)} Mm vs ${Math.round(rawFarthest / 1e6)} Mm`)
  const mixJobs = [job(30, P), ...PLACES.map((p, i) => job(31 + i, p))]
  for (const listOrder of ['distance', 'route']) {
    const rows = N.listOpenStops(mixJobs, START, locations, { listOrder })
    const name = `cross-system/${listOrder}`
    const pr = rows.find((r) => placeOf(r) === P)
    check(name, 'pyro stop has jumps 1', pr?.jumps === 1, `jumps=${pr?.jumps}`)
    const gwA = byName('Pyro Gateway (Stanton)')
    const gwB = byName('Stanton Gateway (Pyro)')
    check(name, 'distance = start -> gateway + exit gateway -> place', near(pr?.distance, dist(start, gwA) + dist(gwB, pyro[0])), `got ${pr?.distance}`)
    check(name, 'pyro stop sorts after every Stanton stop', placeOf(rows[rows.length - 1]) === P, rows.map(placeOf).join(' > '))
    check(name, 'Stanton stops have jumps 0', rows.filter((r) => placeOf(r) !== P).every((r) => r.jumps === 0), rows.map((r) => r.jumps).join(','))
    check(name, 'the leg into the pyro stop is a jump leg', pr?.legJumps === 1, `legJumps=${pr?.legJumps}`)
    const groups = N.groupByPlace(rows, locations)
    const left = N.remainingRoute(groups, 0)
    check(name, 'remainingRoute counts the jump', left.jumps === 1 && left.distance != null, JSON.stringify(left))
    if (typeof N.routeTotalJumps === 'function') check(name, 'routeTotalJumps = 1', N.routeTotalJumps(rows) === 1, String(N.routeTotalJumps(rows)))
  }
  // no gateway in the roster -> no distance, says why
  const noGw = locations.filter((l) => !/gateway/i.test(l.name))
  const rows = N.listOpenStops(mixJobs, START, noGw, { listOrder: 'distance' })
  const pr = rows.find((r) => placeOf(r) === P)
  check('cross-system', "missing gateway -> distance null, 'no-gateway', last", pr?.distance == null && pr?.noDistanceWhy === 'no-gateway' && pr?.noDistance === true && placeOf(rows[rows.length - 1]) === P, JSON.stringify({ d: pr?.distance, why: pr?.noDistanceWhy }))
  check('cross-system', 'travel() null without gateways', G.travel(N.locationPoint(start), N.locationPoint(pyro[0]), noGw) === null)
  // marker positions (zone frame) still measure as same system
  const mk = { ...job(40, 'Nowhere Gulch Camp 7'), steps: [{ ...job(40, 'Nowhere Gulch Camp 7').steps[0], position: { x: start.x + 1000, y: start.y, z: start.z } }] }
  const [m] = N.listOpenStops([mk], START, locations, { listOrder: 'distance' })
  check('cross-system', 'marker step measured, jumps 0', m?.distanceSource === 'marker' && near(m?.distance, 1000) && m?.jumps === 0, JSON.stringify({ d: m?.distance, src: m?.distanceSource, j: m?.jumps }))
})

const positions = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
safe('surface', () => {
  const pit = positions.find((p) => p.name === '"The Pit"')
  const wheel = positions.find((p) => p.name === '"Wheeler\'s"')
  if (!pit || !wheel) return check('surface', 'fixture places exist', false, 'missing')
  const chord = dist(pit, wheel)
  const t = G.travel(pit, wheel, positions)
  check('surface', 'fixture: chord ~398 km', Math.abs(chord / 1000 - 398) < 2, `${(chord / 1000).toFixed(1)} km`)
  check('surface', 'same body -> arc ~490 km, surface true', t?.surface === true && t?.jumps === 0 && Math.abs(t.meters / 1000 - 490) < 5, JSON.stringify(t))
  check('surface', 'arc formats as "≈4xx km surface"', /^≈49\d km surface$/.test(G.formatTravel(t)), G.formatTravel(t))
  const noCentre = positions.filter((p) => p.name !== 'Lyria')
  const t2 = G.travel(pit, wheel, noCentre)
  check('surface', 'body centre unknown -> straight line', t2?.surface === false && near(t2?.meters, chord), JSON.stringify(t2))
  const lyria = positions.find((p) => p.name === 'Lyria')
  const above = { ...wheel, x: lyria.x + (wheel.x - lyria.x) * 3, y: lyria.y + (wheel.y - lyria.y) * 3, z: lyria.z + (wheel.z - lyria.z) * 3 }
  check('surface', 'radii far apart -> straight line', G.travel(pit, above, positions)?.surface === false)
  // the row path carries it too
  const [r] = N.listOpenStops([job(50, wheel.name)], '', positions, { listOrder: 'distance', origin: { x: pit.x, y: pit.y, z: pit.z, system: pit.system, body: pit.body } })
  check('surface', 'listOpenStops origin -> row surface distance', r?.surface === true && near(r?.distance, t?.meters), JSON.stringify({ d: r?.distance, s: r?.surface, why: r?.noDistanceWhy }))
})

safe('formatTravel', () => {
  for (const [t, want] of [
    [null, '—'],
    [{ meters: 12.3e9, jumps: 0, surface: false }, '12.3 Gm'],
    [{ meters: 830000, jumps: 0, surface: false }, '830 km'],
    [{ meters: 490000, jumps: 0, surface: true }, '≈490 km surface'],
    [{ meters: 38e9, jumps: 1, surface: false }, '38.0 Gm + 1 jump'],
    [{ meters: 38e9, jumps: 2, surface: false }, '38.0 Gm + 2 jumps']
  ]) {
    const got = G.formatTravel(t)
    check('formatTravel', `${JSON.stringify(t)} -> ${want}`, got === want, `got ${JSON.stringify(got)}`)
  }
  const c = [null, { meters: 1, jumps: 1, surface: false }, { meters: 5e9, jumps: 0, surface: false }, { meters: 2, jumps: 0, surface: false }]
  const sorted = c.slice().sort(G.compareTravel).map((t) => (t ? `${t.jumps}/${t.meters}` : 'null'))
  check('compareTravel', 'jumps first, then metres, null last', sorted.join(',') === '0/2,0/5000000000,1/1,null', sorted.join(','))
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

// OCR misreads a Lagrange code; import (otherResolve.importPlace, ocr) gives the roster name and keeps the text as read
safe('ocr snap', () => {
  if (typeof RS.importPlace !== 'function') return check('ocr snap', 'importPlace exported', false, 'missing')
  const raw = 'CRU-LS5 Beautiful Glen Station'
  const got = RS.importPlace(raw, { locations, useMarker: false }, { ocr: true })
  // batch 9: the match is CRU-L5 ('corrected'); the stored name is renamed only when the resolver is sure (confidence >= 8)
  check('ocr snap', 'CRU-LS5 Beautiful Glen Station matches CRU-L5 Beautiful Glen Station', got?.match?.match?.name === 'CRU-L5 Beautiful Glen Station' && got.match.status === 'corrected', JSON.stringify({ match: got?.match?.match?.name, status: got?.match?.status }))
  const sure = got?.match?.confidence >= 8
  check('ocr snap', 'text as read kept; renamed only when sure', got?.locationRaw === raw && got.location === (sure ? 'CRU-L5 Beautiful Glen Station' : raw) && got.locationSnapped === sure, JSON.stringify({ location: got?.location, conf: got?.match?.confidence }))
})

// a city name must not snap to a place inside it ("Reclamation and Disposal in Lorville")
safe('city not snapped to a sub-place', () => {
  if (typeof RS.importPlace !== 'function') return check('snap', 'importPlace exported', false, 'missing')
  // small roster where the sub-place is the only partial match (the case the old matcher got wrong)
  const roster = [
    { name: 'Reclamation and Disposal in Lorville', system: 'Stanton', x: 1, y: 2, z: 3 },
    { name: 'Reclamation and Disposal on Area18', system: 'Stanton', x: 4, y: 5, z: 6 },
    { name: 'Port Tressler', system: 'Stanton', x: 7, y: 8, z: 9 }
  ]
  for (const raw of ['Lorville', 'Area18']) {
    const got = RS.importPlace(raw, { locations: roster, useMarker: false })
    check('snap', `${raw} stays ${raw} (import)`, got?.location === raw && got.locationSnapped === false, JSON.stringify({ location: got?.location, status: got?.match?.status }))
    const t = typedMatch(raw, roster)
    check('snap', `${raw} typed start: no sub-place point`, !t?.match || !/^Reclamation/.test(t.match.name), t?.match?.name)
  }
  // the log-path snap fixtures now live in test/replay/fixtures/stop_cases.json (resolve_checks)
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

// F4: J74 shape (real, from the user's export): the game lists the turn-in first, the pickup second
const otherPositions = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const posByName = (n) => otherPositions.find((l) => l.name === n) ?? byName(n)
const j74 = (steps) => ({
  id: 'J74', ref: 'J74', title: 'FTL_Courier_Stanton_Iron_Rank1', kind: 'delivery', reward: 0, status: 'active', createdAt: 74,
  missionId: 'c240a60b-1597-4d36-baf0-98e06dd1fe5c', steps
})
const j74Steps = (pickupItem = 'Iron', turninItem = 'Iron') => [
  { id: 'd', kind: 'turnin', label: 'Deliver Iron To Security Compound', location: 'Security Compound', item: turninItem,
    have: 0, need: 1, done: false, objectiveId: 'dropoff_f1fc9593-e30c-4303-8a4e-7e1509141107_0' },
  { id: 'p', kind: 'pickup', label: 'Collect Iron From HDPC-Farnesway on Hurston', location: 'HDPC-Farnesway', item: pickupItem,
    have: 0, need: 1, done: false, objectiveId: 'pickup_f1fc9593-e30c-4303-8a4e-7e1509141107_0' }
]
safe('pickup first', () => {
  const job = j74(j74Steps())
  check('pickup first', 'nextLiveStep is the Farnesway pickup', N.nextLiveStep(job)?.id === 'p', N.nextLiveStep(job)?.label)
  const one = N.listOpenStops([job], '', locations, {})
  check('pickup first', 'one-per-job list shows the pickup', one[0]?.step.id === 'p', one.map((r) => r.step.id).join(','))
  const all = N.listOpenStops([job], '', locations, { showAll: true, listOrder: 'distance' })
  check('pickup first', 'show-all: pickup before delivery', all.map((r) => r.step.id).join(',') === 'p,d', all.map((r) => r.step.id).join(','))
  // route from Cassillo: the delivery (near Cassillo) is nearer but must wait for its pickup
  const cas = posByName('HDPC-Cassillo')
  const hur = posByName('Hurston')
  const dpos = { x: hur.x - 790556.763184, y: hur.y + 614240.106819, z: hur.z - 6055.992337 }
  const jr = j74(j74Steps().map((s) => (s.id === 'd' ? { ...s, position: dpos } : s)))
  const route = N.listOpenStops([jr], '', [...locations, ...otherPositions], {
    showAll: true, listOrder: 'route', origin: { x: cas.x, y: cas.y, z: cas.z, system: 'stanton', body: 'Hurston' }
  })
  check('pickup first', 'route: pickup before nearer delivery', route.map((r) => r.step.id).join(',') === 'p,d', route.map((r) => r.step.id).join(','))
  // done pickup: the delivery is next again
  const after = j74(j74Steps().map((s) => (s.id === 'p' ? { ...s, done: true } : s)))
  check('pickup first', 'after the pickup the delivery is next', N.nextLiveStep(after)?.id === 'd', N.nextLiveStep(after)?.id)
})
safe('item mismatch keeps order', () => {
  const other = j74(j74Steps('Copper', 'Iron'))
  check('item mismatch', 'different item: game order', N.nextLiveStep(other)?.id === 'd', N.nextLiveStep(other)?.id)
  const none = j74(j74Steps('', 'Iron'))
  check('item mismatch', 'pickup with no item: game order', N.nextLiveStep(none)?.id === 'd', N.nextLiveStep(none)?.id)
  const caseFold = j74(j74Steps('iron', 'IRON'))
  check('item mismatch', 'case-insensitive match moves the pickup', N.nextLiveStep(caseFold)?.id === 'p', N.nextLiveStep(caseFold)?.id)
  // combined "collect from A, deliver to B" step is not a plain pickup: order unchanged
  const combined = j74([
    { id: 'a', kind: 'turnin', label: 'Deliver Iron To X', location: 'X', item: 'Iron', have: 0, need: 1, done: false },
    { id: 'b', kind: 'pickup', label: 'Collect Iron', location: 'Y', pickupLocation: 'Z', item: 'Iron', have: 0, need: 1, done: false }
  ])
  check('item mismatch', 'combined pickupLocation step unaffected', N.nextLiveStep(combined)?.id === 'a', N.nextLiveStep(combined)?.id)
})

// F2: a marker point (system frame) 4 km from HDPC-Cassillo gets a near label; no "Not found in UEX"
safe('near label', () => {
  const roster = [...locations, ...otherPositions.filter((p) => !byName(p.name))]
  const hur = posByName('Hurston')
  const cas = posByName('HDPC-Cassillo')
  const position = { x: hur.x - 790556.763184, y: hur.y + 614240.106819, z: hur.z - 6055.992337 }
  const job = j74([{ ...j74Steps()[0], position }])
  const rows = N.listOpenStops([job], '', roster, { listOrder: 'distance' })
  const r = rows[0]
  const want = Math.hypot(position.x - cas.x, position.y - cas.y, position.z - cas.z)
  check('near label', 'marker row has near HDPC-Cassillo', r?.near?.name === 'HDPC-Cassillo', JSON.stringify(r?.near))
  check('near label', 'near distance ~4 km', r?.near && Math.abs(r.near.meters - want) < 1 && want > 3000 && want < 5000, `${r?.near?.meters} want ${want}`)
  check('near label', 'not "not-in-uex"', r?.noDistanceWhy !== 'not-in-uex', r?.noDistanceWhy)
  const g = N.groupByPlace(rows, roster)[0]
  check('near label', 'group carries near', g?.near?.name === 'HDPC-Cassillo', JSON.stringify(g?.near))
  const text = N.formatPlaceNear(r.place, r.near, roster)
  check('near label', 'label text', /^Security Compound.* · near HDPC-Cassillo \(4 km\)$/.test(text), text)
  // with a start: distance from the marker, still near
  const withStart = N.listOpenStops([job], 'HDPC-Cassillo', roster, { listOrder: 'distance' })[0]
  check('near label', 'with start: marker distance and near', withStart?.distanceSource === 'marker' && withStart?.near?.name === 'HDPC-Cassillo', `${withStart?.distanceSource} ${withStart?.distance}`)
  // UEX-placed rows get no near
  // the marker point borrows its body from the near place, so a leg from Lorville (also on Hurston) goes over the surface
  const fromLorville = N.listOpenStops([job], 'Lorville', roster, { listOrder: 'distance' })[0]
  check('near label', 'from Lorville: surface distance on Hurston', fromLorville?.surface === true && fromLorville?.distance > 1.6e6, `${fromLorville?.surface} ${fromLorville?.distance}`)
  const uex = N.listOpenStops([j74([j74Steps()[1]])], '', roster, {})[0]
  check('near label', 'UEX-placed row has no near', uex && !uex.near, JSON.stringify(uex?.near))
  // nothing within 25 km: no near
  const far = j74([{ ...j74Steps()[0], position: { x: hur.x + 5e6, y: hur.y, z: hur.z } }])
  const fr = N.listOpenStops([far], '', roster, {})[0]
  check('near label', 'no roster place within 25 km: no near', fr && !fr.near, JSON.stringify(fr?.near))
})

// J82 (export 2026-10-14): combined step, pickup "S1DCO06" (OCR doubled O) not yet collected, marker on the
// Security Compound drop-off ~4 km away; start = display-info read at Covalex S1DC06
safe('pickup doubled zero', () => {
  const roster = [...locations, ...otherPositions.filter((p) => !byName(p.name))]
  const want = 'Covalex Distribution Centre S1DC06'
  const raw = 'Covalex Distribution Center S1DCO06 on Hurston'
  const hit = typedMatch(raw, roster)
  check('pickup doubled zero', 'S1DCO06 resolves to Centre S1DC06 with coords', hit?.match?.name === want && hit?.match?.x != null, hit?.match?.name)
  check('pickup doubled zero', "S1DCO06: status 'corrected' with name evidence", hit?.status === 'corrected' && hit.evidence.some((e) => e.kind === 'name' && e.ok), `${hit?.status}`)
  check('pickup doubled zero', 'S1DC006 also folds to S1DC06', typedMatch('Covalex Distribution Centre S1DC006', roster)?.match?.name === want, '')
  const s6 = typedMatch('Covalex Distribution Centre S1DC6', roster)
  check('pickup doubled zero', 'S1DC6 (zero dropped) not matched', s6?.match?.name !== want, s6?.match?.name)
  const origin = { x: 12851200217, y: 15353, z: 671084, system: 'Stanton', body: 'Hurston' }
  const position = { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
  const step = (o) => ({ id: 's82', kind: 'turnin', label: `Collect Scrap from ${o.pickupLocation}. Deliver Scrap to Security Compound`,
    location: 'Security Compound', item: 'Scrap', have: 0, need: 1, done: false, position, pickedUp: false, ...o })
  const j82 = (st) => ({ id: 'j82', ref: 'J82', title: 'Scrap', kind: 'delivery', reward: 33000, status: 'active', createdAt: 1, steps: [st] })
  const rows = (st) => N.listOpenStops([j82(st)], '', roster, { listOrder: 'distance', origin })
  // unresolvable pickup name: no distance, never the drop-off marker's ~4 km
  const lost = rows(step({ pickupLocation: 'Covalex Distribution Center S1DCQQ6 on Hurston' }))[0]
  check('pickup doubled zero', 'unresolvable pickup: no distance (not the 4 km marker)', lost && lost.distance == null && lost.noDistance === true, `${lost?.distance} ${lost?.distanceSource}`)
  check('pickup doubled zero', 'unresolvable pickup: no near label', lost && !lost.near, JSON.stringify(lost?.near))
  check('pickup doubled zero', 'unresolvable pickup: why not-in-uex', lost?.noDistanceWhy === 'not-in-uex', lost?.noDistanceWhy)
  const lostT = N.stepDistanceFromStart('Covalex Distribution Centre S1DC06', step({ pickupLocation: 'Nowhere S9QQ9' }), roster)
  check('pickup doubled zero', 'stepDistanceFromStart: no marker before pickup', lostT == null, String(lostT))
  // the real name: ~0.3 km from the start at Covalex
  const ok = rows(step({ pickupLocation: raw }))[0]
  check('pickup doubled zero', 'S1DCO06 pickup: ~0.3 km from start', ok?.distanceSource === 'uex' && ok.distance > 200 && ok.distance < 400, `${ok?.distance} ${ok?.distanceSource}`)
  check('pickup doubled zero', 'S1DCO06 pickup: no near label', ok && !ok.near, JSON.stringify(ok?.near))
  // after pickup the place is Security Compound (not in the roster): the marker gives ~4 km
  const after = rows(step({ pickupLocation: raw, pickedUp: true }))[0]
  check('pickup doubled zero', 'after pickup: marker ~4 km', after?.distanceSource === 'marker' && after.distance > 3500 && after.distance < 4600, `${after?.distance} ${after?.distanceSource}`)
})

// batch 7: every stop's place comes from the one resolver (resolveStopPlace); rows and groups carry its answer
safe('resolver wiring', () => {
  const roster = [...locations, ...otherPositions.filter((p) => !byName(p.name))]
  const rows = N.listOpenStops(jobs, START, locations, { listOrder: 'distance' })
  check('resolver wiring', 'every row carries match with a status', rows.every((r) => r.match && typeof r.match.status === 'string'), rows.map((r) => r.match?.status).join(','))
  check('resolver wiring', "roster rows: match exact, source 'roster' -> distanceSource 'uex'", rows.filter((r) => placeOf(r) !== OFF_MAP).every((r) => r.match.status === 'exact' && r.match.source === 'roster' && r.distanceSource === 'uex'), rows.map((r) => `${r.match?.status}/${r.match?.source}/${r.distanceSource}`).join(','))
  const off = rows.find((r) => placeOf(r) === OFF_MAP)
  check('resolver wiring', "off-map: match 'none', no point, 'not-in-uex'", off?.match.status === 'none' && !off.match.point && !off.point && off.noDistanceWhy === 'not-in-uex', `${off?.match.status} ${off?.noDistanceWhy}`)
  check('resolver wiring', 'row point is match.point', rows.every((r) => r.point === r.match.point), '')
  const groups = N.groupByPlace(rows, locations)
  check('resolver wiring', "group.match is its first row's", groups.every((g) => g.match === g.rows[0].match), '')

  // J82 shape: pickup S1DCO06 not collected -> corrected to Centre S1DC06, ~0.3 km; after pickup the marker decides
  const origin = { x: 12851200217, y: 15353, z: 671084, system: 'Stanton', body: 'Hurston' }
  const position = { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
  const st = (o) => ({ id: 'w82', kind: 'turnin', label: 'Deliver Scrap to Security Compound', location: 'Security Compound', item: 'Scrap',
    have: 0, need: 1, done: false, position, pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston', pickedUp: false, ...o })
  const jb = (s1) => ({ id: 'jw82', ref: 'J82', title: 'Scrap', kind: 'delivery', reward: 1, status: 'active', createdAt: 1, steps: [s1] })
  const pick = N.listOpenStops([jb(st({}))], '', roster, { listOrder: 'distance', origin })[0]
  check('resolver wiring', "J82 pickup: match 'corrected' to Centre S1DC06", pick?.match.status === 'corrected' && pick.match.match?.name === 'Covalex Distribution Centre S1DC06', `${pick?.match.status} ${pick?.match.match?.name}`)
  check('resolver wiring', 'J82 pickup: no marker evidence (marker belongs to the drop-off)', pick && !pick.match.evidence.some((e) => e.kind === 'marker'), JSON.stringify(pick?.match.evidence))
  check('resolver wiring', 'J82 pickup: typed-like origin gives no here evidence', pick && !pick.match.evidence.some((e) => e.kind === 'here'), '')
  const read = N.listOpenStops([jb(st({}))], '', roster, { listOrder: 'distance', origin, originIsRead: true })[0]
  check('resolver wiring', 'originIsRead: here evidence on the pickup', read?.match.evidence.some((e) => e.kind === 'here' && e.ok), JSON.stringify(read?.match.evidence))
  const after = N.listOpenStops([jb(st({ pickedUp: true }))], '', roster, { listOrder: 'distance', origin })[0]
  check('resolver wiring', "after pickup: match 'marker', near = match.near", after?.match.status === 'marker' && after.distanceSource === 'marker' && after.near === after.match.near && !!after.near, `${after?.match.status} ${JSON.stringify(after?.near)}`)
  // after pickup the generic site belongs to the place the contract names (addendum): site Covalex S1DC06 from 'contract'
  check('resolver wiring', "after pickup: site Covalex S1DC06 from 'contract'", after?.match.site?.from === 'contract' && /S1DC06$/.test(after.match.site.name), JSON.stringify(after?.match.site))
  // markers off: no marker, so the contract's place is the point ('guess', confidence 5), never another place's distance
  const off2 = N.listOpenStops([jb(st({ pickedUp: true }))], '', roster, { listOrder: 'distance', origin, markerDistance: false })[0]
  check('resolver wiring', "markers off: 'guess' at the contract's place (~0.3 km)", off2?.match.status === 'guess' && off2.match.confidence === 5 && off2.match.site?.from === 'contract' && off2.distanceSource === 'uex' && off2.distance > 200 && off2.distance < 400, `${off2?.match.status} ${off2?.distance}`)
  // the job is passed through: a site named only in another step of the job finds that place (with its marker within 25 km;
  // without a marker only the step's own text may name the parent, so J74's compound isn't guessed at its pickup)
  const twoSteps = { ...jb(st({ pickedUp: true, pickupLocation: undefined, label: 'Deliver Scrap to Security Compound' })), steps: [
    { id: 'w82p', kind: 'pickup', label: 'Collect Scrap', location: 'Covalex Distribution Center S1DCO06 on Hurston', item: 'Scrap', have: 0, need: 1, done: true },
    st({ pickedUp: true, pickupLocation: undefined, label: 'Deliver Scrap to Security Compound' })
  ] }
  const viaJob = N.listOpenStops([twoSteps], '', roster, { listOrder: 'distance', origin })[0]
  check('resolver wiring', "job passed: site from the job's other step", viaJob?.match.site?.from === 'contract' && /S1DC06$/.test(viaJob.match.site.name), `${viaJob?.match.status} ${JSON.stringify(viaJob?.match.site)}`)

  // batch 8: opts.memory reaches the resolver (a 'user' entry decides the place); stepDistanceFromStart takes it too
  const key = pick?.match.memoryKey
  check('resolver wiring', 'row match carries a memoryKey', typeof key === 'string' && key.length > 0, String(key))
  const at = '2026-10-14T00:00:00.000Z'
  const userEntry = { key, text: pick?.match.text, place: 'Port Tressler', origin: 'user', confirmed: 0, wrong: 0, seen: 1, firstAt: at, lastAt: at }
  const memory = (k) => (k === key ? userEntry : undefined)
  const mine = N.listOpenStops([jb(st({}))], '', roster, { listOrder: 'distance', origin, memory })[0]
  check('resolver wiring', "opts.memory: user entry -> status 'user' at that place", mine?.match.status === 'user' && mine.match.match?.name === 'Port Tressler' && mine.match.memory?.origin === 'user', `${mine?.match.status} ${mine?.match.match?.name}`)
  const pt = byName('Port Tressler')
  const dMem = N.stepDistanceFromStart(START, jb(st({})).steps[0], roster, true, jb(st({})), memory)
  check('resolver wiring', 'stepDistanceFromStart(memory): distance to the user place', near(dMem, dist(byName(START), pt)), `${dMem}`)
  const dNo = N.stepDistanceFromStart(START, jb(st({})).steps[0], roster, true, jb(st({})))
  check('resolver wiring', 'stepDistanceFromStart without memory: unchanged', !near(dNo, dist(byName(START), pt)), `${dNo}`)

  // batch 9: typed start, where-name and startLocation all go through resolveStartText with the same memory
  const S1 = 'Covalex Distribution Center S1DCO06 on Hurston'
  const tKey = typedMatch(S1, roster)?.memoryKey
  check('resolver wiring', 'typed start match carries a memoryKey', typeof tKey === 'string' && tKey.length > 0, String(tKey))
  const tEntry = { key: tKey, text: S1, place: 'Port Tressler', origin: 'user', confirmed: 0, wrong: 0, seen: 1, firstAt: at, lastAt: at }
  const tMem = (k) => (k === tKey ? tEntry : undefined)
  const tUser = N.resolveOrigin({ typed: S1, mode: 'fixed', locations: roster, memory: tMem })
  check('resolver wiring', "typed start + memory: status 'user', point at that place", tUser.match?.status === 'user' && near(tUser.point?.x, pt.x), `${tUser.match?.status} ${tUser.match?.match?.name}`)
  const wUser = N.resolveOrigin({ where: { name: S1, label: S1, system: 'stanton', body: null, source: 'inventory', at }, mode: 'auto', locations: roster, memory: tMem, now: Date.parse(at) })
  check('resolver wiring', "where name + memory: status 'user', point at that place", wUser.match?.status === 'user' && near(wUser.point?.x, pt.x), `${wUser.match?.status}`)
  const wNo = N.resolveOrigin({ where: { name: S1, label: S1, system: 'stanton', body: null, source: 'inventory', at }, mode: 'auto', locations: roster, now: Date.parse(at) })
  check('resolver wiring', "where name without memory: 'corrected' Covalex S1DC06", wNo.match?.status === 'corrected' && /S1DC06$/.test(wNo.match?.match?.name ?? ''), `${wNo.match?.status} ${wNo.match?.match?.name}`)
  const wPt = N.resolveOrigin({ where: { name: 'Port Tressler', label: 'Port Tressler', point: { x: 1, y: 2, z: 3, system: 'stanton', body: null }, system: 'stanton', body: null, source: 'displayinfo', at }, mode: 'auto', locations: roster, now: Date.parse(at) })
  check('resolver wiring', 'where with its own point keeps it; match still given', wPt.point?.x === 1 && wPt.match?.status === 'exact', `${wPt.point?.x} ${wPt.match?.status}`)
  const ptJob = job(80, 'Port Tressler')
  const viaStart = N.listOpenStops([ptJob], S1, roster, { listOrder: 'distance', markerDistance: false, memory: tMem })[0]
  check('resolver wiring', 'listOpenStops startLocation + memory: start at the user place (0 m)', near(viaStart?.distance, 0) || (viaStart?.distance != null && viaStart.distance < 1), `${viaStart?.distance}`)
  const withBody = roster.find((l) => l.body && l.x != null && l.system && !/\d/.test(l.name))
  const fmt = N.formatPlaceWithBodySystem(withBody?.name ?? '', roster)
  check('resolver wiring', 'formatPlaceWithBodySystem via resolver: body + system chips', /Body \[/.test(fmt) && /System \[/.test(fmt), fmt)

  // a roster name whose game marker is far away: the marker wins the distance (never the roster place's)
  const ev = byName('Everus Harbor')
  const far = { ...job(60, 'Port Tressler'), steps: [{ ...job(60, 'Port Tressler').steps[0], position: { x: ev.x, y: ev.y, z: ev.z } }] }
  const fr = N.listOpenStops([far], START, locations, { listOrder: 'distance' })[0]
  check('resolver wiring', 'name vs far marker: distance to the marker', fr?.distanceSource === 'marker' && near(fr?.distance, dist(byName(START), ev)) && ['marker', 'mismatch'].includes(fr?.match.status), `${fr?.match.status} ${fr?.distanceSource} ${fr?.distance}`)
  const frOff = N.listOpenStops([far], START, locations, { listOrder: 'distance', markerDistance: false })[0]
  check('resolver wiring', 'same with markers off: roster place', frOff?.distanceSource === 'uex' && near(frOff?.distance, dist(byName(START), byName('Port Tressler'))), `${frOff?.match.status} ${frOff?.distance}`)

  // one resolveStopPlace per step per listOpenStops run (the sort compares reuse it): count reads of step.position
  if (typeof RS.resolveStopPlace !== 'function') return check('resolver wiring', 'resolveStopPlace exported', false, 'missing')
  const counted = (base) => {
    let n = 0
    const s1 = new Proxy(base, { get: (t, k) => { if (k === 'position') n++; return t[k] } })
    return { s1, reads: () => n, reset: () => { n = 0 } }
  }
  const c = counted({ ...job(70, 'Nowhere Gulch Camp 7').steps[0], position: { x: byName(START).x + 1000, y: byName(START).y, z: byName(START).z } })
  RS.resolveStopPlace(c.s1, { locations, useMarker: true })
  const perCall = c.reads()
  c.reset()
  const many = [{ ...job(70, 'x'), steps: [c.s1] }, ...PLACES.map((p, i) => job(71 + i, p))]
  N.listOpenStops(many, START, locations, { listOrder: 'distance' })
  check('resolver wiring', 'distance sort: one resolve per step', perCall > 0 && c.reads() === perCall, `reads ${c.reads()} per call ${perCall}`)
  c.reset()
  N.listOpenStops(many, START, locations, { listOrder: 'distance', showAll: true })
  check('resolver wiring', 'show-all sort: one resolve per step', c.reads() === perCall, `reads ${c.reads()} per call ${perCall}`)
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
