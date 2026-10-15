/**
 * Locked route (batch 19, Plan A): Other mode, ROUTE order with Route optimization on.
 * Pure: plan once (PLAN ROUTE), then the order only changes when contracts are added (slotIn), finished (removed) or
 * dropped (grey, kept in place). Saved as OtherJobsDoc.routePlan. Contract: docs/contracts/batch-19-locked-route.md.
 */
import type { Location } from '@shared/types'
import type { OtherJob, OtherStep } from '@other/otherJob'
import { travel, type GeoPoint } from './otherGeo'
import {
  costLess,
  formatDistance,
  improveRoute,
  isOpenPickup,
  pickupIndicesFor,
  placeAfterPickups,
  routeOrder,
  samePoint,
  stepActivePlace,
  stepIsPickup,
  stopKey,
  type Cost,
  type OpenStopRow
} from './otherNext'

export type GreyReason = 'abandoned' | 'failed' | 'withdrawn' | 'removed'

export type RouteEventKind = 'planned' | 'replanned' | 'done' | 'added' | 'grey' | 'placed' | 'complete' | 'position'

export interface RouteEvent {
  /** ISO time */
  at: string
  kind: RouteEventKind
  text: string
}

export interface RouteGrey {
  key: string
  reason: GreyReason
  /** ISO time it went grey */
  at: string
  /** "<reason> HH:MM" */
  label: string
  /** what the stop was, kept when it went grey so the row still names it after its job leaves the open list */
  stop?: { label: string; ref: string; place: string }
}

export interface RouteTag {
  key: string
  tag: 'NEW' | 'MOVED'
  at: string
}

export interface RouteAdded {
  key: string
  at: string
  /** extra metres the insertion cost (null when a leg can't be measured) */
  addMeters: number | null
  jobRef: string
}

export interface RoutePlanDoc {
  v: 1
  /** plan time (ISO) */
  at: string
  startLabel: string
  startPoint?: { x: number; y: number; z: number; system?: string | null; body?: string | null } | null
  /** stopKey(job, step) in planned order: open + grey kept in place; done removed */
  order: string[]
  /** open stops known at planning (or added since) that had no place: slotted in when they get one ('placed') */
  unplaced: string[]
  nearestMeters: number | null
  plannedMeters: number | null
  plannedJumps: number
  /** routed stops at plan time plus every stop slotted in since (status "N stops") */
  stops: number
  grey: RouteGrey[]
  tags: RouteTag[]
  added: RouteAdded[]
  /** newest last, max ROUTE_EVENTS_MAX */
  events: RouteEvent[]
  /** ISO time the route completed (no open planned stops left) */
  complete?: string
  /** keys in unplaced that were first seen after planning (new contracts): counted as added once slotted in */
  pendingAdded?: string[]
}

/** a finished job as the route needs it (OtherHistoryEntry fits): completed -> its stops are done; abandoned -> grey */
export type RouteHistoryEntry = { id: string; ref: string; outcome: 'completed' | 'abandoned'; steps: OtherStep[] }

/** what planRoute / slotIn / routeView need of a row (OpenStopRow fits) */
export type RouteRow = { job: OtherJob; step: OtherStep; point?: GeoPoint; place?: string }

export interface PlanResult {
  /** stopKeys of routed rows in planned order */
  order: string[]
  /** stopKeys of rows that could not be routed (no point, or a delivery whose pickup has no point) */
  unplaced: string[]
  /** nearest-next trip over the routed rows */
  nearestMeters: number | null
  nearestJumps: number
  plannedMeters: number | null
  plannedJumps: number
  /** true = several improvement runs; false = above ROUTE_PLAN_MAX_STOPS (nearest-next only) */
  optimised: boolean
}

export interface SlotInserted {
  key: string
  /** index in the new plan.order */
  index: number
  addMeters: number | null
}

export interface ReconcileResult {
  plan: RoutePlanDoc
  changed: boolean
  /** events added by this call (also appended to plan.events) */
  events: RouteEvent[]
  /** open routable keys not in the plan (new contracts / undone steps): pass to slotIn */
  newKeys: string[]
  /** keys in plan.unplaced that now have a point: pass to slotIn with { placed } */
  placedKeys: string[]
}

export interface ViewRow {
  key: string
  /** null for a grey stop whose job/step is gone */
  row: OpenStopRow | null
  /** 1-based number among open routable rows; null for grey and unroutable rows */
  number: number | null
  grey?: { reason: GreyReason; at: string; label: string; stop?: RouteGrey['stop'] }
  /** NEW / MOVED, younger than ROUTE_TAG_MS */
  tag?: 'NEW' | 'MOVED'
  /** "Why here?" one line */
  why: string
  /** consecutive open rows at the same place share one visitId (the first row's key) */
  visitId: string
}

export interface RouteStatus {
  state: 'preview' | 'planned' | 'complete'
  /** ISO plan time; null in preview */
  plannedAt: string | null
  /** "HH:MM" of plannedAt; '' in preview */
  plannedClock: string
  /** stops in the plan (planned + added, minus grey); preview: routable rows */
  stops: number
  /** open numbered stops left */
  left: number
  /** plan total (metres) at plan time; preview: shown order's total */
  meters: number | null
  /** nearest-next minus planned (metres); null when unknown or <= 0 */
  saved: number | null
  /** remaining route from the current start over the numbered rows */
  remainingMeters: number | null
  addedCount: number
  addedMeters: number | null
  droppedCount: number
  unroutable: number
  replanPct: number | null
  /** Next tab line, e.g. "🔒 Route planned 13:40 · 12 stops · 98.6 Gm · saves 11.5 Gm" */
  text: string
  /** overlay line, e.g. "🔒 ROUTE · 7 of 12 left" */
  short: string
}

