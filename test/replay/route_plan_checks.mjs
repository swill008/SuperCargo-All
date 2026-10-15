// Locked route checks (batch 19, docs/contracts/batch-19-locked-route.md): bundles src/other/otherRoutePlan.ts and
// checks planRoute (never longer than 1.0.5, deterministic, precedence), reconcile (done / grey / complete), slotIn
// (cheapest insertion, relative order, precedence, may go first, placed later), the re-plan suggestion and routeView
// (numbers, visits, why, tags, notes, status). Synthetic points on a plane in one system (metres = x * 1e6).
// Usage: node test/replay/route_plan_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-route-plan-'))
const bundle = (entry, name) => {
  const outfile = path.join(tmp, name)
  esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
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
const R = await bundle('src/other/otherRoutePlan.ts', 'otherRoutePlan.mjs')
const N = await bundle('src/other/otherNext.ts', 'otherNext.mjs')

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'runs', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  }
}

// ---------------------------------------------------------------- fixtures
const P = (x, y = 0) => ({ x: x * 1e6, y: y * 1e6, z: 0, system: 'stanton', body: null })
const S0 = P(0)
const T0 = Date.parse('2026-10-15T12:00:00Z')
let seed = 4242
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

/** steps: [id, kind, x, y?, item?] ; x null = no point */
const mkJob = (id, steps, status = 'active') => ({
  id,
  ref: id,
  title: id,
  kind: 'delivery',
  reward: 1,
  status,
  createdAt: 1,
  steps: steps.map(([sid, kind, x, y = 0, item]) => ({
    id: sid,
    kind,
    label: `${kind} ${sid}`,
    location: `Place-${x == null ? 'none' : `${x}_${y}`}`,
    ...(item ? { item } : {}),
    have: 0,
    need: 1,
    done: false,
    _pt: x == null ? null : P(x, y)
  }))
})
/** OpenStopRow-like rows for every open step */
const rowsOf = (jobs) =>
  jobs.flatMap((job) =>
    job.status !== 'active'
      ? []
      : job.steps
          .filter((s) => !s.done && !s.withdrawn)
          .map((step) => ({ job, step, place: step.location, pickup: step.kind === 'pickup', ...(step._pt ? { point: step._pt } : {}) }))
  )
const key = (j, s) => `${j}:${s}`
const ids = (order) => order.map((k) => k.split(':')[1]).join(',')
const clone = (x) => JSON.parse(JSON.stringify(x))
/** every delivery after all its same-job same-item pickups */
const precedenceOk = (order, jobs) => {
  const pos = new Map(order.map((k, i) => [k, i]))
  for (const j of jobs) {
    for (const d of j.steps) {
      if (d.kind === 'pickup' || !d.item || !pos.has(key(j.id, d.id))) continue
      for (const p of j.steps) {
        if (p.kind !== 'pickup' || p.item !== d.item || !pos.has(key(j.id, p.id))) continue
        if (pos.get(key(j.id, p.id)) > pos.get(key(j.id, d.id))) return false
      }
    }
  }
  return true
}
const tripOf = (order, rows, start = S0) => {
  const by = new Map(rows.map((r) => [N.stopKey(r), r]))
  return N.routeTravel(order.map((k) => by.get(k)).filter(Boolean), start, []).meters
}
const randomJobs = (nJobs) => {
  const out = []
  for (let i = 0; i < nJobs; i++) {
    const r = rnd()
    const xy = () => [Math.round((rnd() * 200 - 100) * 10) / 10, Math.round((rnd() * 200 - 100) * 10) / 10]
    if (r < 0.4) out.push(mkJob(`J${i}`, [['g', 'go', ...xy()]]))
    else if (r < 0.8) out.push(mkJob(`J${i}`, [['d', 'turnin', ...xy(), 'Box'], ['p', 'pickup', ...xy(), 'Box']]))
    else out.push(mkJob(`J${i}`, [['p1', 'pickup', ...xy(), 'Ore'], ['p2', 'pickup', ...xy(), 'Ore'], ['d', 'turnin', ...xy(), 'Ore']]))
  }
  return out
}

