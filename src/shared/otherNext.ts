/**
 * Other-mode Next sort and UEX name snap.
 * Uses the UEX location roster and resolveLogLocation.
 * Does not call planRoute / packer / hold.
 */
import type { Location } from './types'
import { resolveLogLocation } from './logLocation'
import { nextOpenStep, type OtherJob, type OtherStep } from './otherJob'

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
}

function visibleSteps(job: OtherJob, hideCompleted: boolean): OtherStep[] {
  if (hideCompleted) return job.steps.filter((s) => !s.done)
  return job.steps
}

function sortJobsByFirstStep(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  hideCompleted: boolean
): OtherJob[] {
  if (!startLocation.trim()) return jobs
  return [...jobs].sort((a, b) => {
    const sa = visibleSteps(a, hideCompleted)[0]
    const sb = visibleSteps(b, hideCompleted)[0]
    return compareByDistanceFrom(
      startLocation,
      locations,
      sa ? stepActivePlace(sa) : '',
      sb ? stepActivePlace(sb) : ''
    )
  })
}

/** Same list Next and overlay walk. */
export function listOpenStops(
  jobs: OtherJob[],
  startLocation: string,
  locations: Location[],
  opts?: ListOpenStopsOpts
): OpenStopRow[] {
  const showAll = !!opts?.showAll
  const hideCompleted = opts?.hideCompleted !== false
  const active = jobs.filter((j) => j.status === 'active')

  if (!showAll) {
    const rows: OpenStopRow[] = []
    for (const job of active) {
      const step = nextOpenStep(job)
      if (step) rows.push({ job, step })
    }
    if (!startLocation.trim()) return rows
    return [...rows].sort((a, b) =>
      compareByDistanceFrom(
        startLocation,
        locations,
        stepActivePlace(a.step),
        stepActivePlace(b.step)
      )
    )
  }

  const withSteps = active.filter((j) => visibleSteps(j, hideCompleted).length > 0)
  const ordered = sortJobsByFirstStep(withSteps, startLocation, locations, hideCompleted)
  const rows: OpenStopRow[] = []
  for (const job of ordered) {
    for (const step of visibleSteps(job, hideCompleted)) {
      rows.push({ job, step })
    }
  }
  return rows
}