export interface RouteView {
  state: 'preview' | 'planned' | 'complete'
  rows: ViewRow[]
  status: RouteStatus
  /** plan events younger than ROUTE_NOTE_MS (newest last) */
  notes: RouteEvent[]
  replanPct: number | null
  unroutable: number
}

export const ROUTE_PLAN_MAX_STOPS = 100
export const ROUTE_EVENTS_MAX = 10
export const ROUTE_TAG_MS = 60_000
export const ROUTE_NOTE_MS = 4_000
export const ROUTE_REPLAN_PCT = 15

// ---------------------------------------------------------------- helpers

type Pt = GeoPoint

const iso = (now: number): string => new Date(now).toISOString()

/** local "HH:MM" of an ISO time or ms */
export function clockOf(t: string | number): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const ordinal = (n: number): string => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** a row the route can still visit: active job, step not done and not withdrawn */
export function isOpenRow(r: { job: OtherJob; step: OtherStep }): boolean {
  return r.job.status === 'active' && !r.step.done && !r.step.withdrawn
}

const hasPoint = (r: RouteRow): boolean => !!r.point && [r.point.x, r.point.y, r.point.z].every(Number.isFinite)

/** a pickup for notes and visit labels: a plain pickup step, or a combined step not yet collected */
const isPickupStep = (s: OtherStep): boolean => (s.kind === 'pickup' && !s.pickupLocation) || stepIsPickup(s)

const placeOf = (r: { step: OtherStep; place?: string }): string => (r.place ?? stepActivePlace(r.step)) || r.step.label

/** cost of start -> rows in order (rows need a point); meters sums the measurable legs */
function tripCost(rows: RouteRow[], start: Pt | null | undefined, locations: Location[]): Cost {
  const c: Cost = { bad: 0, jumps: 0, meters: 0 }
  let cur: Pt | undefined = start ?? undefined
  for (const r of rows) {
    if (cur) {
      const t = travel(cur, r.point, locations)
      if (!t) c.bad++
      else {
        c.jumps += t.jumps
        c.meters += t.meters
      }
    }
    cur = r.point
  }
  return c
}

const costMeters = (c: Cost): number | null => (c.bad ? null : c.meters)

/** open routable rows split: free to route, held (a delivery whose open pickup has no point), unplaced (no point) */
function splitRoutable(rows: RouteRow[]): { free: RouteRow[]; unplaced: RouteRow[] } {
  const open = rows.filter(isOpenRow)
  const noPoint = open.filter((r) => !hasPoint(r))
  const withPoint = open.filter(hasPoint)
  const held = withPoint.filter((r) => pickupIndicesFor(open, r).some((i) => !hasPoint(open[i])))
  return { free: withPoint.filter((r) => !held.includes(r)), unplaced: [...noPoint, ...held] }
}

/** true when every delivery comes after all its same-job same-item open pickups in seq */
function precedenceOk(seq: RouteRow[]): boolean {
  for (let i = 0; i < seq.length; i++) {
    for (const p of pickupIndicesFor(seq, seq[i])) if (p > i) return false
  }
  return true
}

// ---------------------------------------------------------------- planRoute

/**
 * The locked plan: best of several improvement runs over the open routable rows, each from a different deterministic
 * starting order (the 1.0.5 nearest-next first, so the plan is never longer than 1.0.5's). Every delivery after all
 * its same-job same-item pickups; fewest unmeasurable legs, then jumps, then metres. Above ROUTE_PLAN_MAX_STOPS:
 * nearest-next only. Rows that are done / withdrawn / not active are ignored.
 */
