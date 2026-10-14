/**
 * Other-mode Next sort and UEX name snap.
 * Uses the UEX location roster and resolveLogLocation.
 * Does not call planRoute / packer / hold.
 */
import type { Location } from '@shared/types'
import { resolveLogLocation } from '@shared/logLocation'
import type { ListOrder, OtherJob, OtherStep } from '@other/otherJob'

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

export function findRosterLocation(raw: string, locations: Location[]): Location | undefined {
  const trimmed = raw.trim()
  if (!trimmed || locations.length === 0) return undefined
  const resolved = resolveLogLocation(trimmed, locations)
  const key = resolved.toLowerCase()
  const exact = locations.find((l) => l.name.toLowerCase() === key)
  if (exact) return exact
  return locations.find((l) => {
    const n = l.name.toLowerCase()
    return n.includes(key) || key.includes(n)
  })
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
  return trimmed
}

export function rosterDistance(a?: Location, b?: Location): number | null {
  if (!a || !b) return null
  if (a.x == null || a.y == null || a.z == null) return null
  if (b.x == null || b.y == null || b.z == null) return null
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

type Pos = { x?: number; y?: number; z?: number }

const hasCoords = (p?: Pos): boolean => !!p && p.x != null && p.y != null && p.z != null

/** where a step is: its active place's UEX coords, else (markers on) its marker position */
function stepPoint(step: OtherStep, locations: Location[], useMarker: boolean): Pos | undefined {
  const named = findRosterLocation(stepActivePlace(step), locations)
  if (hasCoords(named)) return named
  return useMarker && hasCoords(step.position) ? step.position : undefined
}

function pointDistance(a?: Pos, b?: Pos): number | null {
  if (!a || !b || !hasCoords(a) || !hasCoords(b)) return null
  return Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!)
}

/** distanceFromStart for a step: falls back to its marker position when the place has no UEX coords */
export function stepDistanceFromStart(
  startName: string,
  step: OtherStep,
  locations: Location[],
  useMarker = true
): number | null {
  return pointDistance(findRosterLocation(startName, locations), stepPoint(step, locations, useMarker))
}

function compareStepsFrom(start: Location | undefined, locations: Location[], a: OtherStep | undefined, b: OtherStep | undefined, useMarker: boolean): number {
  if (!start) return 0
  const da = a ? pointDistance(start, stepPoint(a, locations, useMarker)) : null
  const db = b ? pointDistance(start, stepPoint(b, locations, useMarker)) : null
  if (da == null && db == null) return 0
  if (da == null) return 1
  if (db == null) return -1
  return da - db
}

