// Stop-place resolver checks: bundles src/other/otherResolve.ts, runs every row of fixtures/stop_cases.json
// (real stops from the exports) and unit checks for each scoring and decision rule.
// Usage: node test/replay/resolve_checks.mjs   (no build needed)   --verbose prints every case's answer

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-resolve-'))
const outfile = path.join(tmp, 'otherResolve.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherResolve.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const R = await import(pathToFileURL(outfile).href)
const verbose = process.argv.includes('--verbose')

const uex = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
const positions = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const uexNames = new Set(uex.map((l) => l.name))
// the merged roster the app uses: UEX first, then starmap places UEX lacks
const roster = [...uex, ...positions.filter((p) => !uexNames.has(p.name))]
const byName = (n) => roster.find((l) => l.name === n && l.x != null) ?? roster.find((l) => l.name === n)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}

// ---- case table ----
const table = JSON.parse(fs.readFileSync(path.join(root, 'test/replay/fixtures/stop_cases.json'), 'utf8'))
const undecided = []
let n = 0
for (const c of table.cases) {
  safe(`case ${c.id}`, () => {
    const mk = (s) => ({ id: `s${n++}`, have: 0, need: 1, done: false, ...s })
    const step = mk(c.step)
    if (c.marker) {
      const base = c.marker.rel ? byName(c.marker.rel) : { x: 0, y: 0, z: 0 }
      step.position = { x: base.x + c.marker.x, y: base.y + c.marker.y, z: base.z + c.marker.z }
    }
    const job = { steps: [step, ...(c.jobSteps ?? []).map(mk)] }
    const here = c.here ? table.here[c.here] : undefined
    const r = R.resolveStopPlace(step, { locations: roster, useMarker: c.useMarker ?? true, ...(here ? { here } : {}) }, job)
    const got = `${r.status} c${r.confidence} ${r.label}${r.site ? ` site=${r.site.name}/${r.site.from}/${r.site.meters == null ? '-' : Math.round(r.site.meters)}m` : ''}${r.point ? '' : ' (no point)'}`
    if (verbose) console.log(`  ${c.id}: ${got}\n    ${r.evidence.map((e) => e.text).join(' | ')}`)
    if (c.expect == null) {
      undecided.push(`${c.id}: got ${got} -- ${c.note ?? ''}`)
      return
    }
    const e = c.expect
    const id = `case ${c.id}`
    check(id, `status ${e.status}`, r.status === e.status, got)
    if (['none', 'unsure'].includes(e.status)) check(id, 'no point (no wrong distance)', !r.point, got)
    else check(id, 'has a point', !!r.point, got)
    if (e.site) check(id, `site from ${e.site}`, r.site?.from === e.site, got)
    if (e.name) {
      const placed = r.site?.name ?? r.match?.name
      check(id, `place ${e.name}`, placed === e.name, got)
      const want = byName(e.name)
      if (e.maxMeters != null && r.point && want) {
        const d = dist(r.point, want)
        check(id, `point within ${e.maxMeters} m of ${e.name}`, d <= e.maxMeters + 1, `${Math.round(d)} m`)
      }
    }
    if (r.status === 'marker' || r.status === 'mismatch') check(id, 'marker status: point is the marker', step.position && dist(r.point, step.position) < 1, got)
  })
}

// ---- unit checks: one per rule, on a small roster ----
const P = (name, x, extra = {}) => ({ name, code: '', maxContainerSize: 0, uexId: 0, x, y: 0, z: 0, system: 'stanton', body: 'Hurston', ...extra })
const unit = [
  P('Alpha Station', 0),
  P('Covalex Distribution Centre S1DC06', 100_000),
  P('Covalex Distribution Center S1DC06', undefined, { x: undefined, y: undefined, z: undefined }),
  P('Twin Outpost', 200_000, { body: 'Daymar' }),
  P('Twin Outpost Annex', 300_000, { body: 'Yela' }),
  P('Mining Area 141', 400_000),
  P('Mining Area 141 (Pyro)', 500_000, { system: 'pyro', body: 'Pyro I' }),
  P('Kilo Base K9Z4', 600_000),
  P('Kilo Depot K9Z4', 700_000),
  P('Hurston', 0, { body: null, y: -1e6 })
]
const ctx = (o = {}) => ({ locations: unit, useMarker: true, ...o })
const ev = (r, kind) => r.evidence.filter((e) => e.kind === kind)