export function planRoute(
  rows: RouteRow[],
  start: GeoPoint,
  locations: Location[],
  opts?: { maxStops?: number }
): PlanResult {
  const { free, unplaced } = splitRoutable(rows)
  const nn = routeOrder(free, start, locations)
  const nnCost = tripCost(nn, start, locations)
  const base = {
    unplaced: unplaced.map(stopKey),
    nearestMeters: costMeters(nnCost),
    nearestJumps: nnCost.jumps
  }
  const maxStops = opts?.maxStops ?? ROUTE_PLAN_MAX_STOPS
  if (free.length > maxStops || free.length < 2) {
    return { ...base, order: nn.map(stopKey), plannedMeters: costMeters(nnCost), plannedJumps: nnCost.jumps, optimised: free.length <= maxStops }
  }
  // starting orders: nearest-next (1.0.5), nearest-next after each of the next-nearest first stops, the farthest
  // first stop, nearest-next reversed, and the given order (both made valid: deliveries after their pickups)
  const starts: RouteRow[][] = [nn]
  const firsts = free
    .filter((r) => !pickupIndicesFor(free, r).length)
    .map((r) => ({ r, c: tripCost([r], start, locations) }))
    .sort((a, b) => (costLess(a.c, b.c) ? -1 : costLess(b.c, a.c) ? 1 : 0))
    .map((x) => x.r)
  const forced = (f: RouteRow): RouteRow[] => [f, ...routeOrder(free.filter((r) => r !== f), f.point!, locations)]
  // most varied first; fewer runs on big sets (one improvement run is ~0.1 s at 50 stops, ~1 s at 100)
  const budget = free.length <= 40 ? 7 : free.length <= 60 ? 4 : free.length <= 80 ? 2 : 1
  const lazy: (() => RouteRow[])[] = [
    () => placeAfterPickups(nn.slice().reverse(), () => true),
    () => (firsts.length > 1 ? forced(firsts[1]) : []),
    () => (firsts.length > 2 ? forced(firsts[firsts.length - 1]) : []),
    () => placeAfterPickups(free.slice(), () => true),
    () => (firsts.length > 2 ? forced(firsts[2]) : []),
    () => (firsts.length > 3 ? forced(firsts[3]) : [])
  ]
  for (const make of lazy) {
    if (starts.length >= budget) break
    const s = make()
    if (s.length === free.length) starts.push(s)
  }

  // first run = 1.0.5 (nearest-next + improve); a later run wins only when strictly cheaper
  let best: RouteRow[] | null = null
  let bestCost: Cost = nnCost
  const seen = new Set<string>()
  for (const s of starts) {
    const sig = s.map(stopKey).join('|')
    if (seen.has(sig) || !precedenceOk(s)) continue
    seen.add(sig)
    const improved = improveRoute(s, start, locations)
    const c = tripCost(improved, start, locations)
    if (!best || costLess(c, bestCost)) {
      best = improved
      bestCost = c
    }
  }
  if (!best) best = nn
  return { ...base, order: best.map(stopKey), plannedMeters: costMeters(bestCost), plannedJumps: bestCost.jumps, optimised: true }
}

const pushEvents = (plan: RoutePlanDoc, ev: RouteEvent[]): RouteEvent[] =>
  [...plan.events, ...ev].slice(-ROUTE_EVENTS_MAX)

/** a fresh RoutePlanDoc (PLAN ROUTE / RE-PLAN): clears grey stops, tags and added; event planned / replanned */
export function makePlan(
  rows: RouteRow[],
  start: GeoPoint,
  startLabel: string,
  locations: Location[],
  now: number,
  opts?: { prev?: RoutePlanDoc | null; replan?: boolean }
): RoutePlanDoc {
  const p = planRoute(rows, start, locations)
  const replan = opts?.replan ?? !!(opts?.prev && !opts.prev.complete)
  const saved = p.nearestMeters != null && p.plannedMeters != null ? p.nearestMeters - p.plannedMeters : null
  const text =
    `${replan ? 'Route re-planned' : 'Route planned'} · ${plural(p.order.length, 'stop', 'stops')}` +
    (p.plannedMeters != null ? ` · ${formatDistance(p.plannedMeters)}` : '') +
    (saved != null && saved > 0.5 ? ` · saves ${formatDistance(saved)}` : '')
  const ev: RouteEvent = { at: iso(now), kind: replan ? 'replanned' : 'planned', text }
  return {
    v: 1,
    at: iso(now),
    startLabel,
    startPoint: { x: start.x, y: start.y, z: start.z, system: start.system ?? null, body: start.body ?? null },
    order: p.order,
    unplaced: p.unplaced,
    nearestMeters: p.nearestMeters,
    plannedMeters: p.plannedMeters,
    plannedJumps: p.plannedJumps,
    stops: p.order.length,
    grey: [],
    tags: [],
    added: [],
    events: [...(opts?.prev?.events ?? []), ev].slice(-ROUTE_EVENTS_MAX)
  }
}

// ---------------------------------------------------------------- slotIn

/**
 * Cheapest insertion of `keys` into the remaining order, measured from `current` (an insert may go first). The other
 * stops keep their relative order; deliveries stay after their pickups. Pickups are inserted before deliveries.
 * Keys with no row / no point (or a delivery whose pickup has no point) go to plan.unplaced instead.
 * opts.placed: the keys were unplaced and now have a point: event 'placed', not counted as added, unless the key was
 * first seen after planning (plan.pendingAdded): then it is an added stop like any new contract.
 * Tags: NEW on inserted stops; MOVED on stops whose previous open stop changed.
 */
