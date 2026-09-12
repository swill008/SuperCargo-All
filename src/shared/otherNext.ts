/**
 * Other-mode Next sort and UEX name snap.
 * Uses the UEX location roster and resolveLogLocation.
 * Does not call planRoute / packer / hold.
 */
import type { Location } from './types'
import { resolveLogLocation } from './logLocation'

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

/** UEX x/y/z are starmap meters. */
export function formatMapDistance(meters: number | null): string {
  if (meters == null) return '\u2014'
  const km = meters / 1000
  if (km >= 1000) return `${(km / 1000).toFixed(1)} Mm`
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
