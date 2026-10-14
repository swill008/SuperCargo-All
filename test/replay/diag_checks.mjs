// Diagnostics explainers: explainPlaceLookup (otherNext) and explainTravel (otherGeo) agree with
// findRosterLocation / travel and say which step matched. Usage: node test/replay/diag_checks.mjs

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-diag-checks-'))

async function bundle(rel) {
  const outfile = path.join(tmp, path.basename(rel).replace(/\.ts$/, '.mjs'))
  esbuild.buildSync({
    entryPoints: [path.join(root, rel)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    tsconfig: path.join(root, 'tsconfig.node.json'),
    alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
  })
  return import(pathToFileURL(outfile).href)
}
const N = await bundle('src/other/otherNext.ts')
const G = await bundle('src/other/otherGeo.ts')

const locations = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
const positions = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const byName = (n) => locations.find((l) => l.name === n)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * 1e-9)

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}

safe('lookup', () => {
  // explain and findRosterLocation must agree on the match for every case
  const agree = (raw, locs) => {
    const e = N.explainPlaceLookup(raw, locs)
    const hit = N.findRosterLocation(raw, locs)
    check('lookup', `agrees with findRosterLocation: ${raw}`, (e.match ?? null) === (hit?.name ?? null), `${e.match} vs ${hit?.name}`)
    return e
  }
  const ex = agree('Port Tressler', locations)
  check('lookup', 'exact name -> exact, coords', ex.method === 'exact' && ex.match === 'Port Tressler' && ex.hasCoords === true, JSON.stringify(ex))
  const fo = agree('Covalex Distribution Center S1DCO6 on Hurston', locations)
  check('lookup', 'S1DCO6 -> folded to S1DC06', fo.method === 'folded' && fo.match === 'Covalex Distribution Center S1DC06', JSON.stringify(fo))
  check('lookup', 'candidates <= 5, chosen first', fo.candidates.length >= 1 && fo.candidates.length <= 5 && fo.candidates[0].name === fo.match, JSON.stringify(fo.candidates))
  const twoSpellings = [
    { name: 'Covalex Distribution Center S1DC06', code: '', maxContainerSize: 0, uexId: 1, system: 'stanton' },
    { name: 'Covalex Distribution Centre S1DC06', code: '', maxContainerSize: 0, uexId: 0, system: 'stanton', body: 'Hurston', x: 1, y: 2, z: 3 }
  ]
  const two = agree('Covalex Distribution Center S1DCO6 on Hurston', twoSpellings)
  check('lookup', 'Center/Centre -> folded, picks the one with coords', two.method === 'folded' && two.match === 'Covalex Distribution Centre S1DC06' && two.hasCoords === true && two.candidates.length === 2, JSON.stringify(two))
  const none = agree('Nowhere Gulch Camp 7', locations)
  check('lookup', 'unknown -> none, no match, no coords', none.method === 'none' && none.match === undefined && none.hasCoords === false && none.candidates.length <= 5, JSON.stringify(none))
  const empty = N.explainPlaceLookup('   ', locations)
  check('lookup', 'blank -> none', empty.method === 'none' && empty.candidates.length === 0, JSON.stringify(empty))
  for (const raw of ['HUR-L1 Green Glade Station', 'Everus Harbor', 'Baijini Point', 'Seraphim', 'Covalex Distribution Center S4DC05']) agree(raw, locations)
})

safe('travel', () => {
  const a = byName('ARC-L5 Yellow Core Station')
  const b = byName('Baijini Point')
  const same = G.explainTravel(N.locationPoint(a), N.locationPoint(b), locations)
  const t = G.travel(N.locationPoint(a), N.locationPoint(b), locations)
  check('travel', 'same system: keys equal, no gateways, meters = travel()', same.sameSystem && same.aSystem === 'stanton' && same.bSystem === 'stanton' && !same.gatewayOut && !same.gatewayIn && same.jumps === 0 && near(same.meters, t.meters), JSON.stringify(same))

  const pyroStop = locations.find((l) => l.system === 'pyro' && l.x != null && !/gateway/i.test(l.name))
  const x = G.explainTravel(N.locationPoint(a), N.locationPoint(pyroStop), locations)
  const gwA = byName('Pyro Gateway (Stanton)')
  const gwB = byName('Stanton Gateway (Pyro)')
  check('travel', 'Pyro: gateway names, 1 jump, meters via gateways', !x.sameSystem && x.bSystem === 'pyro' && x.gatewayOut === 'Pyro Gateway (Stanton)' && x.gatewayIn === 'Stanton Gateway (Pyro)' && x.jumps === 1 && near(x.meters, dist(a, gwA) + dist(gwB, pyroStop)), JSON.stringify(x))
  const noGw = locations.filter((l) => !/gateway/i.test(l.name))
  const ng = G.explainTravel(N.locationPoint(a), N.locationPoint(pyroStop), noGw)
  check('travel', "no gateway -> meters null, why 'no gateway'", ng.meters === null && ng.why === 'no gateway', JSON.stringify(ng))

  const pit = positions.find((p) => p.name === '"The Pit"')
  const wheel = positions.find((p) => p.name === '"Wheeler\'s"')
  const s = G.explainTravel(pit, wheel, positions)
  const ts = G.travel(pit, wheel, positions)
  check('travel', 'Lyria The Pit -> Wheeler\'s: surface, body Lyria, meters = travel()', s.surface === true && /lyria/i.test(s.body ?? '') && near(s.meters, ts.meters), JSON.stringify(s))
  const nop = G.explainTravel(undefined, N.locationPoint(b), locations)
  check('travel', "missing point -> why 'no point'", nop.meters === null && nop.why === 'no point', JSON.stringify(nop))
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