safe('placeKey', () => {
  const k = R.placeKey
  check('placeKey', 'lower case + words only', k('HDMS-Hadley') === 'hdms hadley', k('HDMS-Hadley'))
  check('placeKey', 'trailing (...) dropped', k('Everus Harbor (Hurston)') === 'everus harbor', k('Everus Harbor (Hurston)'))
  check('placeKey', 'address hint dropped', k('Benson Mining on Yela') === 'benson mining', k('Benson Mining on Yela'))
  check('placeKey', 'centre -> center', k('Distribution Centre') === 'distribution center', k('Distribution Centre'))
  check('placeKey', 'digit words: O -> 0, I/l -> 1', k('S1DCO6') === k('S1DC06') && k('SlDC06') === k('S1DC06') && k('SIDC06') === k('S1DC06'), k('SIDC06'))
  check('placeKey', 'digit words: runs of 0 -> one 0', k('S1DC006') === 's1dc06' && k('S1DCO06') === 's1dc06', k('S1DCO06'))
  check('placeKey', 'words without a digit untouched', k('Olio Ill') === 'olio ill', k('Olio Ill'))
  check('placeKey', 'a dropped zero is not folded', k('S1DC6') !== k('S1DC06'), k('S1DC6'))
})

safe('name rules', () => {
  const ex = R.resolvePlaceText('alpha station', ctx())
  check('name', 'exact (case-insensitive) +6 -> exact', ex.status === 'exact' && ev(ex, 'name')[0]?.points === 6, `${ex.status} ${ev(ex, 'name')[0]?.points}`)
  const co = R.resolvePlaceText('Covalex Distribution Center S1DCO06', ctx())
  check('name', 'key equal +5 -> corrected', co.status === 'corrected' && ev(co, 'name')[0]?.points === 5, `${co.status} ${co.confidence}`)
  check('name', 'two spellings = one candidate, the one with coords', co.candidates.length === 1 && co.candidates[0].hasCoords && co.match?.name === 'Covalex Distribution Centre S1DC06', JSON.stringify(co.candidates))
  const part = R.resolvePlaceText('Tor Station', { locations: [P('Tor', 0)], useMarker: true })
  check('name', 'shorter key under 4 chars: no containment', part.candidates.length === 0, JSON.stringify(part.candidates))
  const cont = R.resolvePlaceText('Mining Area', ctx())
  check('name', 'whole-word containment +3', cont.candidates.every((c) => c.score === 3) && cont.candidates.length === 2, JSON.stringify(cont.candidates))
  check('name', 'containment alone (3) is not accepted', cont.status === 'none' && !cont.point, cont.status)
  const notWord = R.resolvePlaceText('Alpha Stat', ctx())
  check('name', 'containment is whole words only', notWord.candidates.length === 0, JSON.stringify(notWord.candidates))
  const tok = R.resolvePlaceText('Somewhere K9Z4', ctx())
  check('name', 'shared distinctive token +2', tok.candidates.length === 2 && tok.candidates.every((c) => c.score === 2), JSON.stringify(tok.candidates))
  const none = R.resolvePlaceText('Nowhere Gulch', ctx())
  check('name', 'no name points -> no candidate, none', none.candidates.length === 0 && none.status === 'none' && none.confidence === 0, none.status)
})

