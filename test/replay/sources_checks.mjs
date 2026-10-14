// Data source switches: bundles src/other/renderer/state/otherPlaces.ts (store and log stubbed) and checks
// mergeLocations with the starmap source on / off: starmap-only places gone, starmap-filled coords stripped,
// UEX coords kept, counts per source, the off-source list and the switch reading the setting.
// Usage: node test/replay/sources_checks.mjs   (no build needed)   --verbose prints every check

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sources-'))

// renderer stubs: a settable store and a silent log
const stub = path.join(tmp, 'renderer')
fs.mkdirSync(path.join(stub, 'state'), { recursive: true })
fs.writeFileSync(
  path.join(stub, 'state', 'store.js'),
  // one store on globalThis: the bundle inlines its own copy of this file
  `const g = (globalThis.__scStub ??= { state: { settings: {}, locations: [] }, subs: new Set() })
const subs = g.subs
export const useStore = globalThis.__scStore ??= Object.assign((sel) => sel(g.state), {
  getState: () => g.state,
  setState: (patch) => { const prev = g.state; g.state = { ...g.state, ...patch }; for (const s of subs) s(g.state, prev) },
  subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) }
})
`
)
fs.writeFileSync(path.join(stub, 'state', 'log.js'), `const n = () => {}\nexport const dlog = { info: n, debug: n, warn: n, error: n }\n`)

const outfile = path.join(tmp, 'otherPlaces.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/renderer/state/otherPlaces.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  external: ['react'],
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: {
    '@shared': path.join(root, 'src/shared'),
    '@other': path.join(root, 'src/other'),
    '@renderer/state/store': path.join(stub, 'state', 'store.js'),
    '@renderer/state/log': path.join(stub, 'state', 'log.js')
  }
})
// react is only used by the hook; give the bundle a resolvable copy
fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true })
fs.symlinkSync(path.join(root, 'node_modules', 'react'), path.join(tmp, 'node_modules', 'react'), 'junction')
const P = await import(pathToFileURL(outfile).href)
const { useStore } = await import(pathToFileURL(path.join(stub, 'state', 'store.js')).href)
const verbose = process.argv.includes('--verbose')

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}
const J = (x) => JSON.stringify(x)

// haul roster (upstream, untagged = UEX)
const haul = [
  { name: 'Port Tressler', code: 'PT', maxContainerSize: 32, uexId: 1, x: 1, y: 2, z: 3, system: 'stanton' },
  { name: 'HUR-L1 Green Glade Station', code: 'HUR-L1', maxContainerSize: 32, uexId: 2, system: 'stanton' }
]
// Other places as main/uex.ts tags them
const others = [
  // UEX place, coords from the haul roster
  { name: 'Lorville', code: 'LOR', maxContainerSize: 0, uexId: 10, source: 'uex', coordsFrom: 'uex', x: 10, y: 20, z: 30, system: 'stanton', body: 'Hurston' },
  // UEX place, coords filled from the starmap
  { name: 'Covalex Distribution Centre S1DC06', code: '', maxContainerSize: 0, uexId: 11, source: 'uex', coordsFrom: 'starmap', x: 5, y: 6, z: 7, system: 'stanton', body: 'Hurston' },
  // UEX place with no coords at all
  { name: 'Nowhere Depot', code: 'ND', maxContainerSize: 0, uexId: 12, source: 'uex', system: 'stanton' },
  // starmap-only places
  { name: 'Shubin Mining Facility SAL-2', code: '', maxContainerSize: 0, uexId: 0, source: 'starmap', coordsFrom: 'starmap', x: 8, y: 9, z: 10, system: 'Stanton', body: 'Lyria' },
  { name: 'Aid Shelter ARC-7', code: '', maxContainerSize: 0, uexId: 0, source: 'starmap', coordsFrom: 'starmap', x: 11, y: 12, z: 13, system: 'Stanton', body: 'Wala' },
  // the haul roster has this name without coords; the starmap fills them
  { name: 'HUR-L1 Green Glade Station', code: 'HUR-L1', maxContainerSize: 0, uexId: 13, source: 'uex', coordsFrom: 'starmap', x: 40, y: 41, z: 42, system: 'stanton' }
]
const byName = (list, n) => list.find((l) => l.name === n)

safe('on', () => {
  const m = P.mergeLocationsWith(haul, others, true)
  check('on', 'every place listed (haul 2 + 5 new names)', m.length === 7, J(m.map((l) => l.name)))
  check('on', 'starmap-only places kept', !!byName(m, 'Shubin Mining Facility SAL-2') && !!byName(m, 'Aid Shelter ARC-7'))
  const cov = byName(m, 'Covalex Distribution Centre S1DC06')
  check('on', 'starmap-filled coords kept', cov?.x === 5 && cov?.coordsFrom === 'starmap', J(cov))
  const hur = byName(m, 'HUR-L1 Green Glade Station')
  check('on', 'haul place without coords gets starmap coords, keeps UEX source', hur?.x === 40 && hur?.coordsFrom === 'starmap' && hur?.source === undefined && hur?.maxContainerSize === 0, J(hur))
  const pt = byName(m, 'Port Tressler')
  check('on', 'haul coords kept', pt?.x === 1 && pt?.y === 2 && pt?.z === 3, J(pt))
})

