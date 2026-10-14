/**
 * Other-mode Next sort and UEX name snap.
 * Uses the UEX location roster and resolveLogLocation.
 * Does not call planRoute / packer / hold.
 */
import type { Location } from '@shared/types'
import { resolveLogLocation, splitLogAddress } from '@shared/logLocation'
import type { ListOrder, OtherJob, OtherStep } from '@other/otherJob'
import { compareTravel, formatShortDistance, travel, type GeoPoint, type Travel } from './otherGeo'
import { whereAccuracy, type Where, type WhereSource } from './otherWhere'

export type { ListOrder }

function titleChip(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  if (s === s.toLowerCase()) return s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

/** Display-only: Name · Body [planet] · System [system]. Stored location stays the UEX name. */
export function formatPlaceWithBodySystem(name: string, locations: Location[]): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  const hit = findRosterLocation(trimmed, locations)
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

/**
 * OCR-tolerant name key: lower case, words only, and inside words that carry a digit O -> 0 and
 * I/L -> 1 ("S1DCO6" = "S1DC06"). Applied to both sides, so only a fallback after plain matching.
 */
export function foldPlaceName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (/\d/.test(w) ? w.replace(/o/g, '0').replace(/[il]/g, '1') : w === 'centre' ? 'center' : w))
    .join(' ')
}

/** fallback match on folded names (exact, then one contains the other, then doubled zeros); prefers the address's system */
function findFolded(raw: string, locations: Location[]): Location | undefined {
  const { name, systemHint } = splitLogAddress(raw)
  const key = foldPlaceName(name)
  if (key.length < 4 || !/\d/.test(key)) return undefined
  // same place under two spellings (UEX "Center" without coords, starmap "Centre" with): take the one with coords
  const pick = (hits: Location[]): Location | undefined => {
    const inSystem = systemHint ? hits.filter((l) => l.system === systemHint) : []
    const pool = inSystem.length ? inSystem : hits
    return pool.find((l) => l.x != null && l.y != null && l.z != null) ?? pool[0]
  }
  const exact = locations.filter((l) => foldPlaceName(l.name) === key)
  if (exact.length) return pick(exact)
  const contains = locations.filter((l) => {
    const n = foldPlaceName(l.name)
    return n.length >= 4 && /\d/.test(n) && (n.includes(key) || key.includes(n))
  })
  if (contains.length) return pick(contains)
  // last: OCR doubled zeros ("S1DCO06" = "S1DC06"), exact match only
  const zk = foldZeros(key)
  return pick(locations.filter((l) => foldZeros(foldPlaceName(l.name)) === zk))
}

/** folded key with runs of zeros collapsed to one inside words that carry a digit ("s1dc006" -> "s1dc06") */
function foldZeros(key: string): string {
  return key
    .split(' ')
    .map((w) => (/\d/.test(w) ? w.replace(/0{2,}/g, '0') : w))
    .join(' ')
}

export function findRosterLocation(raw: string, locations: Location[]): Location | undefined {
  const trimmed = raw.trim()
  if (!trimmed || locations.length === 0) return undefined
  const resolved = resolveLogLocation(trimmed, locations)
  const key = resolved.toLowerCase()
  const exact = locations.find((l) => l.name.toLowerCase() === key)
  if (exact) return exact
  return (
    locations.find((l) => {
      const n = l.name.toLowerCase()
      return n.includes(key) || key.includes(n)
    }) ?? findFolded(trimmed, locations)
  )
}

export interface PlaceLookupExplain {
  raw: string
  /** the name findRosterLocation compares (resolveLogLocation of the trimmed text) */
  cleaned: string
  method: 'exact' | 'contains' | 'address' | 'folded' | 'none'
  match?: string
  hasCoords: boolean
  /** up to 5 roster places the chosen step considered (or near names when nothing matched) */
  candidates: { name: string; system: string | null; hasCoords: boolean }[]
}

/**
 * Diagnostics: the steps findRosterLocation takes for `raw`, and which one matched.
 * 'exact' = name equals the text; 'address' = equals it after resolveLogLocation cleaned it
 * (address suffix, tag, partial name); then 'contains', then 'folded' (OCR-tolerant). Read-only.
 */