// ---------------------------------------------------------------- planRoute
safe('plan', () => {
  let longer = 0, better = 0, nondet = 0, broke = 0, lost = 0, sets = 0
  for (let n = 3; n <= 22; n++) {
    for (let rep = 0; rep < 2; rep++) {
      const jobs = randomJobs(n)
      const rows = rowsOf(jobs)
      sets++
      const old = N.optimiseRoute(rows, S0, []) // 1.0.5 single pass
      const p = R.planRoute(rows, S0, [])
      const p2 = R.planRoute(rows.slice().reverse().reverse(), S0, [])
      if (p.plannedMeters > old.info.optimisedMeters + 1e-3) longer++
      if (p.plannedMeters < old.info.optimisedMeters - 1e-3) better++
      if (p.order.join('|') !== p2.order.join('|')) nondet++
      if (!precedenceOk(p.order, jobs)) broke++
      if (p.order.length !== rows.length || new Set(p.order).size !== rows.length) lost++
      if (Math.abs(tripOf(p.order, rows) - p.plannedMeters) > 1) broke++
    }
  }
  check('plan', `${sets} random sets: never longer than 1.0.5's single pass`, longer === 0, `longer ${longer}`)
  check('plan', 'random sets: shorter than 1.0.5 on some (multi-start helps)', better > 0, `better ${better}/${sets}`)
  check('plan', 'random sets: deterministic', nondet === 0, `differs ${nondet}`)
  check('plan', 'random sets: every delivery after all its same-item pickups; plannedMeters = trip', broke === 0, `broken ${broke}`)
  check('plan', 'random sets: no stop lost or doubled', lost === 0, `lost ${lost}`)
  // multi-pickup: the delivery is near, both pickups far apart
  const mp = [mkJob('M', [['p1', 'pickup', 10, 0, 'Ore'], ['p2', 'pickup', -10, 0, 'Ore'], ['d', 'turnin', 1, 0, 'Ore']])]
  const pm = R.planRoute(rowsOf(mp), S0, [])
  check('plan', 'two pickups of one item: delivery after both', pm.order.indexOf('M:d') === 2, ids(pm.order))
  // nearest-next above the cap
  const big = rowsOf(Array.from({ length: 30 }, (_, i) => mkJob(`B${i}`, [['g', 'go', Math.round(rnd() * 100), Math.round(rnd() * 100)]])))
  const capped = R.planRoute(big, S0, [], { maxStops: 20 })
  const nn = N.routeOrder(big, S0, []).map(N.stopKey)
  check('plan', 'above maxStops: nearest-next only (optimised false)', capped.optimised === false && capped.order.join('|') === nn.join('|'), String(capped.optimised))
  check('plan', 'ROUTE_PLAN_MAX_STOPS = 100', R.ROUTE_PLAN_MAX_STOPS === 100)
  // no point -> unplaced; a delivery whose pickup has no point is unplaced too
  const up = [mkJob('U', [['p', 'pickup', null, 0, 'Box'], ['d', 'turnin', 3, 0, 'Box']]), mkJob('V', [['g', 'go', 2]])]
  const pu = R.planRoute(rowsOf(up), S0, [])
  check('plan', 'no point -> unplaced (with its held delivery), not in order', ids(pu.order) === 'g' && pu.unplaced.includes('U:p') && pu.unplaced.includes('U:d'), `${ids(pu.order)} | ${pu.unplaced}`)
  // timing at 100 stops
  const hundred = rowsOf(randomJobs(60)).slice(0, 100)
  const t0 = performance.now()
  const ph = R.planRoute(hundred, S0, [])
  const ms = performance.now() - t0
  check('plan', `${hundred.length} stops: optimised, valid, under 3 s`, ph.optimised && ms < 3000 && ph.order.length === hundred.length, `${Math.round(ms)} ms`)
})

// ---------------------------------------------------------------- makePlan + reconcile
const baseJobs = () => [
  mkJob('J1', [['a', 'go', 1]]),
  mkJob('J2', [['p', 'pickup', 2, 0, 'Box'], ['d', 'turnin', 4, 0, 'Box']]),
  mkJob('J3', [['b', 'go', 3]]),
  mkJob('J4', [['c', 'go', 5]])
]

safe('makePlan', () => {
  const jobs = baseJobs()
  const plan = R.makePlan(rowsOf(jobs), S0, 'Start', [], T0)
  check('makePlan', 'plan doc: v1, order a,p,b,d,c, stops 5, planned event', plan.v === 1 && ids(plan.order) === 'a,p,b,d,c' && plan.stops === 5 &&
    plan.events.length === 1 && plan.events[0].kind === 'planned' && plan.at === new Date(T0).toISOString(), `${ids(plan.order)} ${JSON.stringify(plan.events)}`)
  check('makePlan', 'planned event text', /^Route planned · 5 stops · /.test(plan.events[0].text), plan.events[0].text)
  const re = R.makePlan(rowsOf(jobs), S0, 'Start', [], T0 + 1000, { prev: plan })
  check('makePlan', 'RE-PLAN: replanned event, grey/tags/added cleared', re.events.at(-1).kind === 'replanned' && re.grey.length === 0 && re.tags.length === 0 && re.added.length === 0)
})