export function slotIn(
  plan: RoutePlanDoc,
  rows: RouteRow[],
  current: GeoPoint | null | undefined,
  locations: Location[],
  opts: { keys: string[]; now: number; placed?: boolean }
): { plan: RoutePlanDoc; inserted: SlotInserted[]; events: RouteEvent[] } {
  const at = iso(opts.now)
  const byKey = new Map(rows.map((r) => [stopKey(r), r]))
  const greyKeys = new Set(plan.grey.map((g) => g.key))
  const seq = plan.order.slice()
  const unplaced = plan.unplaced.slice()
  const pending = (plan.pendingAdded ?? []).slice()
  // a key counts as added unless it was unplaced at plan time and is being placed now
  const isAdded = (k: string): boolean => !opts.placed || pending.includes(k)
  const openRows = rows.filter(isOpenRow)
  const want = opts.keys
    .filter((k, i, a) => a.indexOf(k) === i && !seq.includes(k))
    .map((k) => ({ k, r: byKey.get(k) }))
  // pickups first so their deliveries can follow
  want.sort((a, b) => Number(!!b.r && isOpenPickup(b.r.step)) - Number(!!a.r && isOpenPickup(a.r.step)))

  const openSeqRows = (s: string[]): RouteRow[] =>
    s.filter((k) => !greyKeys.has(k)).map((k) => byKey.get(k)).filter((r): r is RouteRow => !!r && hasPoint(r))
  const prevOpen = (s: string[]): Map<string, string> => {
    const m = new Map<string, string>()
    let prev = ''
    for (const k of s) {
      if (greyKeys.has(k)) continue
      m.set(k, prev)
      prev = k
    }
    return m
  }
  const before = prevOpen(seq)
  const insertedKeys: string[] = []
  const added: { key: string; addMeters: number | null }[] = []
  for (const { k, r } of want) {
    const pickupMissing =
      !!r && pickupIndicesFor(openRows, r).some((i) => !hasPoint(openRows[i]) || unplaced.includes(stopKey(openRows[i])))
    if (!r || !isOpenRow(r) || !hasPoint(r) || pickupMissing) {
      if (r && isOpenRow(r) && !unplaced.includes(k)) {
        unplaced.push(k)
        if (!opts.placed && !pending.includes(k)) pending.push(k)
      }
      continue
    }
    const baseCost = tripCost(openSeqRows(seq), current, locations)
    let bestAt = -1
    let bestCost: Cost | null = null
    for (let i = seq.length; i >= 0; i--) {
      const cand = [...seq.slice(0, i), k, ...seq.slice(i)]
      const candRows = openSeqRows(cand)
      if (!precedenceOk(candRows)) continue
      const c = tripCost(candRows, current, locations)
      if (!bestCost || costLess(c, bestCost)) {
        bestCost = c
        bestAt = i
      }
    }
    if (bestAt < 0 || !bestCost) {
      if (!unplaced.includes(k)) unplaced.push(k)
      if (!opts.placed && !pending.includes(k)) pending.push(k)
      continue
    }
    seq.splice(bestAt, 0, k)
    if (unplaced.includes(k)) unplaced.splice(unplaced.indexOf(k), 1)
    insertedKeys.push(k)
    added.push({ key: k, addMeters: baseCost.bad || bestCost.bad ? null : bestCost.meters - baseCost.meters })
  }
  const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((k, i) => b[i] === k)
  const withPending = (p: RoutePlanDoc, keep: string[]): RoutePlanDoc => {
    const next = { ...p }
    if (keep.length) next.pendingAdded = keep
    else delete next.pendingAdded
    return next
  }
  if (!insertedKeys.length) {
    const changed = !sameList(unplaced, plan.unplaced) || !sameList(pending, plan.pendingAdded ?? [])
    return { plan: changed ? withPending({ ...plan, unplaced }, pending) : plan, inserted: [], events: [] }
  }
  const after = prevOpen(seq)
  const moved = seq.filter((k) => !greyKeys.has(k) && !insertedKeys.includes(k) && before.has(k) && before.get(k) !== after.get(k))
  const tagFor = new Map<string, RouteTag>()
  for (const t of plan.tags) tagFor.set(t.key, t)
  for (const k of insertedKeys) tagFor.set(k, { key: k, tag: 'NEW', at })
  for (const k of moved) tagFor.set(k, { key: k, tag: 'MOVED', at })

  // numbers among open stops in the new order
  const numbered = seq.filter((k) => !greyKeys.has(k))
  const numberOf = (k: string): number => numbered.indexOf(k) + 1
  const inserted: SlotInserted[] = added.map((a) => ({ key: a.key, index: seq.indexOf(a.key), addMeters: a.addMeters }))
  const events: RouteEvent[] = []
  const addedNow = inserted.filter((a) => isAdded(a.key))
  for (const a of inserted) {
    if (isAdded(a.key)) continue
    const r = byKey.get(a.key)!
    events.push({ at, kind: 'placed', text: `${placeOf(r)} placed · now stop ${numberOf(a.key)}` })
  }
  {
    // one note per job: "J25 added · pickup 1st, drop-off 6th · +38 Gm"
    const jobs: string[] = []
    for (const a of addedNow) {
      const id = byKey.get(a.key)!.job.id
      if (!jobs.includes(id)) jobs.push(id)
    }
    for (const id of jobs) {
      const mine = addedNow.filter((a) => byKey.get(a.key)!.job.id === id).sort((x, y) => numberOf(x.key) - numberOf(y.key))
      const job = byKey.get(mine[0].key)!.job
      const parts = mine.map((a) => `${isPickupStep(byKey.get(a.key)!.step) ? 'pickup' : 'drop-off'} ${ordinal(numberOf(a.key))}`)
      const sum = mine.some((a) => a.addMeters == null) ? null : mine.reduce((s, a) => s + (a.addMeters ?? 0), 0)
      events.push({ at, kind: 'added', text: `${job.ref} added · ${parts.join(', ')}${sum != null ? ` · +${formatDistance(Math.max(0, sum))}` : ''}` })
    }
  }
  const addedKeys = addedNow.map((a) => a.key)
  const next: RoutePlanDoc = withPending({
    ...plan,
    order: seq,
    unplaced,
    stops: plan.stops + insertedKeys.length,
    tags: [...tagFor.values()],
    added: addedKeys.length
      ? [
          ...plan.added.filter((a) => !addedKeys.includes(a.key)),
          ...added.filter((a) => addedKeys.includes(a.key)).map((a) => ({ key: a.key, at, addMeters: a.addMeters, jobRef: byKey.get(a.key)!.job.ref }))
        ]
      : plan.added,
    events: pushEvents(plan, events)
  }, pending.filter((k) => !insertedKeys.includes(k)))
  delete next.complete
  return { plan: next, inserted, events }
}