export function explainPlaceLookup(raw: string, locations: Location[]): PlaceLookupExplain {
  const trimmed = raw.trim()
  const cand = (ls: Location[]): PlaceLookupExplain['candidates'] =>
    ls.slice(0, 5).map((l) => ({ name: l.name, system: l.system ?? null, hasCoords: hasCoords(l) }))
  const out = (method: PlaceLookupExplain['method'], cleaned: string, match: Location | undefined, pool: Location[]): PlaceLookupExplain => ({
    raw,
    cleaned,
    method: match ? method : 'none',
    ...(match ? { match: match.name } : {}),
    hasCoords: hasCoords(match),
    candidates: cand(pool)
  })
  if (!trimmed || locations.length === 0) return out('none', trimmed, undefined, [])
  const resolved = resolveLogLocation(trimmed, locations)
  const key = resolved.toLowerCase()
  const exactHits = locations.filter((l) => l.name.toLowerCase() === key)
  if (exactHits.length) return out(key === trimmed.toLowerCase() ? 'exact' : 'address', resolved, exactHits[0], exactHits)
  const containsHits = locations.filter((l) => {
    const n = l.name.toLowerCase()
    return n.includes(key) || key.includes(n)
  })
  if (containsHits.length) return out('contains', resolved, containsHits[0], containsHits)
  const folded = findFolded(trimmed, locations)
  if (folded) {
    const fk = foldPlaceName(splitLogAddress(trimmed).name)
    const pool = locations.filter((l) => {
      const n = foldPlaceName(l.name)
      return n === fk || (n.length >= 4 && /\d/.test(n) && (n.includes(fk) || fk.includes(n))) || foldZeros(n) === foldZeros(fk)
    })
    // the chosen one first
    return out('folded', resolved, folded, [folded, ...pool.filter((l) => l !== folded)])
  }
  // nothing matched: roster names sharing a word (4+ letters) with the text, as a hint
  const words = foldPlaceName(trimmed).split(' ').filter((w) => w.length >= 4)
  const near = words.length ? locations.filter((l) => foldPlaceName(l.name).split(' ').some((w) => words.includes(w))) : []
  return out('none', resolved, undefined, near)
}

/** Official UEX name only when the match is unique. Otherwise keep OCR text. */
export function snapLocationToUex(raw: string, locations: Location[]): string {
  const trimmed = raw.trim()
  if (!trimmed || locations.length === 0) return trimmed
  const resolved = resolveLogLocation(trimmed, locations)
  const exact = locations.find(
    (l) => l.name.toLowerCase() === resolved.toLowerCase() || l.name.toLowerCase() === trimmed.toLowerCase()
  )
  if (exact) return exact.name
  const rawL = trimmed.toLowerCase()
  const hits = locations.filter((l) => {
    const n = l.name.toLowerCase()
    return n.length >= 10 && rawL.includes(n)
  })
  if (hits.length === 1) return hits[0].name
  return findFolded(trimmed, locations)?.name ?? trimmed
}

/** a roster place as a travel point (system/body carried); undefined without coords */
export function locationPoint(l?: Location): GeoPoint | undefined {
  if (!l || l.x == null || l.y == null || l.z == null) return undefined
  return { x: l.x, y: l.y, z: l.z, system: l.system ?? null, body: l.body ?? null }
}

/** travel metres between two roster places (gateways need `locations`); null when unknown or no gateway */
export function rosterDistance(a?: Location, b?: Location, locations: Location[] = []): number | null {
  return travel(locationPoint(a), locationPoint(b), locations)?.meters ?? null
}

type Pos = { x?: number; y?: number; z?: number }

const hasCoords = (p?: Pos): boolean => !!p && p.x != null && p.y != null && p.z != null

/** marker positions are in the zone frame: treated as same system, unknown body (today's handling) */
const markerPoint = (p: Pos): GeoPoint => ({ x: p.x!, y: p.y!, z: p.z!, system: null, body: null })

/** where a step is: its active place's UEX coords, else (markers on) its marker position */
function stepPoint(step: OtherStep, locations: Location[], useMarker: boolean): GeoPoint | undefined {
  return stepPointWithSource(step, locations, useMarker)?.point
}

/** travel from start to a step's place (marker fallback when markers are on) */
export function stepTravelFromStart(
  startName: string,
  step: OtherStep,
  locations: Location[],
  useMarker = true
): Travel | null {
  return travel(locationPoint(findRosterLocation(startName, locations)), stepPoint(step, locations, useMarker), locations)
}

/** distanceFromStart for a step: falls back to its marker position when the place has no UEX coords */
export function stepDistanceFromStart(
  startName: string,
  step: OtherStep,
  locations: Location[],
  useMarker = true
): number | null {
  return stepTravelFromStart(startName, step, locations, useMarker)?.meters ?? null
}

function compareStepsFrom(start: GeoPoint | undefined, locations: Location[], a: OtherStep | undefined, b: OtherStep | undefined, useMarker: boolean): number {
  if (!start) return 0
  const ta = a ? travel(start, stepPoint(a, locations, useMarker), locations) : null
  const tb = b ? travel(start, stepPoint(b, locations, useMarker), locations) : null
  return compareTravel(ta, tb)
}

