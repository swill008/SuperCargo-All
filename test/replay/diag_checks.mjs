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
const T = await bundle('src/shared/trace.ts')

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

safe('stitch', () => {
  // solid-colour test pictures: 4 bytes per pixel, BGRA
  const pic = (width, height, b, g, r) => {
    const bgra = new Uint8Array(width * height * 4)
    for (let i = 0; i < bgra.length; i += 4) bgra.set([b, g, r, 255], i)
    return { width, height, bgra }
  }
  const px = (bm, x, y) => Array.from(bm.bgra.subarray((y * bm.width + x) * 4, (y * bm.width + x) * 4 + 4)).join(',')
  const a = pic(3, 2, 10, 20, 30)
  const b = pic(2, 5, 40, 50, 60)
  const c = pic(4, 1, 70, 80, 90)
  const s = T.stitchBitmaps([a, b, c])
  check('stitch', 'size: widths + 2 gaps of 16, tallest height', s.width === 3 + 2 + 4 + 2 * 16 && s.height === 5 && s.bgra.length === s.width * s.height * 4, `${s.width}x${s.height}`)
  check('stitch', 'gap is 16 (default)', T.STITCH_GAP === 16, String(T.STITCH_GAP))
  check('stitch', 'first picture top-left, unscaled', px(s, 0, 0) === '10,20,30,255' && px(s, 2, 1) === '10,20,30,255', `${px(s, 0, 0)} ${px(s, 2, 1)}`)
  check('stitch', 'below a short picture is opaque black', px(s, 0, 2) === '0,0,0,255' && px(s, 2, 4) === '0,0,0,255', `${px(s, 0, 2)} ${px(s, 2, 4)}`)
  check('stitch', 'gap columns are black', px(s, 3, 0) === '0,0,0,255' && px(s, 18, 0) === '0,0,0,255' && px(s, 10, 3) === '0,0,0,255', `${px(s, 3, 0)} ${px(s, 18, 0)}`)
  check('stitch', 'second picture at x 19, top-aligned, full height', px(s, 19, 0) === '40,50,60,255' && px(s, 20, 4) === '40,50,60,255' && px(s, 21, 0) === '0,0,0,255', `${px(s, 19, 0)} ${px(s, 20, 4)} ${px(s, 21, 0)}`)
  check('stitch', 'third picture at x 37, one row only', px(s, 37, 0) === '70,80,90,255' && px(s, 40, 0) === '70,80,90,255' && px(s, 37, 1) === '0,0,0,255', `${px(s, 37, 0)} ${px(s, 40, 0)} ${px(s, 37, 1)}`)
  const one = T.stitchBitmaps([a])
  check('stitch', 'one picture -> same size and pixels, no gap', one.width === 3 && one.height === 2 && Buffer.from(one.bgra).equals(Buffer.from(a.bgra)), `${one.width}x${one.height}`)
  const none = T.stitchBitmaps([])
  check('stitch', 'no pictures -> 0x0', none.width === 0 && none.height === 0 && none.bgra.length === 0, `${none.width}x${none.height}`)
  const bad = T.stitchBitmaps([a, { width: 5, height: 5, bgra: new Uint8Array(4) }])
  check('stitch', 'short buffer is skipped', bad.width === 3 && bad.height === 2, `${bad.width}x${bad.height}`)
})

safe('copy lines', () => {
  check('copy lines', 'text: "Text copied · 1.1 MB"', T.diagCopyTextLine({ ok: true, bytes: 1.1 * 1024 * 1024 }) === 'Text copied · 1.1 MB', T.diagCopyTextLine({ ok: true, bytes: 1.1 * 1024 * 1024 }))
  check('copy lines', 'images: "Picture copied (3 in one)"', T.diagCopyImagesLine({ ok: true, width: 10, height: 5 }, 3) === 'Picture copied (3 in one)', T.diagCopyImagesLine({ ok: true }, 3))
  check('copy lines', 'error shown as is', T.diagCopyTextLine({ ok: false, error: 'no export yet' }) === 'no export yet' && T.diagCopyImagesLine({ ok: false, error: 'no export yet' }, 0) === 'no export yet', '')
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