export function distanceFromStart(
  startName: string,
  destName: string,
  locations: Location[]
): number | null {
  return rosterDistance(findRosterLocation(startName, locations), findRosterLocation(destName, locations))
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

export function compareByDistanceFrom(
  startName: string,
  locations: Location[],
  aName: string,
  bName: string
): number {
  const start = findRosterLocation(startName, locations)
  if (!start) return 0
  const da = rosterDistance(start, findRosterLocation(aName, locations))
  const db = rosterDistance(start, findRosterLocation(bName, locations))
  if (da == null && db == null) return 0
  if (da == null) return 1
  if (db == null) return -1
  return da - db
}

export interface OpenStopRow {
  job: OtherJob
  step: OtherStep
  /** metres from start to this row's place; null when unknown or no start */
  distance: number | null
  /** metres from the previous row's place in this order (start for the first row); null if unknown */
  leg: number | null
  /** where the place's position came from: UEX roster coords, or the step's marker position */
  distanceSource: 'uex' | 'marker' | null
  /** a start is set but this row's distance can't be computed */
  noDistance: boolean
}

/** Place the list should sort / show for this step's current phase. */
export function stepActivePlace(step: OtherStep): string {
  if (step.pickupLocation && !step.pickedUp && !step.done) return step.pickupLocation
  return step.location || step.label || ''
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
}

/** first open step that the game has not withdrawn; withdrawn steps are never "next" */
export function nextLiveStep(job: OtherJob): OtherStep | null {
  if (job.status !== 'active') return null
  return job.steps.find((s) => !s.done && !s.withdrawn) ?? null
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
  return job.steps.filter((s) => !(hideCompleted && s.done) && !(hideWithdrawn && s.withdrawn))
}

/** first step to sort a job by: a live one, else whatever is visible */
function sortStep(job: OtherJob, hideCompleted: boolean, hideWithdrawn: boolean): OtherStep | undefined {
  const vis = visibleSteps(job, hideCompleted, hideWithdrawn)
  return vis.find((s) => !s.done && !s.withdrawn) ?? vis[0]
}

function sortJobsByFirstStep(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  hideCompleted: boolean,
  hideWithdrawn: boolean,
  useMarker: boolean
): OtherJob[] {
  if (!startLocation.trim()) return jobs
  const start = findRosterLocation(startLocation, locations)
  return [...jobs].sort((a, b) =>
    compareStepsFrom(start, locations, sortStep(a, hideCompleted, hideWithdrawn), sortStep(b, hideCompleted, hideWithdrawn), useMarker)
  )
}

type BaseRow = { job: OtherJob; step: OtherStep }

/** step position plus where it came from */
function stepPointWithSource(
  step: OtherStep,
  locations: Location[],
  useMarker: boolean
): { point: Pos; source: 'uex' | 'marker' } | undefined {
  const named = findRosterLocation(stepActivePlace(step), locations)
  if (hasCoords(named)) return { point: named!, source: 'uex' }
  if (useMarker && hasCoords(step.position)) return { point: step.position!, source: 'marker' }
  return undefined
}

type Placed = BaseRow & { point?: Pos; distance: number | null; distanceSource: 'uex' | 'marker' | null }

/** greedy nearest-neighbour from start over rows with a known point; ties keep input order */
function routeOrder(rows: Placed[], start: Pos): Placed[] {
  const left = rows.slice()
  const out: Placed[] = []
  let cur = start
  while (left.length) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < left.length; i++) {
      const d = pointDistance(cur, left[i].point)!
      if (d < bestD) {
        bestD = d
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
  const hasStart = !!startLocation.trim()
  const startLoc = hasStart ? findRosterLocation(startLocation, locations) : undefined
  const start: Pos | undefined = hasCoords(startLoc) ? startLoc : undefined

  // route chains from the log order, not the distance sort
  const base = baseOpenStops(jobs, startLocation, locations, opts, listOrder === 'route' ? 'manual-free' : listOrder)
  const placed: Placed[] = base.map((r) => {
    const hit = start ? stepPointWithSource(r.step, locations, useMarker) : undefined
    const distance = hit ? pointDistance(start, hit.point) : null
    return { ...r, point: hit?.point, distance, distanceSource: distance == null ? null : hit!.source }
  })

  let ordered: Placed[] = placed
  if (hasStart && listOrder !== 'manual') {
    const known = placed.filter((r) => r.distance != null)
    const unknown = placed.filter((r) => r.distance == null)
    ordered = [...(listOrder === 'route' && start ? routeOrder(known, start) : known), ...unknown]
  }

  let prev: Pos | undefined = start
  return ordered.map((r) => {
    const leg = prev && r.point ? pointDistance(prev, r.point) : null
    prev = r.point
    return {
      job: r.job,
      step: r.step,
      distance: r.distance,
      leg,
      distanceSource: r.distanceSource,
      noDistance: hasStart && r.distance == null
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

/** today's row set and order; 'manual-free' = no manual order and no distance sort (log order) */
function baseOpenStops(
  jobs: OtherJob[],
  startLocation: string,
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
    if (manual || unsorted || !startLocation.trim()) return rows
    const start = findRosterLocation(startLocation, locations)
    return [...rows].sort((a, b) => compareStepsFrom(start, locations, a.step, b.step, useMarker))
  }

  const withSteps = active.filter((j) => visibleSteps(j, hideCompleted, hideWithdrawn).length > 0)
  const ordered = manual
    ? sortJobsByManualOrder(withSteps, opts?.jobOrder ?? [])
    : unsorted
      ? withSteps
      : sortJobsByFirstStep(withSteps, startLocation, locations, hideCompleted, hideWithdrawn, useMarker)
  const rows: BaseRow[] = []
  for (const job of ordered) {
    for (const step of visibleSteps(job, hideCompleted, hideWithdrawn)) {
      rows.push({ job, step })
    }
  }
  return rows
}