// ---------------------------------------------------------------- reconcile

/** the job and step a stopKey names (job null = no such job; step null = job has no such step) */
function lookupKey(key: string, jobs: OtherJob[]): { job: OtherJob | null; step: OtherStep | null } {
  for (const job of jobs) {
    if (!key.startsWith(`${job.id}:`)) continue
    const stepId = key.slice(job.id.length + 1)
    return { job, step: job.steps.find((s) => s.id === stepId) ?? null }
  }
  return { job: null, step: null }
}

/** the history entry and step a stopKey names, for a job that has left the open list */
function lookupHistory(key: string, history: RouteHistoryEntry[]): { entry: RouteHistoryEntry | null; step: OtherStep | null } {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    if (!key.startsWith(`${h.id}:`)) continue
    const stepId = key.slice(h.id.length + 1)
    return { entry: h, step: h.steps.find((s) => s.id === stepId) ?? null }
  }
  return { entry: null, step: null }
}

/** job ref and step for a key from the open jobs, else from history (never the key itself: it holds ids) */
function describeKey(key: string, jobs: OtherJob[], history: RouteHistoryEntry[]): { ref: string | null; step: OtherStep | null } {
  const { job, step } = lookupKey(key, jobs)
  if (job) return { ref: job.ref, step }
  const h = lookupHistory(key, history)
  return { ref: h.entry?.ref ?? null, step: h.step }
}

type KeyState = { kind: 'open' } | { kind: 'done' } | { kind: 'grey'; reason: GreyReason }

function keyState(key: string, jobs: OtherJob[], history: RouteHistoryEntry[]): KeyState {
  const { job, step } = lookupKey(key, jobs)
  if (!job) {
    const { entry } = lookupHistory(key, history)
    if (entry?.outcome === 'completed') return { kind: 'done' }
    if (entry?.outcome === 'abandoned') return { kind: 'grey', reason: 'abandoned' }
    return { kind: 'grey', reason: 'removed' }
  }
  const status = job.status as string
  if (status === 'abandoned') return { kind: 'grey', reason: 'abandoned' }
  if (status === 'failed') return { kind: 'grey', reason: 'failed' }
  if (status === 'complete') return { kind: 'done' }
  if (!step) return { kind: 'grey', reason: 'removed' }
  if (step.done) return { kind: 'done' }
  if (step.withdrawn) return { kind: 'grey', reason: 'withdrawn' }
  return { kind: 'open' }
}

/**
 * Bring a plan up to date with the jobs: finished steps leave the order (event 'done'), dropped ones turn grey in
 * place (abandoned / failed job, withdrawn step, job or step gone: 'removed'). A job no longer in `jobs` is looked up
 * in `history`: completed -> done, abandoned -> grey 'abandoned'; only when neither has it is it 'removed'. A grey
 * stop whose step is open again (restored) leaves the grey list and is numbered again in its place ("<ref> restored").
 * Open keys the plan doesn't know are returned as newKeys and unplaced keys that now have a point as placedKeys (both
 * for slotIn; updatePlan does it). When no open planned stop is left (and nothing waits to be slotted in or placed)
 * the route is complete. A complete plan is left as it is.
 */