safe('hints', () => {
  const b = R.resolvePlaceText('Twin Outpost on Daymar', ctx())
  check('hints', 'body hint equal +2', ev(b, 'body').some((e) => e.points === 2 && e.ok), JSON.stringify(ev(b, 'body')))
  const bad = R.resolvePlaceText('Twin Outpost Annex on Daymar', ctx())
  const annex = bad.candidates.find((c) => c.name === 'Twin Outpost Annex')
  check('hints', 'body hint differs -6: the exact name (on Yela) drops to 0', ev(bad, 'body').some((e) => e.points === 2) && annex?.score === 0 && bad.match?.name !== 'Twin Outpost Annex', `${bad.status} ${JSON.stringify(bad.candidates)}`)
  const isBody = R.resolvePlaceText('Hurston on Hurston', ctx())
  check('hints', 'candidate is the body: +2', ev(isBody, 'body').some((e) => e.points === 2), JSON.stringify(ev(isBody, 'body')))
  const sys = R.resolvePlaceText('Mining Area 141 on Hurston', ctx())
  check('hints', 'system hint equal +1 (stanton)', ev(sys, 'system').some((e) => e.points === 1), JSON.stringify(ev(sys, 'system')))
  check('hints', 'system hint differs -6: Pyro twin loses', sys.match?.name === 'Mining Area 141' && sys.candidates.find((c) => c.name.includes('Pyro'))?.score < 0, JSON.stringify(sys.candidates))
  const lone = R.resolvePlaceText('Mining Area 141', ctx())
  check('hints', 'same key twice in two systems, no hint: tied -> unsure, no point', lone.status === 'unsure' && !lone.point && lone.confidence === 2, `${lone.status} ${JSON.stringify(lone.candidates)}`)
})

safe('marker + here', () => {
  const at = (x) => ({ x, y: 0, z: 0 })
  const near = R.resolvePlaceText('Alpha Station', ctx(), at(1500))
  check('marker', 'within 2 km +4', ev(near, 'marker').some((e) => e.points === 4) && near.status === 'exact' && near.confidence === 10, `${near.status} ${near.confidence}`)
  const mid = R.resolvePlaceText('Alpha Station', ctx(), at(5000))
  check('marker', '2-10 km: 0 points, still exact', ev(mid, 'marker').some((e) => e.points === 0) && mid.status === 'exact', mid.status)
  const far = R.resolvePlaceText('Alpha Station', ctx(), at(15000))
  check('marker', '> 10 km -5: exact name loses to the marker', ev(far, 'marker').some((e) => e.points === -5) && far.status === 'marker' && far.source === 'marker', far.status)
  const off = R.resolvePlaceText('Alpha Station', ctx({ useMarker: false }), at(15000))
  check('marker', 'markers off: no marker evidence', ev(off, 'marker').length === 0 && off.status === 'exact', off.status)
  // exact 6 + body 2 + system 1 + here 2 - marker 5 = 6: still wins on evidence, but the game's marker is elsewhere
  const mm = R.resolvePlaceText('Alpha Station on Hurston', ctx({ here: at(0) }), at(15000))
  check('marker', 'winner still >= 5 but > 10 km from marker -> mismatch, marker point, conf 4', mm.status === 'mismatch' && mm.confidence === 4 && mm.point?.x === 15000 && mm.label === 'Alpha Station on Hurston', `${mm.status} ${mm.confidence} ${mm.point?.x}`)
  const tie = R.resolvePlaceText('Mining Area 141', ctx(), at(400_500))
  check('marker', 'marker breaks a tie (+4 vs the twin)', tie.match?.name === 'Mining Area 141' && tie.status === 'exact', `${tie.status} ${JSON.stringify(tie.candidates)}`)
  const lost = R.resolvePlaceText('Nowhere Gulch', ctx(), at(100_300))
  check('marker', 'no name: marker point, status marker, conf 8', lost.status === 'marker' && lost.confidence === 8 && lost.point?.x === 100_300, lost.status)
  check('marker', 'marker point borrows body/system of the nearest place', lost.point?.body === 'Hurston' && lost.point?.system === 'stanton', JSON.stringify(lost.point))
  check('marker', 'near = nearest place within 25 km; no site for a non-generic name', lost.near?.name === 'Covalex Distribution Centre S1DC06' && Math.round(lost.near.meters) === 300 && !lost.site, JSON.stringify(lost.near))
  const sc = R.resolvePlaceText('Security Compound', ctx(), at(100_300))
  check('marker', 'generic site, no contract place: site from marker = near', sc.site?.from === 'marker' && sc.site.name === sc.near?.name && sc.status === 'marker', JSON.stringify(sc.site))
  const nowhere = R.resolvePlaceText('Nowhere Gulch', ctx(), at(5e9))
  check('marker', 'nothing within 25 km: no near', !nowhere.near && nowhere.status === 'marker', JSON.stringify(nowhere.near))
  const here = R.resolvePlaceText('Kilo Base K9Z4', ctx({ here: at(600_500) }))
  check('here', 'within 1 km of here +2', ev(here, 'here').some((e) => e.points === 2) && here.confidence === 8, `${here.confidence}`)
  const hereTok = R.resolvePlaceText('Kilo K9Z4 Annex', ctx({ here: at(700_200) }))
  check('here', 'here alone is not enough (token 2 + here 2 < 5)', hereTok.status === 'none', `${hereTok.status} ${JSON.stringify(hereTok.candidates)}`)
})