/** travel between two named places; null when either is unknown or no gateway joins them */
export function travelFromStart(startName: string, destName: string, locations: Location[]): Travel | null {
  return travel(
    locationPoint(findRosterLocation(startName, locations)),
    locationPoint(findRosterLocation(destName, locations)),
    locations
  )
}

export function distanceFromStart(
  startName: string,
  destName: string,
  locations: Location[]
): number | null {
  return travelFromStart(startName, destName, locations)?.meters ?? null
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

export function compareByDistanceFrom(
  startName: string,
  locations: Location[],
  aName: string,
  bName: string
): number {
  const start = locationPoint(findRosterLocation(startName, locations))
  if (!start) return 0
  return compareTravel(
    travel(start, locationPoint(findRosterLocation(aName, locations)), locations),
    travel(start, locationPoint(findRosterLocation(bName, locations)), locations)
  )
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
  /** marker-based point only: nearest roster place within 25 km of it */
  near?: PlaceNear
}

export interface PlaceNear {
  name: string
  meters: number
}

/** how far a marker point may be from a roster place to be called "near" it */
export const NEAR_MAX_M = 25_000

/** nearest roster place (with coords) within 25 km of a point; undefined when none */
export function nearestRosterPlace(p: GeoPoint | undefined, locations: Location[]): PlaceNear | undefined {
  if (!p) return undefined
  let best: PlaceNear | undefined
  for (const l of locations) {
    if (l.x == null || l.y == null || l.z == null) continue
    const d = Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z)
    if (d <= NEAR_MAX_M && (!best || d < best.meters)) best = { name: l.name, meters: d }
  }
  return best
}

/** "<place, body, system> · near <name> (<dist>)"; the plain place line when there is no near place */
export function formatPlaceNear(place: string, near: PlaceNear | undefined, locations: Location[]): string {
  const base = formatPlaceWithBodySystem(place, locations)
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
}): ResolvedOrigin {
  const none: ResolvedOrigin = { name: null, label: null, kind: null, stale: false, accuracy: null }
  const typed = o.typed?.trim()
  const fromTyped = (): ResolvedOrigin => {
    const point = locationPoint(findRosterLocation(typed!, o.locations))
    return { name: typed!, label: typed!, ...(point ? { point } : {}), kind: 'typed', stale: false, accuracy: null }
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
  const point = w.point ?? (wName ? locationPoint(findRosterLocation(wName, o.locations)) : undefined)
  const at = timeOf(w.at)
  const now = o.now ?? Date.now()
  return {
    name: wName,
    label: w.label?.trim() || wName,
    ...(point ? { point } : {}),
    kind: w.source,
    stale: w.source !== 'typed' && Number.isFinite(at) && now - at > STALE_MS,
    accuracy: w.source === 'typed' ? null : whereAccuracy(w, now)
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
}

const placeKey = (p: string): string => p.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Rows with the same place become one stop at the position of their first row; legs recomputed between stops.
 * Pass the roster so cross-system legs (gateways) and surface legs (body centre) can be measured.
 */
export function groupByPlace(rows: OpenStopRow[], locations: Location[] = []): StopGroup[] {
  const groups: StopGroup[] = []
  const byKey = new Map<string, StopGroup>()
  const groupOfRow: StopGroup[] = []
  for (const r of rows) {
    const key = placeKey(r.place)
    let g = key ? byKey.get(key) : undefined
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
        ...(r.near ? { near: r.near } : {})
      }
      groups.push(g)
      if (key) byKey.set(key, g)
    }
    g.rows.push(r)
    g.pickup = g.pickup || r.pickup
    groupOfRow.push(g)
  }
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
}

const itemKey = (s: OtherStep): string => (s.item ?? '').trim().toLowerCase()

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
  useMarker: boolean
): OtherJob[] {
  if (!start) return jobs
  return [...jobs].sort((a, b) =>
    compareStepsFrom(start, locations, sortStep(a, hideCompleted, hideWithdrawn), sortStep(b, hideCompleted, hideWithdrawn), useMarker)
  )
}

type BaseRow = { job: OtherJob; step: OtherStep }

/**
 * step position plus where it came from. Before pickup the marker is not used: on a combined
 * step it sits on the delivery place, not the pickup.
 */
function stepPointWithSource(
  step: OtherStep,
  locations: Location[],
  useMarker: boolean
): { point: GeoPoint; source: 'uex' | 'marker' } | undefined {
  const named = locationPoint(findRosterLocation(stepActivePlace(step), locations))
  if (named) return { point: named, source: 'uex' }
  if (useMarker && !stepIsPickup(step) && hasCoords(step.position)) return { point: withNearBody(markerPoint(step.position!), locations), source: 'marker' }
  return undefined
}