export function reconcile(
  plan: RoutePlanDoc,
  jobs: OtherJob[],
  rows: RouteRow[],
  now: number,
  history: RouteHistoryEntry[] = []
): ReconcileResult {
  if (plan.complete) return { plan, changed: false, events: [], newKeys: [], placedKeys: [] }
  const at = iso(now)
  const byKey = new Map(rows.map((r) => [stopKey(r), r]))
  const greyBy = new Map(plan.grey.map((g) => [g.key, g]))
  const done: string[] = []
  const newGrey: RouteGrey[] = []
  const restored: string[] = []
  const order: string[] = []
  for (const k of plan.order) {
    const st = keyState(k, jobs, history)
    if (greyBy.has(k)) {
      if (st.kind === 'open') restored.push(k)
      order.push(k)
      continue
    }
    if (st.kind === 'done') done.push(k)
    else if (st.kind === 'grey') {
      const { ref, step } = describeKey(k, jobs, history)
      const r = byKey.get(k)
      const stepOf = step ?? r?.step
      const stop = stepOf ? { label: stepOf.label, ref: ref ?? r?.job.ref ?? '', place: placeOf(r ?? { step: stepOf }) } : undefined
      newGrey.push({ key: k, reason: st.reason, at, label: `${st.reason} ${clockOf(now)}`, ...(stop ? { stop } : {}) })
      order.push(k)
    } else order.push(k)
  }
  const unplaced = plan.unplaced.filter((k) => keyState(k, jobs, history).kind === 'open')
  const pending = (plan.pendingAdded ?? []).filter((k) => unplaced.includes(k))
  const placedKeys = unplaced.filter((k) => {
    const r = byKey.get(k)
    return !!r && hasPoint(r)
  })
  const known = new Set([...order, ...unplaced])
  const newKeys = rows.filter((r) => isOpenRow(r) && !known.has(stopKey(r))).map(stopKey)
    .filter((k, i, a) => a.indexOf(k) === i)

  const grey = [...plan.grey.filter((g) => !restored.includes(g.key)), ...newGrey]
  const allGrey = new Set(grey.map((g) => g.key))
  /** what a stop is called in a note: its row, else its step (open jobs, then history) */
  const placeNameOf = (k: string): string => {
    const r = byKey.get(k)
    if (r) return placeOf(r)
    const { step } = describeKey(k, jobs, history)
    return step ? placeOf({ step }) : ''
  }
  /** the contract a stop belongs to in a note: job ref, grey snapshot ref, added ref, else "A contract" */
  const refOf = (k: string, g?: RouteGrey): string =>
    describeKey(k, jobs, history).ref || g?.stop?.ref || plan.added.find((a) => a.key === k)?.jobRef || 'A contract'
  const events: RouteEvent[] = []
  if (done.length) {
    const places = done.map((k) => placeNameOf(k) || 'A stop').filter((p, i, a) => a.indexOf(p) === i)
    const nextKey = order.find((k) => !allGrey.has(k))
    const nextPlace = nextKey ? placeNameOf(nextKey) : ''
    events.push({ at, kind: 'done', text: `${places.join(', ')} done${nextPlace ? ` · next: ${nextPlace}` : ''}` })
  }
  // one note per job and reason: "J22 abandoned · 2 stops greyed out"
  const groups = new Map<string, RouteGrey[]>()
  for (const g of newGrey) {
    const id = `${refOf(g.key, g)}\u0000${g.reason}`
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id)!.push(g)
  }
  for (const [id, gs] of groups) {
    const [ref, reason] = id.split('\u0000')
    events.push({ at, kind: 'grey', text: `${ref} ${reason} · ${plural(gs.length, 'stop', 'stops')} greyed out` })
  }
  // one note per job: "J22 restored"
  const restoredRefs = restored.map((k) => refOf(k, greyBy.get(k))).filter((r, i, a) => a.indexOf(r) === i)
  for (const ref of restoredRefs) events.push({ at, kind: 'position', text: `${ref} restored` })

  let next: RoutePlanDoc = plan
  const changed =
    done.length > 0 || newGrey.length > 0 || restored.length > 0 || unplaced.length !== plan.unplaced.length ||
    pending.length !== (plan.pendingAdded ?? []).length
  if (changed) {
    next = {
      ...plan,
      order,
      unplaced,
      grey,
      tags: plan.tags.filter((t) => !done.includes(t.key)),
      events: pushEvents(plan, events)
    }
    if (pending.length) next.pendingAdded = pending
    else delete next.pendingAdded
  }
  if (!newKeys.length && !placedKeys.length) {
    const c = completeIfDone(next, now)
    if (c !== next) {
      events.push(c.events[c.events.length - 1])
      return { plan: c, changed: true, events, newKeys, placedKeys }
    }
  }
  return { plan: next, changed, events, newKeys, placedKeys }
}

/** marks the plan complete when no open planned stop is left (grey ones don't count) and none waits for a place */
function completeIfDone(plan: RoutePlanDoc, now: number): RoutePlanDoc {
  if (plan.complete) return plan
  if (plan.unplaced.length) return plan
  const grey = new Set(plan.grey.map((g) => g.key))
  if (plan.order.some((k) => !grey.has(k))) return plan
  const ev: RouteEvent = { at: iso(now), kind: 'complete', text: 'Route complete' }
  return { ...plan, complete: iso(now), events: pushEvents(plan, [ev]) }
}

/**
 * reconcile + slotIn of new keys (from `current`) + slotIn of newly placed keys + completion: the one call the store
 * makes whenever jobs or rows change while a plan is active. rows: the open stop rows with points (listOpenStops with
 * showAll so every step is there). history: finished jobs, so a job that left the open list is done or abandoned
 * rather than 'removed'.
 */
export function updatePlan(
  plan: RoutePlanDoc,
  jobs: OtherJob[],
  rows: RouteRow[],
  current: GeoPoint | null | undefined,
  locations: Location[],
  now: number,
  history: RouteHistoryEntry[] = []
): { plan: RoutePlanDoc; changed: boolean; events: RouteEvent[]; inserted: SlotInserted[] } {
  const r = reconcile(plan, jobs, rows, now, history)
  let p = r.plan
  let changed = r.changed
  const events = r.events.slice()
  const inserted: SlotInserted[] = []
  if (r.newKeys.length) {
    const s = slotIn(p, rows, current, locations, { keys: r.newKeys, now })
    if (s.plan !== p) changed = true
    p = s.plan
    events.push(...s.events)
    inserted.push(...s.inserted)
  }
  if (r.placedKeys.length) {
    const s = slotIn(p, rows, current, locations, { keys: r.placedKeys, now, placed: true })
    if (s.plan !== p) changed = true
    p = s.plan
    events.push(...s.events)
    inserted.push(...s.inserted)
  }
  if (r.newKeys.length || r.placedKeys.length) {
    const c = completeIfDone(p, now)
    if (c !== p) {
      changed = true
      events.push(c.events[c.events.length - 1])
      p = c
    }
  }
  return { plan: p, changed, events, inserted }
}