safe('decision', () => {
  const g = R.resolvePlaceText('Twin Outpost on Yela', ctx())
  check('decision', 'containment + body = 5, clear: guess, conf 5-2', g.status === 'guess' && g.match?.name === 'Twin Outpost Annex' && g.confidence === 3, `${g.status} ${g.confidence} ${g.match?.name}`)
  const gap = R.resolvePlaceText('Twin Outpost', ctx())
  check('decision', 'exact 6 vs containment 3: gap 3 accepted', gap.status === 'exact' && gap.match?.name === 'Twin Outpost', gap.status)
  check('decision', 'runner-up in evidence', gap.evidence.some((e) => /^runner-up Twin Outpost Annex \(score 3\)$/.test(e.text)), gap.evidence.map((e) => e.text).join(' | '))
  check('decision', 'candidates top 5 by score', gap.candidates[0].name === 'Twin Outpost' && gap.candidates.length <= 5, JSON.stringify(gap.candidates))
  const noCoords = R.resolvePlaceText('Lonely Place', { locations: [P('Lonely Place', undefined, { x: undefined })], useMarker: true })
  check('decision', 'only candidate has no coords: none, no point', noCoords.status === 'none' && !noCoords.point, noCoords.status)
  check('decision', 'label is the roster name when one wins', gap.label === 'Twin Outpost' && gap.source === 'roster', gap.label)
  check('decision', 'generic site words', R.isGenericSite('Security Compound') && R.isGenericSite('Storehouse') && !R.isGenericSite('Deak Outpost on Yela'), '')
  const lone = R.resolvePlaceText('Kilo Base', ctx())
  check('decision', 'lone partial name (text inside one name, nothing else scores): guess, conf 3', lone.status === 'guess' && lone.confidence === 3 && lone.match?.name === 'Kilo Base K9Z4', `${lone.status} ${lone.confidence}`)
  check('decision', 'lone partial evidence says so', lone.evidence[0]?.text === 'only one place fits: Kilo Base K9Z4 (partial name)', lone.evidence[0]?.text)
  const two = R.resolvePlaceText('Twin', ctx())
  check('decision', 'partial name in two places: none', two.status === 'none' && !two.point, `${two.status} ${JSON.stringify(two.candidates)}`)
  const longer = R.resolvePlaceText('Alpha Station Garbled Text Here', ctx())
  check('decision', 'roster name inside a longer text is not a lone-partial guess', longer.status === 'none' && !longer.point, longer.status)
  const loneBad = R.resolvePlaceText('Kilo Base on Daymar', ctx())
  check('decision', 'lone partial with a disagreeing body: none', loneBad.status === 'none' && !loneBad.point, loneBad.status)
  const loneFar = R.resolvePlaceText('Kilo Base', ctx(), { x: 0, y: 0, z: 0 })
  check('decision', 'lone partial with the marker far away: marker decides', loneFar.status === 'marker', loneFar.status)
  const full = R.resolveStopPlace({ id: 'f', kind: 'turnin', have: 0, need: 1, done: false, label: 'Collect Ore from Kilo Base K9Z4 on Hurston. Deliver Ore to Alpha Station', location: 'Alpha Station', pickupLocation: 'Kilo Base', pickedUp: false }, ctx())
  check('decision', 'label names the place in full: corrected via the label phrase', full.status === 'corrected' && full.match?.name === 'Kilo Base K9Z4' && full.evidence[0]?.text.startsWith('contract names it in full: Kilo Base K9Z4'), `${full.status} ${full.evidence[0]?.text}`)
  const empty = R.resolvePlaceText('', ctx())
  check('decision', 'empty text: none', empty.status === 'none' && !empty.point, empty.status)
})

