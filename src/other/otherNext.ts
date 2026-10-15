/**
 * Other-mode Next sort and distances.
 * Every name/place lookup goes through otherResolve (resolveStartText / resolveStopPlace / nearestPlace).
 * Does not call planRoute / packer / hold.
 */
import type { Location } from '@shared/types'
import type { ListOrder, OtherJob, OtherStep } from '@other/otherJob'
import { compareTravel, formatShortDistance, travel, type GeoPoint, type Travel } from './otherGeo'
import { whereAccuracy, type Where, type WhereSource } from './otherWhere'
import { NEAR_MAX_M, resolveStartText, resolveStopPlace, type ResolveCtx, type StopPlace } from './otherResolve'
import type { MemoryEntry } from './otherMemory'

/** match memory lookup (memoryKey -> entry); otherMemoryStore's useMemoryLookup / memoryLookup */
export type MemoryLookup = (key: string) => MemoryEntry | undefined

export type { ListOrder }

function titleChip(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  if (s === s.toLowerCase()) return s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

/** Display-only: Name · Body [planet] · System [system]. Stored location stays the UEX name. */
export function formatPlaceWithBodySystem(name: string, locations: Location[], memory?: MemoryLookup): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  const hit = startPlace(trimmed, locations, memory).match
  const parts = [trimmed]
  const body = hit?.body?.trim()
  const system = hit?.system?.trim()
  if (body) parts.push(`Body [${titleChip(body)}]`)
  if (system) parts.push(`System [${titleChip(system)}]`)
  return parts.join(' \u00b7 ')
}