safe('reconcile', () => {
  const jobs = baseJobs()
  const plan = R.makePlan(rowsOf(jobs), S0, 'Start', [], T0)
  // nothing changed
  const same = R.reconcile(plan, jobs, rowsOf(jobs), T0 + 10)
  check('reconcile', 'no change -> changed false, same plan', same.changed === false && same.plan === plan && same.newKeys.length === 0)
  // done step removed
  const j1 = clone(jobs)
  j1[0].steps[0].done = true
  const r1 = R.reconcile(plan, j1, rowsOf(j1), T0 + 20)
  check('reconcile', 'done step leaves the order; others keep order', ids(r1.plan.order) === 'p,b,d,c' && r1.changed, ids(r1.plan.order))
  check('reconcile', 'done note "<place> done · next: <place>"', r1.events[0]?.kind === 'done' && r1.events[0].text === 'Place-1_0 done · next: Place-2_0', r1.events[0]?.text)
  // abandoned job: both stops grey, kept in place
  const j2 = clone(jobs)
  j2[1].status = 'abandoned'
  const r2 = R.reconcile(plan, j2, rowsOf(j2), T0 + 30)
  check('reconcile', 'abandoned: stops stay in place, grey with reason', ids(r2.plan.order) === 'a,p,b,d,c' && r2.plan.grey.length === 2 &&
    r2.plan.grey.every((g) => g.reason === 'abandoned' && /^abandoned \d\d:\d\d$/.test(g.label)), JSON.stringify(r2.plan.grey))
  check('reconcile', 'abandoned note "J2 abandoned · 2 stops greyed out"', r2.events.some((e) => e.kind === 'grey' && e.text === 'J2 abandoned · 2 stops greyed out'), JSON.stringify(r2.events))
  // failed
  const j3 = clone(jobs)
  j3[2].status = 'failed'
  const r3 = R.reconcile(plan, j3, rowsOf(j3), T0)
  check('reconcile', 'failed: grey "failed", 1 stop', r3.plan.grey.length === 1 && r3.plan.grey[0].reason === 'failed' && r3.events[0].text === 'J3 failed · 1 stop greyed out', JSON.stringify(r3.events))
  // withdrawn step
  const j4 = clone(jobs)
  j4[3].steps[0].withdrawn = true
  const r4 = R.reconcile(plan, j4, rowsOf(j4), T0)
  check('reconcile', 'withdrawn step: grey "withdrawn", kept last', r4.plan.grey[0]?.key === 'J4:c' && r4.plan.grey[0].reason === 'withdrawn' && r4.plan.order.at(-1) === 'J4:c', JSON.stringify(r4.plan.grey))
  // job removed
  const j5 = clone(jobs).filter((j) => j.id !== 'J3')
  const r5 = R.reconcile(plan, j5, rowsOf(j5), T0)
  check('reconcile', 'job removed: grey "removed", kept in place', r5.plan.grey[0]?.key === 'J3:b' && r5.plan.grey[0].reason === 'removed' && r5.plan.order[2] === 'J3:b', JSON.stringify(r5.plan.grey))
  // grey stays grey on later reconciles and is never counted
  const again = R.reconcile(r5.plan, j5, rowsOf(j5), T0 + 5000)
  check('reconcile', 'grey stays, no new event', again.changed === false && again.plan.grey.length === 1)
  // complete: everything done (one grey left)
  const j6 = clone(j5)
  j6.forEach((j) => j.steps.forEach((s) => (s.done = true)))
  const r6 = R.reconcile(r5.plan, j6, rowsOf(j6), T0 + 60)
  check('reconcile', 'all open done -> complete (grey does not count)', !!r6.plan.complete && r6.events.at(-1).kind === 'complete' && r6.events.at(-1).text === 'Route complete', JSON.stringify(r6.events))
  const r7 = R.reconcile(r6.plan, j6, rowsOf(j6), T0 + 70)
  check('reconcile', 'complete plan left as it is', r7.changed === false && r7.plan === r6.plan)
  // new contract -> newKeys
  const j8 = [...clone(jobs), mkJob('J9', [['n', 'go', 6]])]
  const r8 = R.reconcile(plan, j8, rowsOf(j8), T0)
  check('reconcile', 'new open stop -> newKeys', r8.newKeys.join() === 'J9:n' && !r8.plan.complete, r8.newKeys.join())
  // events capped at 10, newest last
  let p = plan
  for (let i = 0; i < 14; i++) p = { ...p, events: [...p.events, { at: new Date(T0 + i).toISOString(), kind: 'position', text: `e${i}` }].slice(-10) }
  const j9 = clone(jobs)
  j9[0].steps[0].done = true
  const r9 = R.reconcile(p, j9, rowsOf(j9), T0 + 99)
  check('reconcile', 'events max 10, newest last', r9.plan.events.length === 10 && r9.plan.events.at(-1).kind === 'done', `${r9.plan.events.length}`)
})