safe('step + site', () => {
  const marker = { x: 100_000 + 4000, y: 0, z: 0 }
  const base = { id: 'a', kind: 'turnin', have: 0, need: 1, done: false, label: 'Collect Scrap from Covalex Distribution Center S1DCO06 on Hurston. Deliver Scrap to Security Compound', location: 'Security Compound', pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston', position: marker }
  const pick = R.resolveStopPlace({ ...base, pickedUp: false }, ctx())
  check('step', 'open pickup: the drop-off marker is not used', pick.status === 'corrected' && ev(pick, 'marker').length === 0, `${pick.status}`)
  const drop = R.resolveStopPlace({ ...base, pickedUp: true }, ctx())
  check('site', 'generic site + marker: marker point, site from contract', drop.status === 'marker' && drop.site?.from === 'contract' && drop.site.name === 'Covalex Distribution Centre S1DC06' && Math.round(drop.site.meters) === 4000 && drop.point?.x === marker.x, JSON.stringify(drop.site))
  const noMk = R.resolveStopPlace({ ...base, pickedUp: true, position: undefined }, ctx())
  check('site', 'generic site, no marker: guess at the named place, conf 5', noMk.status === 'guess' && noMk.confidence === 5 && noMk.point?.x === 100_000 && noMk.site?.from === 'contract' && noMk.site.meters == null, `${noMk.status} ${noMk.confidence}`)
  check('site', 'no-marker evidence says so', noMk.evidence.some((e) => /no game marker: using Covalex Distribution Centre S1DC06, named in the contract/.test(e.text)), noMk.evidence.map((e) => e.text).join(' | '))
  const farParent = R.resolveStopPlace({ ...base, pickedUp: true, position: { x: 0, y: 0, z: 300 } }, ctx())
  check('site', 'named place > 25 km from the marker: not the parent; nearest place instead', farParent.site?.from === 'marker' && farParent.site.name === 'Alpha Station', JSON.stringify(farParent.site))
  const j74 = { id: 'd', kind: 'turnin', have: 0, need: 1, done: false, label: 'Deliver Iron To Security Compound', location: 'Security Compound' }
  const other = { id: 'p', kind: 'pickup', have: 0, need: 1, done: false, label: 'Collect Iron From Alpha Station', location: 'Alpha Station' }
  const lone = R.resolveStopPlace(j74, ctx(), { steps: [j74, other] })
  check('site', "no marker: another step's place is not the parent", lone.status === 'none' && !lone.point, lone.status)
  const withMk = R.resolveStopPlace({ ...j74, position: { x: 1000, y: 0, z: 0 } }, ctx(), { steps: [j74, other] })
  check('site', "with a marker: another step's place within 25 km is the parent", withMk.site?.from === 'contract' && withMk.site.name === 'Alpha Station', JSON.stringify(withMk.site))
})

safe('matchWord', () => {
  const want = { exact: '✓ exact', corrected: '≈ corrected', marker: '📍 game marker', guess: '? guess', mismatch: '⚠ mismatch', unsure: '? not sure', none: '✗ not found' }
  for (const [s, w] of Object.entries(want)) check('matchWord', s, R.matchWord(s) === w, R.matchWord(s))
  check('NEAR_MAX_M', '25 km', R.NEAR_MAX_M === 25_000, String(R.NEAR_MAX_M))
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  if (!ok || verbose) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
for (const u of undecided) console.log(`UNDECIDED  ${u}`)
console.log(`\n${results.length - failed}/${results.length} passed; ${table.cases.length} cases (${undecided.length} undecided)`)
process.exit(failed ? 1 : 0)