// ---------------------------------------------------------------- replan suggestion

/** how long a re-plan check stays valid while the order and added count don't change (live reads move `start`) */
export const ROUTE_REPLAN_CHECK_MS = 60_000

const pctCache = new Map<string, { at: number; value: number | null }>()

/**
 * How much longer (%) the remaining planned route is than a fresh plan of the same stops from `start`;
 * null when under ROUTE_REPLAN_PCT or unknown. With `now`: cached on the remaining order and the added count, so a
 * live position read doesn't run a full plan; re-checked when those change or after ROUTE_REPLAN_CHECK_MS.
 * Without `now`: always computed.
 */
export function replanPct(
  plan: RoutePlanDoc,
  rows: RouteRow[],
  start: GeoPoint | null | undefined,
  locations: Location[],
  now?: number
): number | null {
  if (!start || plan.complete) return null
  const byKey = new Map(rows.map((r) => [stopKey(r), r]))
  const grey = new Set(plan.grey.map((g) => g.key))
  const seq = plan.order
    .filter((k) => !grey.has(k))
    .map((k) => byKey.get(k))
    .filter((r): r is RouteRow => !!r && isOpenRow(r) && hasPoint(r))
  if (seq.length < 2) return null
  const sig = `${plan.at}|${plan.added.length}|${seq.map(stopKey).join('|')}`
  if (now != null) {
    const hit = pctCache.get(sig)
    if (hit && now >= hit.at && now - hit.at < ROUTE_REPLAN_CHECK_MS) return hit.value
  }
  const rem = tripCost(seq, start, locations)
  const fresh = planRoute(seq, start, locations)
  let out: number | null = null
  if (!rem.bad && fresh.plannedMeters != null && fresh.plannedMeters > 0) {
    const pct = Math.round(((rem.meters - fresh.plannedMeters) / fresh.plannedMeters) * 100)
    out = pct >= ROUTE_REPLAN_PCT ? pct : null
  }
  if (now != null) {
    if (pctCache.size > 50) pctCache.clear()
    pctCache.set(sig, { at: now, value: out })
  }
  return out
}

// ---------------------------------------------------------------- routeView

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What ROUTE shows. plan null (or opts.preview) = preview: rows in the order given (the live optimised list).
 * Planned: plan.order (grey stops kept in place, no number), then rows not in the plan (no number).
 * Complete: the plan is complete and no open routable row is left; with open rows again it is a preview.
 */