// ---------------------------------------------------------------- slotIn
safe('slotIn', () => {
  const jobs = baseJobs()
  const plan = R.makePlan(rowsOf(jobs), S0, 'Start', [], T0)
  // new contract pickup far right, drop near start
  const js = [...clone(jobs), mkJob('J5', [['d', 'turnin', 0.5, 0, 'Gem'], ['p', 'pickup', 4.5, 0, 'Gem']])]
  const rows = rowsOf(js)
  const s = R.slotIn(plan, rows, S0, [], { keys: ['J5:d', 'J5:p'], now: T0 + 100 })
  const old = s.plan.order.filter((k) => !k.startsWith('J5:'))
  check('slotIn', 'other stops keep their relative order', old.join('|') === plan.order.join('|'), ids(s.plan.order))
  check('slotIn', 'precedence kept (drop-off after pickup)', s.plan.order.indexOf('J5:p') < s.plan.order.indexOf('J5:d'), ids(s.plan.order))
  check('slotIn', 'two inserted with addMeters, stops +2', s.inserted.length === 2 && s.inserted.every((i) => typeof i.addMeters === 'number') && s.plan.stops === plan.stops + 2, JSON.stringify(s.inserted))
  // cheapest: try every valid position by brute force
  let bestM = Infinity
  const base = plan.order
  for (let i = 0; i <= base.length; i++) for (let k = i; k <= base.length; k++) {
    const o = base.slice()
    o.splice(k, 0, 'J5:d')
    o.splice(i, 0, 'J5:p')
    if (!precedenceOk(o, js)) continue
    bestM = Math.min(bestM, tripOf(o, rows))
  }
  check('slotIn', 'result is no worse than +' + '10% of the best two-stop insertion', tripOf(s.plan.order, rows) <= bestM * 1.1 + 1, `${tripOf(s.plan.order, rows) / 1e6} vs ${bestM / 1e6}`)
  check('slotIn', 'NEW tags on both, added entries with jobRef', s.plan.tags.filter((t) => t.tag === 'NEW').length === 2 && s.plan.added.length === 2 && s.plan.added.every((a) => a.jobRef === 'J5'))
  const ev = s.events[0]?.text ?? ''
  check('slotIn', 'note "J5 added · pickup Nth, drop-off Mth · +X"', /^J5 added · pickup \d+(st|nd|rd|th), drop-off \d+(st|nd|rd|th) · \+/.test(ev), ev)
  check('slotIn', 'MOVED on stops whose previous stop changed', s.plan.tags.some((t) => t.tag === 'MOVED'), JSON.stringify(s.plan.tags))
  // may go first: a stop right next to the current position
  const jf = [...clone(jobs), mkJob('J6', [['f', 'go', 0.1]])]
  const sf = R.slotIn(plan, rowsOf(jf), S0, [], { keys: ['J6:f'], now: T0 })
  check('slotIn', 'may go before the current next stop', sf.plan.order[0] === 'J6:f' && /stop|1st/.test(sf.events[0].text), `${ids(sf.plan.order)} ${sf.events[0]?.text}`)
  // from the current position, not the plan start: we are at x=5 now
  const sc = R.slotIn(plan, rowsOf(jf), P(5), [], { keys: ['J6:f'], now: T0 })
  check('slotIn', 'measured from the current position (not first from x=5)', sc.plan.order[0] !== 'J6:f', ids(sc.plan.order))
  // a new pickup for an existing delivery must go before it
  const jx = clone(jobs)
  jx[1].steps.push({ id: 'p2', kind: 'pickup', label: 'p2', location: 'Place-9_0', item: 'Box', have: 0, need: 1, done: false, _pt: P(9) })
  const sx = R.slotIn(plan, rowsOf(jx), S0, [], { keys: ['J2:p2'], now: T0 })
  check('slotIn', 'new pickup goes before its existing delivery', sx.plan.order.indexOf('J2:p2') < sx.plan.order.indexOf('J2:d'), ids(sx.plan.order))
  // a new contract with no point -> unplaced; once placed it is an added stop (C)
  const jn = [...clone(jobs), mkJob('J7', [['q', 'go', null]])]
  const u = R.updatePlan(plan, jn, rowsOf(jn), S0, [], T0)
  check('slotIn', 'new stop with no point -> unplaced, not in order, pending as added', u.plan.unplaced.includes('J7:q') && !u.plan.order.includes('J7:q') &&
    (u.plan.pendingAdded ?? []).includes('J7:q'), JSON.stringify(u.plan.unplaced))
  const jp = clone(jn)
  jp[4].steps[0]._pt = P(3.5)
  const u2 = R.updatePlan(u.plan, jp, rowsOf(jp), S0, [], T0 + 1000)
  const addEv = u2.events.find((e) => e.kind === 'added')
  check('slotIn', 'new contract placed later: slotted in, others keep order, note "J7 added · …"',
    u2.plan.order.includes('J7:q') && !u2.plan.unplaced.includes('J7:q') && u2.plan.order.filter((k) => k !== 'J7:q').join('|') === plan.order.join('|') &&
      /^J7 added · drop-off \d+(st|nd|rd|th) · \+/.test(addEv?.text ?? ''), `${ids(u2.plan.order)} ${JSON.stringify(u2.events)}`)
  check('slotIn', 'new contract placed later counts as added (entry with jobRef + addMeters, pending cleared)',
    u2.plan.added.length === 1 && u2.plan.added[0].key === 'J7:q' && u2.plan.added[0].jobRef === 'J7' && typeof u2.plan.added[0].addMeters === 'number' &&
      !(u2.plan.pendingAdded ?? []).length, JSON.stringify(u2.plan.added))
  const vu2 = R.routeView(u2.plan, rowsOf(jp), { now: T0 + 1500, locations: [], start: S0 })
  check('slotIn', 'status "+1 stop added" for a contract placed later', / · \+1 stop added/.test(vu2.status.text), vu2.status.text)
  // unplaced at PLAN time, placed later -> 'placed', not added
  const plan7 = R.makePlan(rowsOf(jn), S0, 'Start', [], T0)
  check('slotIn', 'plan-time no point -> unplaced, not pending', plan7.unplaced.includes('J7:q') && !(plan7.pendingAdded ?? []).length)
  const u3 = R.updatePlan(plan7, jp, rowsOf(jp), S0, [], T0 + 1000)
  const placedEv = u3.events.find((e) => e.kind === 'placed')
  check('slotIn', 'plan-time unplaced placed later: note "<place> placed · now stop N"',
    u3.plan.order.includes('J7:q') && /^Place-none placed · now stop \d+$/.test(placedEv?.text ?? ''), `${ids(u3.plan.order)} ${placedEv?.text}`)
  check('slotIn', 'plan-time unplaced is not counted as added', u3.plan.added.length === 0 && !u3.events.some((e) => e.kind === 'added'))
  // updatePlan: new contract accepted anywhere -> slotted in
  const ja = [...clone(jobs), mkJob('J8', [['z', 'go', 4.2]])]
  const ua = R.updatePlan(plan, ja, rowsOf(ja), S0, [], T0)
  check('slotIn', 'updatePlan slots a new contract in', ua.changed && ua.plan.order.includes('J8:z') && ua.events.some((e) => e.kind === 'added'), ids(ua.plan.order))
  // after complete: new contracts don't reopen the plan (preview instead)
  const jd = clone(jobs)
  jd.forEach((j) => j.steps.forEach((s) => (s.done = true)))
  const done = R.updatePlan(plan, jd, rowsOf(jd), S0, [], T0).plan
  const after = [...jd, mkJob('J9', [['y', 'go', 2]])]
  const ud = R.updatePlan(done, after, rowsOf(after), S0, [], T0 + 10)
  check('slotIn', 'complete plan: a new contract is not slotted in', !!ud.plan.complete && !ud.plan.order.includes('J9:y'))
})

