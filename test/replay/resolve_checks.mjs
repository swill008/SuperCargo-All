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
// one bundle for the resolver and the game-data site table it reads (setSiteCodes must reach the same module)
esbuild.buildSync({
  stdin: {
    contents: "export * from './otherResolve'\nexport { setSiteCodes, normalizeSiteCodesDoc } from './otherSiteCodes'\n",
    resolveDir: path.join(root, 'src/other'),
    loader: 'ts'
  },
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

safe('memory', () => {
  const T = '2026-10-14T00:00:00Z'
  const E = (o) => ({ text: '', place: null, origin: 'game', confirmed: 0, wrong: 0, seen: 1, firstAt: T, lastAt: T, ...o })
  const withMem = (entries) => ctx({ memory: (k) => entries.find((e) => e.key === k) })
  const at = (x) => ({ x, y: 0, z: 0 })
  // keys
  const plainKey = R.resolvePlaceText('Mining Area 141', ctx())
  check('memory', 'memoryKey always set: placeKey(text)', plainKey.memoryKey === 'mining area 141' && !plainKey.memory, plainKey.memoryKey)
  const scKey = R.resolvePlaceText('Security Compound', ctx(), at(100_300))
  check('memory', 'generic site key carries the site parent', scKey.memoryKey === 'security compound@covalex distribution center s1dc06', scKey.memoryKey)
  const scNone = R.resolvePlaceText('Security Compound', ctx())
  check('memory', "generic site without a parent: key has no context", scNone.memoryKey === 'security compound', scNone.memoryKey)
  // user entry wins outright
  const u = withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', origin: 'user' })])
  const ur = R.resolvePlaceText('Mining Area 141', u)
  check('memory', "user entry: that place wins, status user, conf 10", ur.status === 'user' && ur.confidence === 10 && ur.match?.name === 'Mining Area 141 (Pyro)' && ur.point?.x === 500_000 && ur.source === 'roster', `${ur.status} ${ur.confidence} ${ur.match?.name}`)
  check('memory', 'user entry: first evidence "you set this ✓"', ur.evidence[0]?.text === 'you set this ✓', ur.evidence[0]?.text)
  check('memory', 'user entry: memory info', ur.memory?.origin === 'user' && ur.memory.label === 'you set it' && !ur.memory.disputed, JSON.stringify(ur.memory))
  const ux = R.resolvePlaceText('Alpha Station', withMem([E({ key: 'alpha station', place: 'Twin Outpost', origin: 'user' })]), at(500))
  check('memory', 'user entry beats an exact name and a near marker', ux.status === 'user' && ux.match?.name === 'Twin Outpost', `${ux.status} ${ux.match?.name}`)
  const wa = [{ name: 'Alpha Station', meters: 40, at: T }]
  const ud = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', origin: 'user', wrong: 3, disputed: true, wrongAt: wa })]))
  check('memory', 'disputed user entry: still wins, conf 6, flagged', ud.status === 'user' && ud.confidence === 6 && ud.match?.name === 'Mining Area 141 (Pyro)' && ud.memory?.disputed === true && ud.memory.wrongAt?.[0]?.name === 'Alpha Station', `${ud.status} ${ud.confidence} ${JSON.stringify(ud.memory)}`)
  check('memory', 'disputed evidence line', ud.evidence[0]?.text === 'you set this; ⚠ the game disagrees ×3', ud.evidence[0]?.text)
  const unc = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Covalex Distribution Center S1DC06', origin: 'user' })]))
  check('memory', 'user place spelled without coords: the same place with coords is used', unc.status === 'user' && unc.point?.x === 100_000, `${unc.status} ${unc.point?.x}`)
  const ugone = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Gone Place', origin: 'user' })]))
  check('memory', 'user place not in the roster: normal resolution, no memory', ugone.status === 'unsure' && !ugone.memory, ugone.status)
  // generic site with a user entry
  const scU = withMem([E({ key: 'security compound@covalex distribution center s1dc06', place: 'Alpha Station', origin: 'user' })])
  const sm = R.resolvePlaceText('Security Compound', scU, at(100_300))
  check('memory', 'generic site + user entry + marker: user place is the site, marker gives the point', sm.status === 'user' && sm.site?.name === 'Alpha Station' && sm.site.from === 'contract' && Math.round(sm.site.meters) === 100_300 && sm.point?.x === 100_300 && sm.source === 'marker' && sm.label === 'Security Compound', `${sm.status} ${JSON.stringify(sm.site)} ${sm.point?.x}`)
  const sn = R.resolvePlaceText('Security Compound', withMem([E({ key: 'security compound', place: 'Alpha Station', origin: 'user' })]))
  check('memory', 'generic site + user entry, no marker: point at the user place', sn.status === 'user' && sn.site?.name === 'Alpha Station' && sn.site.meters == null && sn.point?.x === 0 && sn.match?.name === 'Alpha Station', `${sn.status} ${JSON.stringify(sn.site)}`)
  // game entries
  const gl = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', confirmed: 2 })]))
  const pyro = gl.candidates.find((c) => c.name === 'Mining Area 141 (Pyro)')
  check('memory', 'learned (confirmed 2 > wrong): key 5 + 4 = 9 beats the twin 6 -> learned, conf 9', gl.status === 'learned' && gl.match?.name === 'Mining Area 141 (Pyro)' && pyro?.score === 9 && gl.confidence === 9, `${gl.status} ${gl.confidence} ${JSON.stringify(gl.candidates)}`)
  check('memory', 'learned evidence text + memory info', gl.evidence.some((e) => e.text === 'learned: game confirmed ×2' && e.points === 4) && gl.memory?.origin === 'game' && gl.memory.label === 'game confirmed ×2', `${gl.evidence.map((e) => e.text).join(' | ')} ${JSON.stringify(gl.memory)}`)
  const g1 = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', confirmed: 1 })]))
  check('memory', 'confirmed 1: not learned, no change', g1.status === 'unsure' && !g1.memory, g1.status)
  const gtie = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', confirmed: 2, wrong: 2 })]))
  check('memory', 'confirmed 2 = wrong 2: not learned, but -4 for wrong', gtie.status === 'exact' && gtie.match?.name === 'Mining Area 141' && gtie.candidates.find((c) => c.name === 'Mining Area 141 (Pyro)')?.score === 1, `${gtie.status} ${JSON.stringify(gtie.candidates)}`)
  const gw = R.resolvePlaceText('Twin Outpost', withMem([E({ key: 'twin outpost', place: 'Twin Outpost', wrong: 2 })]))
  check('memory', 'wrong >= 2: -4 to that candidate (exact 6 -> 2, no longer clear)', gw.candidates.find((c) => c.name === 'Twin Outpost')?.score === 2 && gw.status !== 'exact' && gw.memory?.label === '⚠ the game disagrees', `${gw.status} ${JSON.stringify(gw.candidates)}`)
  const gw1 = R.resolvePlaceText('Twin Outpost', withMem([E({ key: 'twin outpost', place: 'Twin Outpost', wrong: 1 })]))
  check('memory', 'wrong 1, unproven: no change', gw1.status === 'exact' && !gw1.memory, gw1.status)
  const gadd = R.resolvePlaceText('Nowhere Gulch', withMem([E({ key: 'nowhere gulch', place: 'Alpha Station', confirmed: 3 })]), at(500))
  check('memory', 'learned place with no name match: a candidate (+4 + marker 4) -> learned', gadd.status === 'learned' && gadd.match?.name === 'Alpha Station' && gadd.confidence === 8, `${gadd.status} ${gadd.confidence} ${JSON.stringify(gadd.candidates)}`)
  const gfar = R.resolvePlaceText('Mining Area 141', withMem([E({ key: 'mining area 141', place: 'Mining Area 141 (Pyro)', confirmed: 2 })]), at(400_500))
  check('memory', 'learned +4 does not beat the marker: marker-near twin wins as exact', gfar.status !== 'learned' && gfar.match?.name !== 'Mining Area 141 (Pyro)', `${gfar.status} ${gfar.match?.name}`)
  const nomem = R.resolvePlaceText('Mining Area 141', ctx({ memory: () => undefined }))
  check('memory', 'no entry: same as without memory', nomem.status === 'unsure' && !nomem.memory && nomem.memoryKey === 'mining area 141', nomem.status)
})

safe('typo', () => {
  const sim = R.spellingSimilarity
  check('typo', 'similarity: same = 1', sim('abcdefghij', 'abcdefghij') === 1, '')
  check('typo', 'similarity: a confusion pair costs 0.3', Math.abs(sim('abcdefghi0', 'abcdefghio') - 0.97) < 1e-9, String(sim('abcdefghi0', 'abcdefghio')))
  check('typo', 'similarity: another edit costs 1', Math.abs(sim('abcdefghix', 'abcdefghij') - 0.9) < 1e-9, String(sim('abcdefghix', 'abcdefghij')))
  check('typo', 'similarity: a swap costs 1 (Damerau)', Math.abs(sim('abcdefghji', 'abcdefghij') - 0.9) < 1e-9, String(sim('abcdefghji', 'abcdefghij')))
  // folded key equal -> corrected +5
  const folds = [
    ['Depot S12', 'Depot 512', 'S -> 5 in a code'],
    ['Depot B12', 'Depot 812', 'B -> 8 in a code'],
    ['Depot Z12', 'Depot 212', 'Z -> 2 in a code'],
    ['Depot G12', 'Depot 612', 'G -> 6 in a code'],
    ['Ambitious Dream', 'Arnbitious Dream', 'rn -> m'],
    ['Watch Post', 'Vvatch Post', 'vv -> w'],
    ['Daring Rock', 'Claring Rock', 'cl -> d'],
    ['Lone Peak', '|one Peak', "'|' -> l"]
  ]
  for (const [name, text, what] of folds) {
    const r = R.resolvePlaceText(text, { locations: [P(name, 0), P('Far Away Place', 900_000)], useMarker: true })
    check('typo', `fold ${what}: corrected +5`, r.status === 'corrected' && r.match?.name === name && ev(r, 'name')[0]?.points === 5 && /OCR look-alikes/.test(ev(r, 'name')[0]?.text), `${r.status} ${r.evidence.map((e) => e.text).join(' | ')}`)
  }
  const plainS = R.resolvePlaceText('5un Depot', { locations: [P('Sun Depot', 0)], useMarker: true })
  check('typo', 'S -> 5 only inside codes: a code token the roster lacks gets no spelling points', plainS.status === 'none' && !plainS.candidates.length, JSON.stringify(plainS.candidates))
  // close spelling bands
  const B = [P('Benson Mining Outpost', 0, { body: 'Yela' }), P('Kareah', 50_000, { body: 'Yela' }), P('Far Away Place', 900_000)]
  const close = R.resolvePlaceText('Benson Minimg Outpost on Yela', { locations: B, useMarker: true })
  check('typo', 'sim >= 0.9, key >= 8: +4 "close spelling" (+ body 2 = 6): guess', close.status === 'guess' && close.match?.name === 'Benson Mining Outpost' && ev(close, 'name')[0]?.points === 4 && ev(close, 'name')[0]?.text === 'close spelling: Benson Mining Outpost' && close.confidence === 4, `${close.status} ${close.confidence} ${close.evidence.map((e) => e.text).join(' | ')}`)
  const alone = R.resolvePlaceText('Benson Minimg Outpost', { locations: B, useMarker: true })
  check('typo', 'close spelling alone (4) is not accepted', alone.status === 'none' && !alone.point && alone.candidates[0]?.score === 4, `${alone.status} ${JSON.stringify(alone.candidates)}`)
  const near = R.resolvePlaceText('Bensen Minimg Outpst on Yela', { locations: B, useMarker: true })
  check('typo', 'sim 0.82-0.9: +3 "similar spelling"', ev(near, 'name')[0]?.points === 3 && /^similar spelling: Benson Mining Outpost/.test(ev(near, 'name')[0]?.text), near.evidence.map((e) => e.text).join(' | '))
  const short = R.resolvePlaceText('Kareeh', { locations: B, useMarker: true })
  check('typo', 'key under 8 chars: never the +4 band', short.candidates[0]?.score === 3, JSON.stringify(short.candidates))
  const far = R.resolvePlaceText('Bxnsxn Mxnxng Oxtpxst on Yela', { locations: B, useMarker: true })
  check('typo', 'sim under 0.82: no spelling points', !far.candidates.some((c) => c.name === 'Benson Mining Outpost'), JSON.stringify(far.candidates))
  // code tokens must agree
  const C = [P('Covalex Distribution Centre S1DC06', 0), P('Covalex Distribution Centre S4DC05', 900_000, { body: 'microTech' })]
  const s4 = R.resolvePlaceText('Covalex Distribution Centre S4DC05 on Hurston', { locations: [C[0]], useMarker: true })
  check('typo', 'S1DC06 never matches S4DC05 (code tokens differ: no spelling points)', s4.status === 'none' && !s4.candidates.length, JSON.stringify(s4.candidates))
  const oneDigit = R.resolvePlaceText('Covalex Distribution Centre S1DC05 on Hurston', { locations: C, useMarker: true })
  check('typo', 'one digit off is not a look-alike: none', oneDigit.status === 'none' && !oneDigit.point, `${oneDigit.status} ${JSON.stringify(oneDigit.candidates)}`)
  const lane = R.resolvePlaceText('CRU-LS5 Beautiful Glen Station', { locations: [P('CRU-L5 Beautiful Glen Station', 0)], useMarker: true })
  check('typo', 'an extra character in a code (LS5 vs L5): no spelling points', lane.status === 'none' && !lane.candidates.length, JSON.stringify(lane.candidates))
  const lost = R.resolvePlaceText('ARC-L dern Express Station', { locations: [P('ARC-L3 Modern Express Station', 0)], useMarker: true })
  check('typo', 'code missing from the text (ARC-L vs ARC-L3): no spelling points', lost.status === 'none' && !lost.candidates.length, JSON.stringify(lost.candidates))
  // designators (roman numerals, letters, greek) are codes too; spelling is the last tier
  const F = [P('Farro Data Center I', 0), P('Farro Data Center II', 100_000), P('Station Delta', 200_000), P('Station Theta', 300_000)]
  const fi = R.resolvePlaceText('Farro Data Center I', { locations: F, useMarker: true })
  check('typo', 'exact name not undermined by a sibling one letter away', fi.status === 'exact' && fi.match?.name === 'Farro Data Center I' && fi.candidates.length === 1, `${fi.status} ${JSON.stringify(fi.candidates)}`)
  const sd = R.resolvePlaceText('Station Delta', { locations: F, useMarker: true })
  check('typo', 'Station Delta exact: Station Theta is no rival', sd.status === 'exact' && sd.candidates.length === 1, `${sd.status} ${JSON.stringify(sd.candidates)}`)
  const f2 = R.resolvePlaceText('Farro Dta Center II on Hurston', { locations: F, useMarker: true })
  check('typo', 'misread with a designator: only the same designator scores', f2.status === 'guess' && f2.match?.name === 'Farro Data Center II' && f2.candidates.length === 1, `${f2.status} ${JSON.stringify(f2.candidates)}`)
  // candidate evidence names its source
  const S = [P('Alpha Station', 0, { source: 'starmap' }), P('Kilo Base K9Z4', 600_000, { coordsFrom: 'starmap' }), P('Twin Outpost', 200_000, { source: 'uex', coordsFrom: 'uex' })]
  const sa = R.resolvePlaceText('Alpha Station', { locations: S, useMarker: true })
  check('typo', 'starmap place: "· from starmap data"', ev(sa, 'name')[0]?.text === 'name exact: Alpha Station · from starmap data', ev(sa, 'name')[0]?.text)
  const sk = R.resolvePlaceText('Kilo Base K9Z4', { locations: S, useMarker: true })
  check('typo', 'starmap coords: "· from starmap data"', ev(sk, 'name')[0]?.text.endsWith(' · from starmap data'), ev(sk, 'name')[0]?.text)
  const su = R.resolvePlaceText('Twin Outpost', { locations: S, useMarker: true })
  check('typo', 'UEX place: no source note', ev(su, 'name')[0]?.text === 'name exact: Twin Outpost', ev(su, 'name')[0]?.text)
})

// W4: game data (scunpacked site codes). The case table above runs with an empty table (source off).
safe('game data', () => {
  const sites = R.normalizeSiteCodesDoc(JSON.parse(fs.readFileSync(path.join(root, 'data/uex/site-codes.json'), 'utf8')))
  const rctx = { locations: roster, useMarker: true }
  const S = (o) => ({ id: 'g', kind: 'turnin', have: 0, need: 1, done: false, pickedUp: true, ...o })
  const cov = S({ label: 'Collect Ammunition Crate from Covalex Distribution Center S1DCO6 on Hurston. Deliver Ammunition Crate to Security Compound', location: 'Security Compound', pickupLocation: 'Covalex Distribution Center S1DCO6 on Hurston' })
  const cas = S({ label: 'Collect Tissue Samples from HDPC-Cassillo on Hurston. Deliver Tissue Samples to Storehouse', location: 'Storehouse', pickupLocation: 'HDPC-Cassillo' })
  const coded = S({ label: 'Deliver Scrap to Security Compound', location: 'Security Compound [DC_Stan_Covalex_S1_S1DC06_FOB]' })
  const off = { cov: R.resolveStopPlace(cov, rctx), cas: R.resolveStopPlace(cas, rctx), coded: R.resolveStopPlace(coded, rctx) }
  R.setSiteCodes(sites)
  try {
    const a = R.resolveStopPlace(cov, rctx)
    const has = (r, re) => r.evidence.find((e) => re.test(e.text))
    check('game data', 'parent has the site: +2 evidence, confidence 5 -> 7', a.status === 'guess' && a.confidence === 7 && has(a, /^game data: Covalex Distribution Centre S1DC06 has a Security Compound ✓$/)?.points === 2, `${a.status} ${a.confidence} ${a.evidence.map((e) => e.text).join(' | ')}`)
    const b = R.resolveStopPlace(cas, rctx)
    check('game data', 'known parent without the site: -2 evidence, confidence 5 -> 3, still the contract place', b.status === 'guess' && b.match?.name === 'HDPC-Cassillo' && b.confidence === 3 && has(b, /^game data: HDPC-Cassillo has no Storehouse$/)?.points === -2, `${b.status} ${b.confidence} ${b.evidence.map((e) => e.text).join(' | ')}`)
    const mkStep = S({ ...cov, position: { ...byName('Covalex Distribution Centre S1DC06'), x: byName('Covalex Distribution Centre S1DC06').x + 3000 } })
    const m = R.resolveStopPlace(mkStep, rctx)
    check('game data', 'with a marker: evidence added, confidence 8 -> 10', m.status === 'marker' && m.confidence === 10 && !!has(m, /has a Security Compound ✓/), `${m.status} ${m.confidence}`)
    const c = R.resolveStopPlace(coded, rctx)
    check('game data', 'game code in the text: site parent exactly, confidence 10', c.status === 'exact' && c.confidence === 10 && c.match?.name === 'Covalex Distribution Centre S1DC06' && c.site?.from === 'contract' && c.label === 'Security Compound', `${c.status} ${c.confidence} ${c.match?.name} ${c.label}`)
    check('game data', 'game code evidence', c.evidence[0]?.text === 'game code DC_Stan_Covalex_S1_S1DC06_FOB ✓', c.evidence[0]?.text)
    check('game data', 'game code: memory key ignores the code part', c.memoryKey === 'security compound@covalex distribution center s1dc06', c.memoryKey)
    const place = R.resolvePlaceText('[DC_Stan_Covalex_S1_S1DC06]', rctx)
    check('game data', 'code of a place itself: that roster place', place.status === 'exact' && place.label === 'Covalex Distribution Centre S1DC06' && !place.site, `${place.status} ${place.label}`)
    const unknown = R.resolvePlaceText('Security Compound [Nope_Code_X1]', rctx)
    check('game data', 'unknown code: normal path', unknown.status !== 'exact' || unknown.confidence !== 10, unknown.status)
    const odd = R.resolveStopPlace(S({ label: 'Deliver Iron to Security Post', location: 'Security Post', pickupLocation: 'HDPC-Cassillo' }), rctx)
    check('game data', 'site name unknown to game data: no game-data evidence', !odd.evidence.some((e) => /^game data:/.test(e.text)), odd.evidence.map((e) => e.text).join(' | '))
  } finally {
    R.setSiteCodes({ generatedAt: '', sites: [] })
  }
  check('game data', 'source off (empty table): no game-data evidence, confidence 5', off.cov.confidence === 5 && !off.cov.evidence.some((e) => /^game data:/.test(e.text)), `${off.cov.confidence}`)
  check('game data', 'source off: Cassillo unchanged at 5', off.cas.confidence === 5, `${off.cas.confidence}`)
  check('game data', 'source off: a coded text gets no game-code answer', !off.coded.evidence.some((e) => /^game code/.test(e.text)), off.coded.evidence.map((e) => e.text).join(' | '))
})

safe('matchWord', () => {
  const want = { exact: '✓ exact', corrected: '≈ corrected', marker: '📍 game marker', guess: '? guess', mismatch: '⚠ mismatch', unsure: '? not sure', none: '✗ not found', user: '✓ you set', learned: '✓ learned' }
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
