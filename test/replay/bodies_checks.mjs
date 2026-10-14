// Planet table checks: bundles src/other/otherBodies.ts and runs it on the bundled starmap roster.
// Usage: node test/replay/bodies_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-bodies-'))
const outfile = path.join(tmp, 'otherBodies.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherBodies.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const B = await import(pathToFileURL(outfile).href)

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const km = (m) => (m == null ? 'null' : `${(m / 1000).toFixed(1)} km`)
const near = (m, want, tol) => typeof m === 'number' && Math.abs(m - want) <= tol

const roster = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const AT = '2026-10-14T12:00:00.000Z'

// ---- build from the roster ----
const table = B.buildBodies(roster)
const bodyNames = new Set(roster.map((p) => p.body).filter(Boolean))
check('build', 'every roster body with a centre entry is in the table', [...bodyNames].every((n) => table[B.bodyKey(n)]), `${Object.keys(table).length}/${bodyNames.size}`)
const hur = table.hurston
check('build', 'Hurston estimate ~1000 km', hur && hur.radiusSource === 'estimate' && near(hur.radiusEstM, 1_000_000, 30_000), km(hur?.radiusEstM))
const lyr = table.lyria
check('build', 'Lyria estimate ~224 km', lyr && near(lyr.radiusEstM, 224_000, 10_000), km(lyr?.radiusEstM))
check('build', 'Lyria parent ArcCorp (from its roster entry)', lyr?.parent === 'ArcCorp', lyr?.parent)
check('build', 'Hurston has no parent; type undefined (roster has none)', hur && hur.parent === undefined && hur.type === undefined, `${hur?.parent} ${hur?.type}`)
const hurEntry = roster.find((p) => p.name === 'Hurston')
check('build', 'Hurston centre = its roster entry', hur && hur.centre.x === hurEntry.x && hur.centre.y === hurEntry.y && hur.centre.z === hurEntry.z, JSON.stringify(hur?.centre))
check('build', 'no panel radius yet: seen 0', hur?.seen === 0 && hur?.radiusM === undefined, `${hur?.seen}`)
check('lookup', 'bodyRadiusFromTable falls back to the estimate', B.bodyRadiusFromTable(table, 'Hurston') === hur?.radiusEstM, km(B.bodyRadiusFromTable(table, 'Hurston')))
check('lookup', 'lookup is case-insensitive', B.bodyRadiusFromTable(table, 'HURSTON') === B.bodyRadiusFromTable(table, 'hurston'))
check('lookup', 'unknown body -> null', B.bodyRadiusFromTable(table, 'Nowhere') === null)
check('build', 'body without a centre entry is skipped', !B.buildBodies([{ name: 'X Outpost', system: 'stanton', body: 'Ghost', x: 1, y: 2, z: 3 }]).ghost)

// ---- panel radius ----
let doc = { bodies: table, learned: [] }
const d1 = B.recordPanelRadius(doc, 'Hurston', 'Stanton', 1_000_123, AT)
check('panel', 'panel radius wins over the estimate', B.bodyRadiusFromTable(d1.bodies, 'Hurston') === 1_000_123 && d1.bodies.hurston.radiusSource === 'panel', km(B.bodyRadiusFromTable(d1.bodies, 'Hurston')))
check('panel', 'seen / lastSeen bump', d1.bodies.hurston.seen === 1 && d1.bodies.hurston.lastSeen === AT, `${d1.bodies.hurston.seen}`)
const d2 = B.recordPanelRadius(d1, 'hurston', 'Stanton', 1_000_100, '2026-10-14T12:05:00.000Z')
check('panel', 'second read: seen 2, value updated', d2.bodies.hurston.seen === 2 && d2.bodies.hurston.radiusM === 1_000_100)
check('panel', 'input doc not mutated', doc.bodies.hurston.seen === 0 && d1.bodies.hurston.seen === 1)
check('sanity', 'below 50 km rejected (same doc back)', B.recordPanelRadius(d1, 'Hurston', null, 49_999, AT) === d1)
check('sanity', 'above 10,000 km rejected', B.recordPanelRadius(d1, 'Hurston', null, 10_000_001, AT) === d1)
check('sanity', 'NaN rejected', B.recordPanelRadius(d1, 'Hurston', null, NaN, AT) === d1)
check('sanity', '50 km and 10,000 km accepted', B.recordPanelRadius(d1, 'Hurston', null, 50_000, AT) !== d1 && B.recordPanelRadius(d1, 'Hurston', null, 10_000_000, AT) !== d1)
check('panel', 'unknown body: same doc back', B.recordPanelRadius(d1, 'Nowhere', null, 300_000, AT) === d1)

// ---- save / reload round trip ----
const reloaded = B.normalizeBodiesDoc(JSON.parse(JSON.stringify(d2)))
const rebuilt = B.buildBodies(roster, reloaded)
check('reload', 'panel radius + seen survive a save and rebuild', rebuilt.hurston.radiusM === 1_000_100 && rebuilt.hurston.seen === 2 && rebuilt.hurston.radiusSource === 'panel')
check('reload', 'estimate recomputed from the roster', near(rebuilt.hurston.radiusEstM, hur.radiusEstM, 1))
check('reload', 'out-of-range saved radius dropped on load', B.normalizeBodiesDoc({ bodies: { hurston: { ...d2.bodies.hurston, radiusM: 5 } } }).bodies.hurston.radiusM === undefined)
check('reload', 'garbage file -> empty doc', JSON.stringify(B.normalizeBodiesDoc('nope')) === JSON.stringify({ bodies: {}, learned: [] }))
const keep = B.buildBodies([], { bodies: { ghost: { name: 'Ghost', system: 'pyro', centre: { x: 1, y: 2, z: 3 }, radiusM: 300_000, radiusSource: 'panel', seen: 1 } }, learned: [] })
check('reload', 'saved body no longer in the roster is kept', keep.ghost?.radiusM === 300_000)

// ---- learned places ----
const point = { x: 1, y: 2, z: 3 }
let L = { bodies: {}, learned: [] }
L = B.recordLearned(L, { name: 'Security Compound', near: 'HDPC-Cassillo', nearMeters: 1200, body: 'Hurston', system: 'stanton', point }, AT)
check('learned', 'first record: seen 1', L.learned.length === 1 && L.learned[0].seen === 1 && L.learned[0].lastSeen === AT)
L = B.recordLearned(L, { name: 'security compound', near: 'HDPC-Cassillo', nearMeters: 1100, point: { x: 4, y: 5, z: 6 } }, '2026-10-14T13:00:00.000Z')
check('learned', 'same name+near: one entry, seen 2, point updated, body kept', L.learned.length === 1 && L.learned[0].seen === 2 && L.learned[0].point.x === 4 && L.learned[0].body === 'Hurston')
check('learned', 'invalid entry: same doc back', B.recordLearned(L, { name: '', near: 'x', nearMeters: 1, point }, AT) === L && B.recordLearned(L, { name: 'a', near: 'b', nearMeters: 1, point: { x: NaN, y: 0, z: 0 } }, AT) === L)
for (let i = 0; i < 205; i++) L = B.recordLearned(L, { name: `Place ${i}`, near: 'Lorville', nearMeters: i, point }, `2026-10-14T14:${String(i % 60).padStart(2, '0')}:00.000Z`)
check('learned', `cap ${B.LEARNED_MAX}: oldest dropped`, L.learned.length === B.LEARNED_MAX && !L.learned.some((l) => l.near === 'HDPC-Cassillo') && L.learned[L.learned.length - 1].name === 'Place 204', `${L.learned.length}`)
L = B.recordLearned(L, { name: 'Place 10', near: 'Lorville', nearMeters: 10, point }, AT)
check('learned', 'repeat moves to newest', L.learned[L.learned.length - 1].name === 'Place 10' && L.learned.length === B.LEARNED_MAX)

// ---- diagnostics ----
const diag = B.bodiesDiag(d1)
const dh = diag.table.find((r) => r.name === 'Hurston')
check('diag', 'BODIES row in km with source', dh && dh.radiusKm === 1000.1 && dh.source === 'panel' && typeof dh.estimateKm === 'number', JSON.stringify(dh))

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