// ---------------------------------------------------------------- history, ids, restored, complete with unplaced
safe('history', () => {
  const jobs = baseJobs()
  const plan = R.makePlan(rowsOf(jobs), S0, 'Start', [], T0)
  const j2 = jobs.find((j) => j.id === 'J2')
  const rest = clone(jobs).filter((j) => j.id !== 'J2')
  // A: completed in history -> done, not 'removed'
  const hc = [{ id: 'J2', ref: 'J2', outcome: 'completed', steps: clone(j2.steps).map((s) => ({ ...s, done: true })) }]
  const rc = R.reconcile(plan, rest, rowsOf(rest), T0 + 10, hc)
  check('history', 'job completed (in history): its stops are done, not grey', rc.plan.grey.length === 0 && ids(rc.plan.order) === 'a,b,c' &&
    rc.events.some((e) => e.kind === 'done') && !rc.events.some((e) => e.kind === 'grey'), `${ids(rc.plan.order)} ${JSON.stringify(rc.events)}`)
  // A: abandoned in history -> grey abandoned with the stop from the history steps
  const ha = [{ id: 'J2', ref: 'J2', outcome: 'abandoned', steps: clone(j2.steps) }]
  const ra = R.updatePlan(plan, rest, rowsOf(rest), S0, [], T0 + 10, ha)
  check('history', 'job abandoned (in history): grey "abandoned" with its stop kept', ra.plan.grey.length === 2 &&
    ra.plan.grey.every((g) => g.reason === 'abandoned' && g.stop?.ref === 'J2' && (g.stop?.place === 'Place-2_0' || g.stop?.place === 'Place-4_0')) &&
    ra.events.some((e) => e.text === 'J2 abandoned · 2 stops greyed out'), JSON.stringify(ra.plan.grey))
  // A: neither -> removed; a job whose id differs from its ref never shows the id
  const secretJob = { ...mkJob('ID-0001', [['s', 'go', 2.2]]), ref: 'J11' }
  const js = [...clone(jobs), secretJob]
  const ps = R.makePlan(rowsOf(js), S0, 'Start', [], T0)
  const rs = R.reconcile(ps, clone(jobs), rowsOf(jobs), T0 + 10, [])
  const allText = JSON.stringify(rs.plan.events) + JSON.stringify(rs.plan.grey.map((g) => [g.label, g.stop ?? null]))
  check('history', 'job in neither list: grey "removed", note "A contract removed · …"', rs.plan.grey[0]?.reason === 'removed' &&
    rs.events.some((e) => e.text === 'A contract removed · 1 stop greyed out'), JSON.stringify(rs.events))
  check('history', 'no job id in any note or grey text', !allText.includes('ID-0001'), allText)
  // the ref of a removed job comes from the added entry when it was slotted in
  const ua = R.updatePlan(plan, js, rowsOf(js), S0, [], T0 + 5)
  const rr = R.reconcile(ua.plan, clone(jobs), rowsOf(jobs), T0 + 20, [])
  check('history', 'removed job slotted in after planning: note names its ref, not its id', rr.events.some((e) => e.text === 'J11 removed · 1 stop greyed out') &&
    !JSON.stringify(rr.plan.events).includes('ID-0001'), JSON.stringify(rr.events))
  // a done note for a key with no row and no step never prints the key
  const hx = [{ id: 'ID-0001', ref: 'J11', outcome: 'completed', steps: [] }]
  const rd = R.reconcile(ps, clone(jobs), rowsOf(jobs), T0 + 10, hx)
  check('history', 'done note without a step: no id in the text', rd.events.some((e) => e.kind === 'done') && !JSON.stringify(rd.events).includes('ID-0001'), JSON.stringify(rd.events))
  // D: restored contract
  const jab = clone(jobs)
  jab[1].status = 'abandoned'
  const g = R.reconcile(plan, jab, rowsOf(jab), T0 + 30).plan
  const back = clone(jobs)
  const rb = R.reconcile(g, back, rowsOf(back), T0 + 40)
  check('history', 'restored: grey entry gone, kept in its place, note "J2 restored"', rb.plan.grey.length === 0 && ids(rb.plan.order) === 'a,p,b,d,c' &&
    rb.events.some((e) => e.text === 'J2 restored') && rb.changed, `${ids(rb.plan.order)} ${JSON.stringify(rb.events)}`)
  const vb = R.routeView(rb.plan, rowsOf(back), { now: T0 + 41, locations: [], start: S0 })
  check('history', 'restored: numbered again', vb.rows.map((r) => r.number).join() === '1,2,3,4,5', vb.rows.map((r) => r.number).join())
  // E: complete must wait for an open unplaced key
  const ju = [...clone(jobs), mkJob('J7', [['q', 'go', null]])]
  const pu = R.makePlan(rowsOf(ju), S0, 'Start', [], T0)
  const jd = clone(ju)
  jd.slice(0, 4).forEach((j) => j.steps.forEach((s) => (s.done = true)))
  const rcu = R.updatePlan(pu, jd, rowsOf(jd), S0, [], T0 + 50)
  check('history', 'not complete while an open stop waits for a place', !rcu.plan.complete && rcu.plan.unplaced.includes('J7:q'), JSON.stringify(rcu.events))
})