safe('off', () => {
  const m = P.mergeLocationsWith(haul, others, false)
  check('off', 'starmap-only places gone', !byName(m, 'Shubin Mining Facility SAL-2') && !byName(m, 'Aid Shelter ARC-7'), J(m.map((l) => l.name)))
  check('off', 'no place left with source starmap', !m.some((l) => l.source === 'starmap'))
  const cov = byName(m, 'Covalex Distribution Centre S1DC06')
  check('off', 'starmap-filled place still listed', !!cov)
  check('off', 'its starmap coords stripped', cov && cov.x === undefined && cov.y === undefined && cov.z === undefined && cov.coordsFrom === undefined, J(cov))
  check('off', 'its other fields kept (body, system, uexId)', cov?.body === 'Hurston' && cov?.system === 'stanton' && cov?.uexId === 11, J(cov))
  const hur = byName(m, 'HUR-L1 Green Glade Station')
  check('off', 'haul place stays without coords (no starmap fill)', hur && hur.x === undefined && hur.uexId === 2, J(hur))
  const lor = byName(m, 'Lorville')
  check('off', 'UEX coords kept', lor?.x === 10 && lor?.y === 20 && lor?.z === 30 && lor?.coordsFrom === 'uex', J(lor))
  const pt = byName(m, 'Port Tressler')
  check('off', 'haul roster coords kept', pt?.x === 1, J(pt))
  check('off', 'UEX place without coords still listed', !!byName(m, 'Nowhere Depot'))
  check('off', 'input arrays not changed', others[1].x === 5 && others[3].source === 'starmap')
})

safe('counts', () => {
  const c = P.sourceCounts(haul, others)
  // UEX: Port Tressler, HUR-L1, Lorville, Covalex, Nowhere = 5; with UEX coords: Port Tressler, Lorville = 2
  check('counts', 'UEX places / with coords', c.uex.places === 5 && c.uex.withCoords === 2, J(c))
  check('counts', 'starmap adds 2, fills 2', c.starmap.adds === 2 && c.starmap.fills === 2, J(c))
})

safe('offSource', () => {
  check('offSource', 'nothing off when the starmap is on', P.offSourcePlaces(haul, others, true).size === 0)
  const off = P.offSourcePlaces(haul, others, false)
  check('offSource', 'starmap-only places are off (place)', off.get('shubin mining facility sal-2') === 'place' && off.get('aid shelter arc-7') === 'place', J([...off]))
  check('offSource', 'starmap-filled coords are off (coords)', off.get('covalex distribution centre s1dc06') === 'coords' && off.get('hur-l1 green glade station') === 'coords', J([...off]))
  check('offSource', 'UEX places not listed', !off.has('lorville') && !off.has('port tressler') && !off.has('nowhere depot'), J([...off]))
})

safe('setting', () => {
  P.setOtherPlaces(others)
  useStore.setState({ settings: {} })
  check('setting', 'default on', P.starmapSourceOn() === true && P.mergeLocations(haul).length === 7)
  const v0 = P.otherPlacesVersion()
  useStore.setState({ settings: { otherSourceStarmap: false } })
  check('setting', 'off -> mergeLocations drops starmap', P.starmapSourceOn() === false && P.mergeLocations(haul).length === 5, J(P.mergeLocations(haul).map((l) => l.name)))
  check('setting', 'switching bumps the places version', P.otherPlacesVersion() > v0, `${v0} -> ${P.otherPlacesVersion()}`)
  const v1 = P.otherPlacesVersion()
  useStore.setState({ settings: { otherSourceStarmap: false, otherShowRep: true } })
  check('setting', 'an unrelated setting does not bump it', P.otherPlacesVersion() === v1)
  useStore.setState({ settings: { otherSourceStarmap: true } })
  check('setting', 'back on -> all places again', P.mergeLocations(haul).length === 7 && P.otherPlacesVersion() > v1)
})

// same place listed twice (haul: coords, no body; starmap: body): the body is filled so "on <Body>" can be checked
{
  const pos = { x: 22461752747.46, y: 37186642798.64, z: -290234.08 }
  const haulS4 = { name: 'Covalex Distribution Centre S4DC05', code: 'S4DC05', maxContainerSize: 0, uexId: 725, ...pos, system: 'stanton' }
  const smS4 = { name: 'Covalex Distribution Centre S4DC05', code: '', maxContainerSize: 0, uexId: 0, ...pos, system: 'stanton', body: 'microTech', source: 'starmap', coordsFrom: 'starmap' }
  const far = { ...smS4, x: pos.x + 50_000 }
  const got = P.mergeLocationsWith([haulS4], [smS4], true).find((l) => l.code === 'S4DC05')
  check('body fill', 'same name, same spot: body taken from the other listing', got?.body === 'microTech' && got?.uexId === 725, J(got))
  const away = P.mergeLocationsWith([haulS4], [far], true)[0]
  check('body fill', 'over 1 km apart: no body copied', !away.body, J(away))
  const uexCenter = { ...haulS4, name: 'Covalex Distribution Center S4DC05' }
  const twin = P.mergeLocationsWith([uexCenter], [smS4], true).find((l) => l.name.endsWith('Center S4DC05'))
  check('body fill', 'Center/Centre spellings at the same spot share the body', twin?.body === 'microTech', J(twin))
}

const failed = results.filter((r) => !r.ok)
for (const r of results) if (verbose || !r.ok) console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${r.name}] ${r.what}${r.ok ? '' : `  ${r.detail}`}`)
console.log(`sources_checks: ${results.length - failed.length}/${results.length} passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed.length ? 1 : 0)