export function routeView(
  plan: RoutePlanDoc | null | undefined,
  rows: OpenStopRow[],
  opts: { now: number; locations: Location[]; start?: GeoPoint | null; startLabel?: string; preview?: boolean }
): RouteView {
  const { now, locations } = opts
  const start = opts.start ?? null
  const routable = (r: OpenStopRow): boolean => isOpenRow(r) && hasPoint(r)
  const anyOpen = rows.some(routable)
  const state: RouteView['state'] =
    !plan || opts.preview ? 'preview' : plan.complete ? (anyOpen ? 'preview' : 'complete') : 'planned'
  const live = state === 'planned' ? plan! : null
  const byKey = new Map(rows.map((r) => [stopKey(r), r]))

  // the list in order
  type Item = { key: string; row: OpenStopRow | null; grey?: RouteGrey }
  let items: Item[]
  if (live) {
    const greyBy = new Map(live.grey.map((g) => [g.key, g]))
    items = []
    const inPlan = new Set<string>()
    for (const k of live.order) {
      const g = greyBy.get(k)
      const row = byKey.get(k) ?? null
      if (!g && !row) continue
      inPlan.add(k)
      items.push({ key: k, row, ...(g ? { grey: g } : {}) })
    }
    for (const r of rows) if (!inPlan.has(stopKey(r))) items.push({ key: stopKey(r), row: r })
  } else items = rows.map((r) => ({ key: stopKey(r), row: r }))

  const planKeys = new Set(live?.order ?? [])
  const tagBy = new Map((live?.tags ?? []).filter((t) => now - Date.parse(t.at) < ROUTE_TAG_MS).map((t) => [t.key, t.tag]))
  const addedBy = new Map((live?.added ?? []).map((a) => [a.key, a]))
  const numberedRows: OpenStopRow[] = []
  const out: ViewRow[] = []
  let prevRow: OpenStopRow | null = null
  let prevVisit = ''
  let prevVisitPlace = ''
  let prevVisitPoint: Pt | undefined
  for (const it of items) {
    const r = it.row
    const numberable = !it.grey && !!r && routable(r) && (!live || planKeys.has(it.key)) && state !== 'complete'
    let why: string
    let visitId = it.key
    if (it.grey) {
      why = `${cap(it.grey.label)} · not counted · cleared by RE-PLAN`
      out.push({ key: it.key, row: r, number: null, grey: { reason: it.grey.reason, at: it.grey.at, label: it.grey.label, ...(it.grey.stop ? { stop: it.grey.stop } : {}) }, why, visitId })
      continue
    }
    if (!r) continue
    if (!hasPoint(r)) why = 'No place yet · fix the tag to route it'
    else if (!numberable) why = isOpenRow(r) ? 'Not in the plan yet' : 'Not counted'
    else {
      const added = addedBy.get(it.key)
      const pickups = pickupIndicesFor(numberedRows, r)
      if (added) {
        why = `Added after planning (${added.jobRef}) · cheapest spot` + (added.addMeters != null ? ` · +${formatDistance(Math.max(0, added.addMeters))}` : '')
      } else if (pickups.length) {
        const p = numberedRows[pickups[pickups.length - 1]]
        why = `After its pickup at ${placeOf(p)} (${r.job.ref})`
      } else {
        const fromPt = prevRow?.point ?? start ?? undefined
        const fromName = prevRow ? placeOf(prevRow) : opts.startLabel || live?.startLabel || 'your position'
        const t = fromPt ? travel(fromPt, r.point, locations) : null
        why = `Closest next stop from ${fromName}` + (t ? ` · ${formatDistance(t.meters)}` : '')
      }
    }
    let number: number | null = null
    if (numberable) {
      numberedRows.push(r)
      number = numberedRows.length
      const place = placeOf(r).trim().toLowerCase()
      if (prevRow && prevVisit && (samePoint(prevVisitPoint, r.point) || (place && place === prevVisitPlace))) visitId = prevVisit
      prevVisit = visitId
      prevVisitPlace = place
      prevVisitPoint = r.point
      prevRow = r
    } else {
      // an unnumbered (non-grey) row ends the visit
      prevVisit = ''
    }
    const tag = tagBy.get(it.key)
    out.push({ key: it.key, row: r, number, ...(tag ? { tag } : {}), why, visitId })
  }

  const unroutable = rows.filter((r) => isOpenRow(r) && !hasPoint(r)).length
  const remaining = numberedRows.length ? tripCost(numberedRows, start, locations) : null
  const remainingMeters = remaining && start ? costMeters(remaining) : null
  const pct = live && live.added.length ? replanPct(live, rows, start, locations, now) : null
  const notes = (plan?.events ?? []).filter((e) => {
    const age = now - Date.parse(e.at)
    return age >= 0 && age < ROUTE_NOTE_MS
  })
  const addedMetersList = (live?.added ?? []).map((a) => a.addMeters)
  const addedMeters = addedMetersList.some((m) => m == null) ? null : addedMetersList.reduce<number>((s, m) => s + (m ?? 0), 0)
  const status: RouteStatus = {
    state,
    plannedAt: live?.at ?? null,
    plannedClock: live ? clockOf(live.at) : '',
    stops: live ? Math.max(0, live.stops - live.grey.length) : numberedRows.length,
    left: numberedRows.length,
    meters: live ? live.plannedMeters : remainingMeters,
    saved: live && live.nearestMeters != null && live.plannedMeters != null && live.nearestMeters - live.plannedMeters > 0.5
      ? live.nearestMeters - live.plannedMeters
      : null,
    remainingMeters,
    addedCount: live?.added.length ?? 0,
    addedMeters: live?.added.length ? addedMeters : null,
    droppedCount: live?.grey.length ?? 0,
    unroutable,
    replanPct: pct,
    text: '',
    short: ''
  }
  if (state === 'preview') {
    status.text = "Not planned (preview) · press PLAN ROUTE when you're ready to fly"
    status.short = 'ROUTE · not planned'
  } else if (state === 'complete') {
    status.text = 'Route complete'
    status.short = 'Route complete'
  } else {
    status.text =
      `\u{1F512} Route planned ${status.plannedClock} · ${plural(status.stops, 'stop', 'stops')}` +
      (status.meters != null ? ` · ${formatDistance(status.meters)}` : '') +
      (status.saved != null ? ` · saves ${formatDistance(status.saved)}` : '') +
      (status.addedCount
        ? ` · +${plural(status.addedCount, 'stop', 'stops')} added` + (status.addedMeters != null ? ` (+${formatDistance(Math.max(0, status.addedMeters))})` : '')
        : '') +
      (pct != null ? ` · Added stops made the route ${pct}% longer than a fresh plan · RE-PLAN?` : '')
    status.short = `\u{1F512} ROUTE · ${status.left} of ${status.stops} left`
  }
  return { state, rows: out, status, notes, replanPct: pct, unroutable }
}

/** the visits of a view in order: consecutive rows sharing a visitId (grey and unnumbered rows are their own) */
export function routeVisits(view: RouteView): { visitId: string; rows: ViewRow[] }[] {
  const out: { visitId: string; rows: ViewRow[] }[] = []
  for (const r of view.rows) {
    const last = out[out.length - 1]
    if (last && last.visitId === r.visitId) last.rows.push(r)
    else out.push({ visitId: r.visitId, rows: [r] })
  }
  return out
}

/** "Seraphim Station · pick up 2 · drop off 1" for a visit's open rows */
export function visitLabel(rows: ViewRow[]): string {
  const open = rows.filter((r) => r.row && r.number != null)
  if (!open.length) return rows[0]?.row ? placeOf(rows[0].row) : ''
  const ups = open.filter((r) => isPickupStep(r.row!.step)).length
  const downs = open.length - ups
  return [placeOf(open[0].row!), ...(ups ? [`pick up ${ups}`] : []), ...(downs ? [`drop off ${downs}`] : [])].join(' · ')
}