// ---------------------------------------------------------------- replan suggestion
safe('replan', () => {
  const jobs = Array.from({ length: 6 }, (_, i) => mkJob(`R${i}`, [['g', 'go', i + 1]]))
  const rows = rowsOf(jobs)
  const plan = R.makePlan(rows, S0, 'Start', [], T0)
  check('replan', 'fresh plan: no suggestion', R.replanPct(plan, rows, S0, []) === null)
  // zig-zag order made by added stops: 1,6,2,5,3,4 = 1+5+4+3+2+1 = 16 vs 6
  const zig = { ...plan, order: ['R0:g', 'R5:g', 'R1:g', 'R4:g', 'R2:g', 'R3:g'], added: [{ key: 'R5:g', at: new Date(T0).toISOString(), addMeters: 1, jobRef: 'R5' }] }
  const pct = R.replanPct(zig, rows, S0, [])
  check('replan', 'zig-zag: suggests RE-PLAN with the % longer', pct === Math.round(((16 - 6) / 6) * 100), String(pct))
  // just under 15%: 1,2,3,4,6,5 = 1+1+1+1+2+1 = 7 vs 6 -> 17% -> suggest; 1,2,3,5,4,6 = 8? use a small detour instead
  const small = { ...plan, order: ['R0:g', 'R1:g', 'R2:g', 'R3:g', 'R4:g', 'R5:g'], added: zig.added }
  check('replan', 'best order: no suggestion', R.replanPct(small, rows, S0, []) === null)
  const v = R.routeView(zig, rows, { now: T0 + 1000, locations: [], start: S0 })
  check('replan', 'status text carries the suggestion', /Added stops made the route 167% longer than a fresh plan · RE-PLAN\?$/.test(v.status.text) && v.replanPct === 167, v.status.text)
})