/** a marker point carries no body: take it from the nearest place within NEAR_MAX_M, so same-body legs go over the surface */
function withNearBody(p: GeoPoint, locations: Location[]): GeoPoint {
  if (p.body) return p
  let best: Location | undefined
  let bestD = NEAR_MAX_M
  for (const l of locations) {
    if (l.x == null || l.y == null || l.z == null || !l.body) continue
    const d = Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z)
    if (d <= bestD) {
      best = l
      bestD = d
    }
  }
  return best ? { ...p, body: best.body ?? null, system: p.system ?? best.system ?? null } : p
}

type Placed = BaseRow & {
  point?: GeoPoint
  source?: 'uex' | 'marker'
  travel: Travel | null
  distance: number | null
  distanceSource: 'uex' | 'marker' | null
}

/** a delivery whose same-item pickup (same job) is still to be routed */
const waitsForPickup = (r: Placed, left: Placed[]): boolean =>
  isOpenDelivery(r.step) &&
  left.some((o) => o !== r && o.job.id === r.job.id && isOpenPickup(o.step) && itemKey(o.step) === itemKey(r.step))

/** greedy nearest-neighbour (fewest jumps, then shortest) from start over rows with a known point; ties keep input order */
function routeOrder(rows: Placed[], start: GeoPoint, locations: Location[]): Placed[] {
  const left = rows.slice()
  const out: Placed[] = []
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

/** Same list Next and overlay walk. */
export function listOpenStops(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  opts?: ListOpenStopsOpts
): OpenStopRow[] {
  const listOrder: ListOrder = opts?.listOrder ?? 'distance'
  const useMarker = opts?.markerDistance !== false
  const origin = opts?.origin && hasCoords(opts.origin) ? opts.origin : undefined
  const hasStart = !!origin || !!startLocation.trim()
  const start: GeoPoint | undefined =
    origin ?? (startLocation.trim() ? locationPoint(findRosterLocation(startLocation, locations)) : undefined)

  // route chains from the log order, not the distance sort
  const base = baseOpenStops(jobs, start, locations, opts, listOrder === 'route' ? 'manual-free' : listOrder)
  const placed: Placed[] = base.map((r) => {
    const hit = stepPointWithSource(r.step, locations, useMarker)
    const t = hit && start ? travel(start, hit.point, locations) : null
    return {
      ...r,
      point: hit?.point,
      source: hit?.source,
      travel: t,
      distance: t?.meters ?? null,
      distanceSource: t ? hit!.source : null
    }
  })

  let ordered: Placed[] = placed
  if (hasStart && listOrder !== 'manual') {
    const known = placed.filter((r) => r.travel != null)
    const unknown = placed.filter((r) => r.travel == null)
    // distance: baseOpenStops already sorted by compareTravel (jumps, then metres)
    ordered = [...(listOrder === 'route' && start ? routeOrder(known, start, locations) : known), ...unknown]
  }

  let prev: GeoPoint | undefined = start
  return ordered.map((r) => {
    const legT = prev && r.point ? travel(prev, r.point, locations) : null
    const hadPrev = !!prev
    prev = r.point
    const leg = legT?.meters ?? null
    const near = r.source === 'marker' ? nearestRosterPlace(r.point, locations) : undefined
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
      ...(near ? { near } : {})
    }
  })
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
  mode: 'distance' | 'manual' | 'manual-free'
): BaseRow[] {
  const showAll = !!opts?.showAll
  const hideCompleted = opts?.hideCompleted !== false
  const manual = mode === 'manual'
  const unsorted = mode === 'manual-free'
  const hideWithdrawn = opts?.withdrawnSteps === 'hide'
  const useMarker = opts?.markerDistance !== false
  const active = jobs.filter((j) => j.status === 'active')

  if (!showAll) {
    const rows: BaseRow[] = []
    const pool = manual ? sortJobsByManualOrder(active, opts?.jobOrder ?? []) : active
    for (const job of pool) {
      const step = nextLiveStep(job)
      if (step) rows.push({ job, step })
    }
    if (manual || unsorted || !start) return rows
    return [...rows].sort((a, b) => compareStepsFrom(start, locations, a.step, b.step, useMarker))
  }

  const withSteps = active.filter((j) => visibleSteps(j, hideCompleted, hideWithdrawn).length > 0)
  const ordered = manual
    ? sortJobsByManualOrder(withSteps, opts?.jobOrder ?? [])
    : unsorted
      ? withSteps
      : sortJobsByFirstStep(withSteps, start, locations, hideCompleted, hideWithdrawn, useMarker)
  const rows: BaseRow[] = []
  for (const job of ordered) {
    for (const step of visibleSteps(job, hideCompleted, hideWithdrawn)) {
      rows.push({ job, step })
    }
  }
  return rows
}