function placeTravelKey(step: OtherStep): string {
  return (stepActivePlace(step) || step.label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** First later open stop whose place name differs from the current stop. Withdrawn steps are skipped. */
export function findNextTravelStop<T extends { step: OtherStep }>(open: T[], fromIdx: number): T | undefined {
  const cur = open[fromIdx]
  if (!cur) return undefined
  const key = placeTravelKey(cur.step)
  if (!key) return open.slice(fromIdx + 1).find((r) => !r.step.withdrawn)
  for (let i = fromIdx + 1; i < open.length; i++) {
    if (open[i].step.withdrawn) continue
    const next = placeTravelKey(open[i].step)
    if (next && next !== key) return open[i]
  }
  return undefined
}

/** a roster place as a travel point (system/body carried); undefined without coords */
export function locationPoint(l?: Location): GeoPoint | undefined {
  if (!l || l.x == null || l.y == null || l.z == null) return undefined
  return { x: l.x, y: l.y, z: l.z, system: l.system ?? null, body: l.body ?? null }
}

/** a typed / named place (start, where-name) through the one resolver; no marker, no step */
function startPlace(text: string, locations: Location[], memory?: MemoryLookup): StopPlace {
  return resolveStartText(text, { locations, useMarker: false, ...(memory ? { memory } : {}) })
}

/** where a typed / named start is: the resolver's roster point, or undefined */
const startPoint = (text: string, locations: Location[], memory?: MemoryLookup): GeoPoint | undefined =>
  text.trim() ? startPlace(text, locations, memory).point : undefined

type Pos = { x?: number; y?: number; z?: number }

const hasCoords = (p?: Pos): boolean => !!p && p.x != null && p.y != null && p.z != null

/** resolves a step's active place; listOpenStops passes a cached one (one resolveStopPlace per step per run) */
type StepResolver = (step: OtherStep, job: OtherJob) => StopPlace

const resolverFor = (ctx: ResolveCtx): StepResolver => {
  const cache = new Map<OtherStep, StopPlace>()
  return (step, job) => {
    let m = cache.get(step)
    if (!m) {
      m = resolveStopPlace(step, ctx, job)
      cache.set(step, m)
    }
    return m
  }
}

/** where a step is: the resolver's point (roster coords, or the game marker); `job` lets a generic site find the contract's place */
function stepPoint(step: OtherStep, locations: Location[], useMarker: boolean, job?: OtherJob, memory?: MemoryLookup): GeoPoint | undefined {
  return resolveStopPlace(step, { locations, useMarker, ...(memory ? { memory } : {}) }, job).point
}

/** StopPlace.source as the row's distanceSource */
const sourceOf = (m: StopPlace): 'uex' | 'marker' | null => (m.source === 'roster' ? 'uex' : m.source)

/** travel from start to a step's place (resolveStopPlace; pass the step's job so a generic site finds its place) */
export function stepTravelFromStart(
  startName: string,
  step: OtherStep,
  locations: Location[],
  useMarker = true,
  job?: OtherJob,
  memory?: MemoryLookup
): Travel | null {
  return travel(startPoint(startName, locations, memory), stepPoint(step, locations, useMarker, job, memory), locations)
}

/** distanceFromStart for a step: falls back to its marker position when the place has no UEX coords */
export function stepDistanceFromStart(
  startName: string,
  step: OtherStep,
  locations: Location[],
  useMarker = true,
  job?: OtherJob,
  memory?: MemoryLookup
): number | null {
  return stepTravelFromStart(startName, step, locations, useMarker, job, memory)?.meters ?? null
}

type JobStep = { job: OtherJob; step: OtherStep | undefined }

function compareStepsFrom(start: GeoPoint | undefined, locations: Location[], a: JobStep, b: JobStep, resolve: StepResolver): number {
  if (!start) return 0
  const ta = a.step ? travel(start, resolve(a.step, a.job).point, locations) : null
  const tb = b.step ? travel(start, resolve(b.step, b.job).point, locations) : null
  return compareTravel(ta, tb)
}

/** UEX x/y/z are starmap meters. Large ranges: "38 Gm 302 Mm". */
export function formatMapDistance(meters: number | null): string {
  if (meters == null) return '\u2014'
  const km = meters / 1000
  const Mm = km / 1000
  if (Mm >= 1000) {
    const gm = Math.floor(Mm / 1000)
    const mm = Math.round(Mm % 1000)
    return mm === 0 ? `${gm} Gm` : `${gm} Gm ${mm} Mm`
  }
  if (Mm >= 1) return `${Mm >= 10 ? Mm.toFixed(0) : Mm.toFixed(1)} Mm`
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${Math.round(meters)} m`
}

/** Short form for play: "830 km", "4.7 Mm", "57.9 Gm"; under 1 km in metres. */
export function formatDistance(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return '\u2014'
  return formatShortDistance(m)
}

export interface OpenStopRow {
  job: OtherJob
  step: OtherStep
  /** metres from start to this row's place (gateway route across systems); null when unknown or no start */
  distance: number | null
  /** jump-point crossings from start to this place; set when distance is */
  jumps?: number
  /** distance measured over the surface of the body both sit on */
  surface?: boolean
  /** metres from the previous row's place in this order (start for the first row); null if unknown */
  leg: number | null
  /** jump-point crossings on the leg; set when leg is */
  legJumps?: number
  /** leg measured over a body's surface */
  legSurface?: boolean
  /** where the place's position came from: UEX roster coords, or the step's marker position */
  distanceSource: 'uex' | 'marker' | null
  /** a start is set but this row's distance can't be computed */
  noDistance: boolean
  /** where you go next for this step (stepActivePlace) */
  place: string
  /** place is an uncollected pickup */
  pickup: boolean
  /** the step's delivery / location */
  dest: string
  /** why distance/leg is missing: place has no coords, no origin to measure from, or no gateway joins the systems */
  noDistanceWhy: 'not-in-uex' | 'no-start' | 'no-gateway' | null
  /** place position used for distance/leg (UEX coords or marker); absent when unknown */
  point?: GeoPoint
  /** marker-based point only: nearest roster place within 25 km of it (match.near) */
  near?: PlaceNear
  /** the stop place resolver's answer for this row's active place (status, confidence, evidence) */
  match: StopPlace
}

export interface PlaceNear {
  name: string
  meters: number
}

/** how far a marker point may be from a roster place to be called "near" it (defined in otherResolve) */
export { NEAR_MAX_M }

/** "<place, body, system> · near <name> (<dist>)"; the plain place line when there is no near place */
export function formatPlaceNear(place: string, near: PlaceNear | undefined, locations: Location[], memory?: MemoryLookup): string {
  const base = formatPlaceWithBodySystem(place, locations, memory)
  if (!near) return base
  return `${base} \u00b7 near ${near.name} (${formatDistance(near.meters)})`
}

/** true while the step's next place is a pickup not yet collected */
export function stepIsPickup(step: OtherStep): boolean {
  return !!step.pickupLocation && !step.pickedUp && !step.done
}

/** the step's delivery / location (not the pickup) */
export function stepDest(step: OtherStep): string {
  return step.location || step.label || ''
}

const STALE_MS = 5 * 60 * 1000

const timeOf = (iso?: string | number | null): number =>
  typeof iso === 'number' ? iso : iso ? Date.parse(iso) : NaN

export interface ResolvedOrigin {
  /** roster / typed name to measure from; null for open space or nothing set */
  name: string | null
  /** what the UI shows */
  label: string | null
  /** position to measure from (pass as listOpenStops opts.origin) */
  point?: GeoPoint
  kind: WhereSource | null
  /** a location clue (not typed) older than 5 min */
  stale: boolean
  /** position accuracy 0-10 now (whereAccuracy, fades with age); null for typed or nothing set */
  accuracy: number | null
  /** the resolver's answer for the typed / where name (resolveStartText); absent when there is no name */
  match?: StopPlace
}

/**
 * Origin for distances. fixed: the typed start only. auto: the newer of the typed start (typedAt)
 * and the latest location clue (where.at); a typed start with no time loses to a clue.
 */
export function resolveOrigin(o: {
  typed?: string
  typedAt?: string
  where?: Where | null
  mode: 'auto' | 'fixed'
  now?: number
  locations: Location[]
  /** match memory (user-set / learned places) for the typed / where name */
  memory?: MemoryLookup
}): ResolvedOrigin {
  const none: ResolvedOrigin = { name: null, label: null, kind: null, stale: false, accuracy: null }
  const typed = o.typed?.trim()
  const fromTyped = (): ResolvedOrigin => {
    const match = startPlace(typed!, o.locations, o.memory)
    const point = match.point
    return { name: typed!, label: typed!, ...(point ? { point } : {}), kind: 'typed', stale: false, accuracy: null, match }
  }
  if (o.mode === 'fixed') return typed ? fromTyped() : none
  const w = o.where
  const wName = w?.name?.trim() || null
  const wUsable = !!w && (!!wName || !!w.point)
  if (!wUsable) return typed ? fromTyped() : none
  if (typed) {
    const tt = timeOf(o.typedAt)
    const wt = timeOf(w.at)
    if (Number.isFinite(tt) && (!Number.isFinite(wt) || tt >= wt)) return fromTyped()
  }
  const match = wName ? startPlace(wName, o.locations, o.memory) : undefined
  const point = w.point ?? match?.point
  const at = timeOf(w.at)
  const now = o.now ?? Date.now()
  return {
    name: wName,
    label: w.label?.trim() || wName,
    ...(point ? { point } : {}),
    kind: w.source,
    stale: w.source !== 'typed' && Number.isFinite(at) && now - at > STALE_MS,
    accuracy: w.source === 'typed' ? null : whereAccuracy(w, now),
    ...(match ? { match } : {})
  }
}

export interface StopGroup {
  place: string
  pickup: boolean
  rows: OpenStopRow[]
  distance: number | null
  jumps?: number
  surface?: boolean
  leg: number | null
  legJumps?: number
  legSurface?: boolean
  distanceSource: 'uex' | 'marker' | null
  noDistanceWhy: OpenStopRow['noDistanceWhy']
  /** the first row's near place (marker-based points only) */
  near?: PlaceNear
  /** the first row's resolved place */
  match: StopPlace
}

const groupKey = (p: string): string => p.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Rows with the same place become one stop at the position of their first row; legs recomputed between stops.
 * A delivery is never merged into a same-place stop above its own open pickup (it starts / joins a later stop).
 * Pass the roster so cross-system legs (gateways) and surface legs (body centre) can be measured.
 */
export function groupByPlace(rows: OpenStopRow[], locations: Location[] = []): StopGroup[] {
  const groups: StopGroup[] = []
  const byKey = new Map<string, StopGroup>()
  const groupOfRow: StopGroup[] = []
  rows.forEach((r, at) => {
    const key = groupKey(r.place)
    let g = key ? byKey.get(key) : undefined
    // a delivery never joins a same-place group listed above its own open pickup: it starts a group after it
    if (g) {
      const gi = groups.indexOf(g)
      if (pickupIndicesFor(rows, r).some((pi) => pi < at && groups.indexOf(groupOfRow[pi]) > gi)) g = undefined
    }
    if (!g) {
      g = {
        place: r.place,
        pickup: false,
        rows: [],
        distance: r.distance,
        ...(r.jumps != null ? { jumps: r.jumps } : {}),
        ...(r.surface ? { surface: true } : {}),
        leg: null,
        distanceSource: r.distanceSource,
        noDistanceWhy: r.noDistanceWhy,
        ...(r.near ? { near: r.near } : {}),
        match: r.match
      }
      groups.push(g)
      if (key) byKey.set(key, g)
    }
    g.rows.push(r)
    g.pickup = g.pickup || r.pickup
    groupOfRow.push(g)
  })
  groups.forEach((g, i) => {
    const first = g.rows[0]
    const setLeg = (leg: number | null, jumps?: number, surface?: boolean): void => {
      g.leg = leg
      if (leg != null) {
        g.legJumps = jumps ?? 0
        if (surface) g.legSurface = true
      }
    }
    if (i === 0) {
      setLeg(first.distance, first.jumps, first.surface)
    } else {
      const prev = groups[i - 1].rows[0]
      const t = travel(prev.point, first.point, locations)
      if (t) setLeg(t.meters, t.jumps, t.surface)
      else {
        // not measurable here: the original leg is right only when the row before it was in the previous stop
        const at = rows.indexOf(first)
        if (at > 0 && groupOfRow[at - 1] === groups[i - 1]) setLeg(first.leg, first.legJumps, first.legSurface)
        else setLeg(null)
      }
    }
    g.noDistanceWhy =
      first.noDistanceWhy === 'not-in-uex' || first.noDistanceWhy === 'no-gateway'
        ? first.noDistanceWhy
        : g.distance == null && g.leg == null
          ? 'no-start'
          : null
  })
  return groups
}

/**
 * Stops left from fromIndex (inclusive), the sum of their legs (the leg into fromIndex included; null when any
 * is unknown) and the jumps on those legs.
 */
export function remainingRoute(
  groups: StopGroup[],
  fromIndex: number
): { stops: number; distance: number | null; jumps: number } {
  const from = Math.max(0, fromIndex)
  const stops = Math.max(0, groups.length - from)
  let distance: number | null = 0
  let jumps = 0
  for (let i = from; i < groups.length; i++) {
    const leg = groups[i].leg
    if (leg == null) {
      distance = null
      break
    }
    distance += leg
    jumps += groups[i].legJumps ?? 0
  }
  return { stops, distance, jumps }
}

/** Place the list should sort / show for this step's current phase. */
export function stepActivePlace(step: OtherStep): string {
  if (stepIsPickup(step)) return step.pickupLocation!
  return stepDest(step)
}

export function stepActionLabel(step: OtherStep): string {
  if (step.done) return 'UNDO'
  if (step.pickupLocation && !step.pickedUp) return 'GO HERE'
  return step.kind === 'turnin' ? 'TURN IN' : 'GO HERE'
}

export type ListOpenStopsOpts = {
  /** Off = one unfinished step per job (stock). */
  showAll?: boolean
  /** Only used when showAll. Default true. */
  hideCompleted?: boolean
  listOrder?: ListOrder
  jobOrder?: string[]
  /** settings.otherWithdrawnSteps: grey = listed (showAll), hide = left out. Default grey. */
  withdrawnSteps?: 'grey' | 'hide'
  /** settings.otherMarkerDistance: sort steps with no UEX place by their marker position. Default true. */
  markerDistance?: boolean
  /** measure from this point (resolveOrigin().point) instead of looking up startLocation */
  origin?: GeoPoint
  /** origin came from a read (resolveOrigin kind not 'typed'): it counts as "you are here" evidence for stop places */
  originIsRead?: boolean
  /** match memory (user-set / learned places) passed to the stop-place resolver */
  memory?: MemoryLookup
  /** settings.otherRouteOptimize: ROUTE = nearest-next improved by local search. Default false (nearest-next only). */
  routeOptimize?: boolean
  /** stopKey of the stop the previous plan put first (route + routeOptimize only); kept first unless 20% shorter without it */
  routePin?: string
}

/** a stop's identity across runs: `${job.id}:${step.id}` */
export function stopKey(row: { job: { id: string }; step: { id: string } }): string {
  return `${row.job.id}:${row.step.id}`
}

/** what the optimised ROUTE did (listOpenStopsWithRoute; null unless listOrder 'route' with routeOptimize on and a start) */
export interface RouteInfo {
  optimised: boolean
  /** nearest-next trip over the routed stops: metres (null when a leg can't be measured) and jumps */
  nearestMeters: number | null
  nearestJumps: number
  /** the trip shown */
  optimisedMeters: number | null
  optimisedJumps: number
  /** routePin: kept first, dropped (a plan without it is >= 20% shorter or has fewer jumps), or no usable pin */
  pin: 'kept' | 'dropped' | 'none'
  /** stops routed (rows with a known point) */
  stops: number
}

const itemKey = (s: { item?: string }): string => (s.item ?? '').trim().toLowerCase()

/** an open plain pickup (not a combined "collect from A, deliver to B" step) */
const isOpenPickup = (s: OtherStep): boolean =>
  s.kind === 'pickup' && !s.pickupLocation && !s.done && !s.withdrawn && !!itemKey(s)

/** an open delivery / turn-in that needs an item first */
const isOpenDelivery = (s: OtherStep): boolean =>
  s.kind !== 'pickup' && !s.pickupLocation && !s.done && !s.withdrawn && !!itemKey(s)

/**
 * The job's steps in the order to do them: game order, except an open pickup moves before the first open
 * delivery of the same item (case-insensitive). Steps with no item, and combined pickupLocation steps, keep their place.
 */
export function stepWorkOrder(steps: OtherStep[]): OtherStep[] {
  const out = steps.slice()
  for (const p of steps) {
    if (!isOpenPickup(p)) continue
    const at = out.indexOf(p)
    const key = itemKey(p)
    const before = out.findIndex((d, i) => i < at && isOpenDelivery(d) && itemKey(d) === key)
    if (before < 0) continue
    out.splice(at, 1)
    out.splice(before, 0, p)
  }
  return out
}

/** first open step that the game has not withdrawn (pickups before same-item deliveries); withdrawn steps are never "next" */
export function nextLiveStep(job: OtherJob): OtherStep | null {
  if (job.status !== 'active') return null
  return stepWorkOrder(job.steps).find((s) => !s.done && !s.withdrawn) ?? null
}

export function sortJobsByManualOrder(jobs: OtherJob[], jobOrder: string[]): OtherJob[] {
  const idx = new Map(jobOrder.map((id, i) => [id, i]))
  return [...jobs].sort((a, b) => {
    const ia = idx.has(a.id) ? idx.get(a.id)! : jobOrder.length + jobs.indexOf(a)
    const ib = idx.has(b.id) ? idx.get(b.id)! : jobOrder.length + jobs.indexOf(b)
    return ia - ib
  })
}

function visibleSteps(job: OtherJob, hideCompleted: boolean, hideWithdrawn = false): OtherStep[] {
  return stepWorkOrder(job.steps).filter((s) => !(hideCompleted && s.done) && !(hideWithdrawn && s.withdrawn))
}

/** first step to sort a job by: a live one, else whatever is visible */
function sortStep(job: OtherJob, hideCompleted: boolean, hideWithdrawn: boolean): OtherStep | undefined {
  const vis = visibleSteps(job, hideCompleted, hideWithdrawn)
  return vis.find((s) => !s.done && !s.withdrawn) ?? vis[0]
}

function sortJobsByFirstStep(
  jobs: OtherJob[],
  start: GeoPoint | undefined,
  locations: Location[],
  hideCompleted: boolean,
  hideWithdrawn: boolean,
  resolve: StepResolver
): OtherJob[] {
  if (!start) return jobs
  return [...jobs].sort((a, b) =>
    compareStepsFrom(
      start,
      locations,
      { job: a, step: sortStep(a, hideCompleted, hideWithdrawn) },
      { job: b, step: sortStep(b, hideCompleted, hideWithdrawn) },
      resolve
    )
  )
}

type BaseRow = { job: OtherJob; step: OtherStep }

type Placed = BaseRow & {
  match: StopPlace
  point?: GeoPoint
  source: 'uex' | 'marker' | null
  travel: Travel | null
  distance: number | null
  distanceSource: 'uex' | 'marker' | null
}

/** a delivery whose same-item pickup (same job) is still to be routed */
const waitsForPickup = <T extends { job: { id: string }; step: OtherStep }>(r: T, left: T[]): boolean =>
  isOpenDelivery(r.step) &&
  left.some((o) => o !== r && o.job.id === r.job.id && isOpenPickup(o.step) && itemKey(o.step) === itemKey(r.step))

/** greedy nearest-neighbour (fewest jumps, then shortest) from start over rows with a known point; ties keep input order */
function routeOrder<T extends { job: { id: string }; step: OtherStep; point?: GeoPoint }>(
  rows: T[],
  start: GeoPoint,
  locations: Location[]
): T[] {
  const left = rows.slice()
  const out: T[] = []
  let cur = start
  while (left.length) {
    // default: first row not waiting on its pickup
    let best = Math.max(0, left.findIndex((r) => !waitsForPickup(r, left)))
    let bestT: Travel | null = null
    for (let i = 0; i < left.length; i++) {
      if (waitsForPickup(left[i], left)) continue
      const t = travel(cur, left[i].point, locations)
      if (t && compareTravel(t, bestT) < 0) {
        bestT = t
        best = i
      }
    }
    const [next] = left.splice(best, 1)
    out.push(next)
    cur = next.point!
  }
  return out
}

type Keyed = { job: { id: string }; step: OtherStep }

/** every open same-job same-item pickup a row's delivery needs, among rows (indices, list order); [] when none */
function pickupIndicesFor<T extends Keyed>(rows: T[], r: T): number[] {
  if (!isOpenDelivery(r.step)) return []
  const key = itemKey(r.step)
  const out: number[] = []
  rows.forEach((o, i) => {
    if (o !== r && o.job.id === r.job.id && isOpenPickup(o.step) && itemKey(o.step) === key) out.push(i)
  })
  return out
}

/**
 * FROM START: an open delivery whose same-job, same-item pickups are still open (and listed) goes directly after the
 * last of them (several such deliveries keep their order); every other row keeps its place.
 */
export function pickupsBeforeDeliveries<T extends Keyed>(rows: T[]): T[] {
  return placeAfterPickups(rows, () => true)
}

/** pickupsBeforeDeliveries for the rows `movable` accepts only */
function placeAfterPickups<T extends Keyed>(rows: T[], movable: (r: T) => boolean): T[] {
  const after = new Map<T, T[]>()
  const moved = new Set<T>()
  for (const r of rows) {
    const at = pickupIndicesFor(rows, r)
    if (!at.length || !movable(r)) continue
    const p = rows[at[at.length - 1]]
    if (!after.has(p)) after.set(p, [])
    after.get(p)!.push(r)
    moved.add(r)
  }
  if (!moved.size) return rows
  const out: T[] = []
  for (const r of rows) {
    if (moved.has(r)) continue
    out.push(r)
    for (const d of after.get(r) ?? []) out.push(d)
  }
  return out
}

/** a trip's cost: unmeasurable legs, then jumps, then metres (compareTravel's order) */
type Cost = { bad: number; jumps: number; meters: number }

const costLess = (a: Cost, b: Cost): boolean =>
  a.bad !== b.bad ? a.bad < b.bad : a.jumps !== b.jumps ? a.jumps < b.jumps : a.meters < b.meters - 1e-6

const samePoint = (a?: GeoPoint, b?: GeoPoint): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && (a.system ?? null) === (b.system ?? null) &&
  (a.body ?? null) === (b.body ?? null)

/** total travel of start -> rows in order (rows need a point): metres null when any leg can't be measured */
export function routeTravel(
  rows: { point?: GeoPoint }[],
  start: GeoPoint,
  locations: Location[]
): { meters: number | null; jumps: number; bad: number } {
  let meters: number | null = 0
  let jumps = 0
  let bad = 0
  let cur: GeoPoint | undefined = start
  for (const r of rows) {
    const t = travel(cur, r.point, locations)
    if (!t) {
      meters = null
      bad++
    } else {
      if (meters != null) meters += t.meters
      jumps += t.jumps
    }
    cur = r.point
  }
  return { meters, jumps, bad }
}

const MAX_PASSES = 60

/**
 * Local search on a route (rows with points, e.g. the nearest-next order): move one stop elsewhere (or-opt) or
 * reverse a stretch (2-opt), keeping a change only when the whole trip gets strictly better (fewer jumps, then fewer
 * metres). A delivery never goes before its same-job same-item open pickup. Consecutive rows at the same point move
 * as one block. Deterministic; at most MAX_PASSES improving moves. fixedFirst keeps the first block first (a pin).
 */
export function improveRoute<T extends Keyed & { point?: GeoPoint }>(
  rows: T[],
  start: GeoPoint,
  locations: Location[],
  opts?: { fixedFirst?: boolean; maxPasses?: number }
): T[] {
  // blocks: runs of the same point
  const blocks: T[][] = []
  for (const r of rows) {
    const last = blocks[blocks.length - 1]
    if (last && samePoint(last[0].point, r.point)) last.push(r)
    else blocks.push([r])
  }
  const n = blocks.length
  if (n < 2) return rows.slice()
  // precedence: block b needs every block in needs[b] earlier
  const blockOf = new Map<T, number>()
  blocks.forEach((b, i) => b.forEach((r) => blockOf.set(r, i)))
  const needs: number[][] = blocks.map(() => [])
  for (const r of rows) {
    const db = blockOf.get(r)!
    for (const at of pickupIndicesFor(rows, r)) {
      const pb = blockOf.get(rows[at])!
      if (pb !== db && !needs[db].includes(pb)) needs[db].push(pb)
    }
  }
  // leg matrix: index n = start
  const pts = blocks.map((b) => b[0].point)
  const legs: (Travel | null)[][] = []
  for (let a = 0; a <= n; a++) {
    legs.push([])
    const from = a === n ? start : pts[a]
    for (let b = 0; b < n; b++) legs[a].push(a === b ? null : travel(from, pts[b], locations))
  }
  const cost = (order: number[]): Cost => {
    const c: Cost = { bad: 0, jumps: 0, meters: 0 }
    let prev = n
    for (const b of order) {
      const t = legs[prev][b]
      if (!t) c.bad++
      else {
        c.jumps += t.jumps
        c.meters += t.meters
      }
      prev = b
    }
    return c
  }
  const pos = new Array<number>(n)
  const valid = (order: number[]): boolean => {
    order.forEach((b, i) => (pos[b] = i))
    for (let b = 0; b < n; b++) for (const p of needs[b]) if (pos[p] > pos[b]) return false
    return true
  }
  let order = blocks.map((_, i) => i)
  let best = cost(order)
  const lo = opts?.fixedFirst ? 1 : 0
  const maxPasses = opts?.maxPasses ?? MAX_PASSES
  for (let pass = 0; pass < maxPasses; pass++) {
    let found: number[] | null = null
    let foundCost = best
    const consider = (cand: number[]): void => {
      const c = cost(cand)
      if (costLess(c, foundCost) && valid(cand)) {
        found = cand
        foundCost = c
      }
    }
    // or-opt: move block at i to slot j
    for (let i = lo; i < n; i++) {
      for (let j = lo; j < n; j++) {
        if (j === i) continue
        const cand = order.slice()
        const [b] = cand.splice(i, 1)
        cand.splice(j, 0, b)
        consider(cand)
      }
    }
    // 2-opt: reverse order[i..j]
    for (let i = lo; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]
        consider(cand)
      }
    }
    if (!found) break
    order = found
    best = foundCost
  }
  return order.flatMap((b) => blocks[b])
}

/**
 * Above this many routed stops the improvement step is skipped (nearest-next only, RouteInfo.optimised false): the
 * search is O(n^3) per pass and ~40 stops is the size it is tuned for (well under 100 ms).
 */
export const ROUTE_OPT_MAX_STOPS = 50

/** best plan = nearest-next then improveRoute; the pin (stopKey) first when it is open, placeable, and worth keeping */
export function optimiseRoute<T extends Keyed & { point?: GeoPoint }>(
  rows: T[],
  start: GeoPoint,
  locations: Location[],
  pin?: string
): { rows: T[]; info: RouteInfo } {
  const greedy = routeOrder(rows, start, locations)
  const nearest = routeTravel(greedy, start, locations)
  if (rows.length > ROUTE_OPT_MAX_STOPS) {
    return {
      rows: greedy,
      info: {
        optimised: false,
        nearestMeters: nearest.meters,
        nearestJumps: nearest.jumps,
        optimisedMeters: nearest.meters,
        optimisedJumps: nearest.jumps,
        pin: 'none',
        stops: rows.length
      }
    }
  }
  const free = improveRoute(greedy, start, locations)
  let chosen = free
  let pinState: RouteInfo['pin'] = 'none'
  const pinned = pin ? rows.find((r) => stopKey(r) === pin && r.point) : undefined
  if (pinned && !pickupIndicesFor(rows, pinned).length) {
    if (stopKey(free[0]) === pin) pinState = 'kept'
    else {
      const rest = rows.filter((r) => r !== pinned)
      const tail = routeOrder(rest, pinned.point!, locations)
      const withPin = improveRoute([pinned, ...tail], start, locations, { fixedFirst: true })
      const a = routeTravel(withPin, start, locations)
      const b = routeTravel(free, start, locations)
      // metres unknown on either side: fewer unmeasurable legs wins, then fewer jumps; else jumps, then the 20% rule
      const drop =
        a.meters == null || b.meters == null
          ? b.bad !== a.bad
            ? b.bad < a.bad
            : b.jumps < a.jumps
          : b.jumps < a.jumps || (b.jumps === a.jumps && b.meters <= 0.8 * a.meters)
      pinState = drop ? 'dropped' : 'kept'
      chosen = drop ? free : withPin
    }
  }
  const opt = routeTravel(chosen, start, locations)
  return {
    rows: chosen,
    info: {
      optimised: true,
      nearestMeters: nearest.meters,
      nearestJumps: nearest.jumps,
      optimisedMeters: opt.meters,
      optimisedJumps: opt.jumps,
      pin: pinState,
      stops: rows.length
    }
  }
}

/** Same list Next and overlay walk. */
export function listOpenStops(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  opts?: ListOpenStopsOpts
): OpenStopRow[] {
  return listOpenStopsWithRoute(jobs, startLocation, locations, opts).rows
}

/** listOpenStops plus what the optimised ROUTE did (route null unless listOrder 'route', routeOptimize on, and a start) */
export function listOpenStopsWithRoute(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  opts?: ListOpenStopsOpts
): { rows: OpenStopRow[]; route: RouteInfo | null } {
  const listOrder: ListOrder = opts?.listOrder ?? 'distance'
  const useMarker = opts?.markerDistance !== false
  const origin = opts?.origin && hasCoords(opts.origin) ? opts.origin : undefined
  const hasStart = !!origin || !!startLocation.trim()
  const start: GeoPoint | undefined = origin ?? startPoint(startLocation, locations, opts?.memory)

  // one resolve per step for this run; a read origin is "you are here" evidence
  const resolve = resolverFor({
    locations,
    useMarker,
    ...(origin && opts?.originIsRead ? { here: origin } : {}),
    ...(opts?.memory ? { memory: opts.memory } : {})
  })
  // route chains from the log order, not the distance sort
  const base = baseOpenStops(jobs, start, locations, opts, listOrder === 'route' ? 'manual-free' : listOrder, resolve)
  const placed: Placed[] = base.map((r) => {
    const match = resolve(r.step, r.job)
    const point = match.point
    const source = point ? sourceOf(match) : null
    const t = point && start ? travel(start, point, locations) : null
    return {
      ...r,
      match,
      point,
      source,
      travel: t,
      distance: t?.meters ?? null,
      distanceSource: t ? source : null
    }
  })

  let ordered: Placed[] = placed
  let route: RouteInfo | null = null
  if (hasStart && listOrder !== 'manual') {
    const known = placed.filter((r) => r.travel != null)
    const unknown = placed.filter((r) => r.travel == null)
    // distance: baseOpenStops already sorted by compareTravel (jumps, then metres)
    let routed: Placed[] = known
    let bottom: Placed[] = unknown
    if (listOrder === 'route' && start) {
      if (opts?.routeOptimize) {
        // a delivery whose open pickup has no point is not routed: it goes right after that pickup at the bottom
        const held = new Set(known.filter((r) => pickupIndicesFor(placed, r).some((i) => placed[i].travel == null)))
        if (held.size) bottom = placeAfterPickups([...unknown, ...held], (r) => held.has(r))
        const plan = optimiseRoute(known.filter((r) => !held.has(r)), start, locations, opts.routePin)
        routed = plan.rows
        route = plan.info
      } else routed = routeOrder(known, start, locations)
    }
    ordered = [...routed, ...bottom]
  }
  // FROM START (with a start; no start = log order as before): a delivery never above its own open pickup
  if (listOrder === 'distance' && hasStart) ordered = pickupsBeforeDeliveries(ordered)

  let prev: GeoPoint | undefined = start
  const rows = ordered.map((r): OpenStopRow => {
    const legT = prev && r.point ? travel(prev, r.point, locations) : null
    const hadPrev = !!prev
    prev = r.point
    const leg = legT?.meters ?? null
    const near = r.match.near
    const noDistanceWhy: OpenStopRow['noDistanceWhy'] = !r.point
      ? 'not-in-uex'
      : start && !r.travel
        ? 'no-gateway'
        : !start && leg == null
          ? hadPrev
            ? 'no-gateway'
            : 'no-start'
          : null
    return {
      job: r.job,
      step: r.step,
      distance: r.distance,
      ...(r.travel ? { jumps: r.travel.jumps, ...(r.travel.surface ? { surface: true } : {}) } : {}),
      leg,
      ...(legT ? { legJumps: legT.jumps, ...(legT.surface ? { legSurface: true } : {}) } : {}),
      distanceSource: r.distanceSource ?? (leg != null ? r.source ?? null : null),
      noDistance: hasStart && r.distance == null,
      place: stepActivePlace(r.step),
      pickup: stepIsPickup(r.step),
      dest: stepDest(r.step),
      noDistanceWhy,
      ...(r.point ? { point: r.point } : {}),
      ...(near ? { near } : {}),
      match: r.match
    }
  })
  return { rows, route }
}

/** Sum of legs over the rows that have a distance; null when any of those legs is unknown or none have one. */
export function routeTotal(rows: OpenStopRow[]): number | null {
  const withDist = rows.filter((r) => r.distance != null)
  if (withDist.length === 0) return null
  let total = 0
  for (const r of withDist) {
    if (r.leg == null) return null
    total += r.leg
  }
  return total
}

/** Jumps on the legs routeTotal sums. */
export function routeTotalJumps(rows: OpenStopRow[]): number {
  return rows.filter((r) => r.distance != null).reduce((a, r) => a + (r.legJumps ?? 0), 0)
}

/** today's row set and order; 'manual-free' = no manual order and no distance sort (log order) */
function baseOpenStops(
  jobs: OtherJob[],
  start: GeoPoint | undefined,
  locations: Location[],
  opts: ListOpenStopsOpts | undefined,
  mode: 'distance' | 'manual' | 'manual-free',
  resolve: StepResolver
): BaseRow[] {
  const showAll = !!opts?.showAll
  const hideCompleted = opts?.hideCompleted !== false
  const manual = mode === 'manual'
  const unsorted = mode === 'manual-free'
  const hideWithdrawn = opts?.withdrawnSteps === 'hide'
  const active = jobs.filter((j) => j.status === 'active')

  if (!showAll) {
    const rows: BaseRow[] = []
    const pool = manual ? sortJobsByManualOrder(active, opts?.jobOrder ?? []) : active
    for (const job of pool) {
      const step = nextLiveStep(job)
      if (step) rows.push({ job, step })
    }
    if (manual || unsorted || !start) return rows
    return [...rows].sort((a, b) => compareStepsFrom(start, locations, a, b, resolve))
  }

  const withSteps = active.filter((j) => visibleSteps(j, hideCompleted, hideWithdrawn).length > 0)
  const ordered = manual
    ? sortJobsByManualOrder(withSteps, opts?.jobOrder ?? [])
    : unsorted
      ? withSteps
      : sortJobsByFirstStep(withSteps, start, locations, hideCompleted, hideWithdrawn, resolve)
  const rows: BaseRow[] = []
  for (const job of ordered) {
    for (const step of visibleSteps(job, hideCompleted, hideWithdrawn)) {
      rows.push({ job, step })
    }
  }
  return rows
}