safe('replanCache', () => {
  const jobs = Array.from({ length: 6 }, (_, i) => mkJob(`Q${i}`, [['g', 'go', i + 1]]))
  const rows = rowsOf(jobs)
  const plan = R.makePlan(rows, S0, 'Start', [], T0)
  const zig = { ...plan, order: ['Q0:g', 'Q5:g', 'Q1:g', 'Q4:g', 'Q2:g', 'Q3:g'], added: [{ key: 'Q5:g', at: new Date(T0).toISOString(), addMeters: 1, jobRef: 'Q5' }] }
  const a = R.replanPct(zig, rows, S0, [], T0)
  // a live read moves the position: from x=6 a fresh plan would differ (300%), but the check is not run again
  const b = R.replanPct(zig, rows, P(6), [], T0 + 1000)
  check('replan', 'live position read within 60 s: no new plan (cached on order + added count)', a === 167 && b === 167, `${a} ${b}`)
  const c = R.replanPct(zig, rows, P(6), [], T0 + 61_000)
  check('replan', 'after 60 s: re-checked from the new position', c === 300, String(c))
  const zig2 = { ...zig, added: [...zig.added, { key: 'Q4:g', at: new Date(T0).toISOString(), addMeters: 1, jobRef: 'Q4' }] }
  const d = R.replanPct(zig2, rows, S0, [], T0 + 62_000)
  check('replan', 'added count changed: re-checked at once', d === 167, String(d))
  const vr = R.routeView(zig, rows, { now: T0 + 62_500, locations: [], start: S0 })
  check('replan', 'routeView uses the cached check (now passed in)', vr.replanPct === 300, String(vr.replanPct))
})

