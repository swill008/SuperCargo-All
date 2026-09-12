/**
 * Other-mode Next sort.
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

export function rosterDistance(a?: Location, b?: Location): number | null {
  if (!a || !b) return null
  if (a.x == null || a.y == null || a.z == null) return null
  if (b.x == null || b.y == null || b.z == null) return null
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
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