// ---------------------------------------------------------------- routeView
safe('view', () => {
  // two stops at the same place in a row, one no-point stop
  const jobs = [
    mkJob('J1', [['a', 'go', 1]]),
    mkJob('J2', [['p', 'pickup', 2, 0, 'Box'], ['d', 'turnin', 2, 0, 'Box']]),
    mkJob('J3', [['b', 'go', 3]]),
    mkJob('J4', [['x', 'go', null]])
  ]
  const rows = rowsOf(jobs)
  const pv = R.routeView(null, rows, { now: T0, locations: [], start: S0, startLabel: 'Start' })
  check('view', 'no plan -> preview, status text/short', pv.state === 'preview' && pv.status.text === "Not planned (preview) · press PLAN ROUTE when you're ready to fly" && pv.status.short === 'ROUTE · not planned', pv.status.text)
  check('view', 'preview: numbers for routable rows only', pv.rows.map((r) => r.number).join() === '1,2,3,4,' && pv.unroutable === 1, pv.rows.map((r) => r.number).join())
  check('view', 'unroutable why: "No place yet · fix the tag to route it"', pv.rows.at(-1).why === 'No place yet · fix the tag to route it')
  const plan = R.makePlan(rows, S0, 'Start', [], T0)
  const v = R.routeView(plan, rows, { now: T0 + 1000, locations: [], start: S0 })
  check('view', 'planned: numbers 1..4, no-point row last without number', v.state === 'planned' && v.rows.map((r) => r.number).join() === '1,2,3,4,', v.rows.map((r) => `${r.key}=${r.number}`).join(' '))
  check('view', 'same place in a row = one visit', v.rows[1].visitId === v.rows[2].visitId && v.rows[0].visitId !== v.rows[1].visitId, v.rows.map((r) => r.visitId).join(' '))
  const visits = R.routeVisits(v)
  check('view', 'visit label "Place-2_0 · pick up 1 · drop off 1"', R.visitLabel(visits[1].rows) === 'Place-2_0 · pick up 1 · drop off 1', R.visitLabel(visits[1].rows))
  check('view', 'why: closest next from start with distance', v.rows[0].why === 'Closest next stop from Start · 1.0 Mm', v.rows[0].why)
  check('view', 'why: after its pickup', v.rows[2].why === 'After its pickup at Place-2_0 (J2)', v.rows[2].why)
  check('view', 'status text "🔒 Route planned HH:MM · 4 stops · 3.0 Mm"', /^\u{1F512} Route planned \d\d:\d\d · 4 stops · 3\.0 Mm$/u.test(v.status.text) && v.status.short === '\u{1F512} ROUTE · 4 of 4 left', `${v.status.text} | ${v.status.short}`)
  check('view', 'status pieces: plannedAt, stops, left, meters, unroutable', v.status.plannedAt === plan.at && v.status.stops === 4 && v.status.left === 4 && v.status.meters === 3e6 && v.status.unroutable === 1)
  check('view', 'notes: planned event shown younger than 4 s', v.notes.length === 1 && v.notes[0].kind === 'planned')
  const v5 = R.routeView(plan, rows, { now: T0 + 4001, locations: [], start: S0 })
  check('view', 'notes: gone after 4 s', v5.notes.length === 0)
  // grey kept in place, no number, not counted
  const j2 = clone(jobs)
  j2[1].status = 'abandoned'
  const g = R.reconcile(plan, j2, rowsOf(j2), T0 + 2000).plan
  const vg = R.routeView(g, rowsOf(j2), { now: T0 + 2500, locations: [], start: S0 })
  check('view', 'grey rows kept in place without numbers; others renumbered', vg.rows.map((r) => `${r.number ?? (r.grey ? 'G' : '-')}`).join() === '1,G,G,2,-', vg.rows.map((r) => `${r.key}=${r.number}`).join(' '))
  check('view', 'grey row: row null (job ended), label + why', vg.rows[1].row === null && /^abandoned \d\d:\d\d$/.test(vg.rows[1].grey.label) && /^Abandoned \d\d:\d\d/.test(vg.rows[1].why), vg.rows[1].why)
  check('view', 'grey row still names its stop (label, ref, place kept when it went grey)', !!vg.rows[1].grey.stop && !!vg.rows[1].grey.stop.label && vg.rows[1].grey.stop.ref === 'J2' && !!vg.rows[1].grey.stop.place, JSON.stringify(vg.rows[1].grey.stop))
  check('view', 'status: stops not counting grey, dropped count', vg.status.stops === 2 && vg.status.left === 2 && vg.status.droppedCount === 2, JSON.stringify(vg.status))
  // tags younger than 60 s; added why; added count in status
  const ja = [...clone(jobs), mkJob('J5', [['n', 'go', 2.5]])]
  const ua = R.updatePlan(plan, ja, rowsOf(ja), S0, [], T0 + 3000).plan
  const vt = R.routeView(ua, rowsOf(ja), { now: T0 + 3000 + 59_000, locations: [], start: S0 })
  const nrow = vt.rows.find((r) => r.key === 'J5:n')
  check('view', 'NEW tag within 60 s; added why', nrow?.tag === 'NEW' && /^Added after planning \(J5\) · cheapest spot · \+/.test(nrow.why), `${nrow?.tag} ${nrow?.why}`)
  check('view', 'status "+1 stop added (+X)"', / · \+1 stop added \(\+[\d.]+ \w+\)/.test(vt.status.text) && vt.status.addedCount === 1, vt.status.text)
  const vt2 = R.routeView(ua, rowsOf(ja), { now: T0 + 3000 + 60_000, locations: [], start: S0 })
  check('view', 'tags gone after 60 s', vt2.rows.every((r) => !r.tag))
  // complete; then a new contract -> preview
  const jd = clone(jobs)
  jd.forEach((j) => j.steps.forEach((s) => (s.done = true)))
  const done = R.updatePlan(plan, jd, rowsOf(jd), S0, [], T0 + 9000).plan
  const vc = R.routeView(done, rowsOf(jd), { now: T0 + 9500, locations: [], start: S0 })
  check('view', 'complete: text and short both "Route complete"', vc.state === 'complete' && vc.status.text === 'Route complete' && vc.status.short === 'Route complete' && vc.notes.some((e) => e.kind === 'complete'), vc.status.text)
  const jn = [...jd, mkJob('J9', [['y', 'go', 2]])]
  const vn = R.routeView(done, rowsOf(jn), { now: T0 + 9600, locations: [], start: S0 })
  check('view', 'complete + new contract -> preview', vn.state === 'preview' && vn.rows[0]?.number === 1)
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\nroute_plan_checks: ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
