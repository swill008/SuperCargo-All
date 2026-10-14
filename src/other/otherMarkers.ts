/**
 * Other-mode marker positions (feature #7): a system-frame position for an objective marker
 * whose place has no UEX name. Pure functions; the reducer keeps the zone table.
 *
 * CreateMarker gives a position in the marker's zone (zoneHostId):
 * - one root zone per build is already the system frame (same as UEX x/y/z): |x| or |y| > 1e8;
 * - other zones are translation-only (no rotation, local z = system z), so
 *   centre = UEX position - marker position, learned when a marker's z matches exactly one UEX
 *   place. A centre counts only while every match agrees within 1 km.
 * - zones under ~150 km across (station interiors) are their own frame and can't be placed.
 * Zone ids hold only within one game build, so the table is keyed by build.
 */
import type { Location } from '@shared/types'
import { locationByZ } from '@shared/markerResolve'
import type { OtherMarkerZone } from '@other/otherJob'

export interface MarkerPos {
  zoneHostId: string
  x: number
  y: number
  z: number
}

export type Vec3 = { x: number; y: number; z: number }

/** zone id -> centre, for one build */
export type ZoneTable = Record<string, OtherMarkerZone>

const ROOT_COORD = 1e8
/** half of ~150 km: a local position closer to its zone origin than this is inside a small zone */
const MIN_ZONE_RADIUS = 75_000
const AGREE_M = 1000

export const isRootFrame = (m: MarkerPos): boolean => Math.abs(m.x) > ROOT_COORD || Math.abs(m.y) > ROOT_COORD

/** inside a small zone (station interior): no way to place it */
export const isSmallZone = (m: MarkerPos): boolean => !isRootFrame(m) && Math.hypot(m.x, m.y, m.z) < MIN_ZONE_RADIUS

/** the one UEX place this marker sits at (unique z match with coords), else null */
export function markerUexPlace(m: MarkerPos, locations: Location[]): Location | null {
  // z within a metre of 0 is the plane many things sit on; not evidence of a place
  if (Math.abs(m.z) < 1) return null
  const { location } = locationByZ(m.z, locations)
  if (!location) return null
  const hit = locations.find((l) => l.name === location)
  return hit && hit.x != null && hit.y != null && hit.z != null ? hit : null
}

export type CalibrateResult = { zones: ZoneTable; change: 'none' | 'root' | 'new' | 'agree' | 'conflict'; place?: string }

/** learn from one marker; returns a new table when anything changed */
export function calibrateZone(zones: ZoneTable, m: MarkerPos, locations: Location[]): CalibrateResult {
  const cur = zones[m.zoneHostId]
  if (isRootFrame(m)) {
    if (cur?.root) return { zones, change: 'none' }
    return { zones: { ...zones, [m.zoneHostId]: { x: 0, y: 0, z: 0, n: 0, root: true } }, change: 'root' }
  }
  if (isSmallZone(m) || cur?.root || cur?.bad) return { zones, change: 'none' }
  const place = markerUexPlace(m, locations)
  if (!place) return { zones, change: 'none' }
  const c = { x: place.x! - m.x, y: place.y! - m.y, z: place.z! - m.z }
  if (!cur) return { zones: { ...zones, [m.zoneHostId]: { ...c, n: 1 } }, change: 'new', place: place.name }
  if (Math.hypot(c.x - cur.x, c.y - cur.y, c.z - cur.z) > AGREE_M) {
    return { zones: { ...zones, [m.zoneHostId]: { ...cur, bad: true } }, change: 'conflict', place: place.name }
  }
  const n = cur.n + 1
  const mean = (a: number, b: number): number => a + (b - a) / n
  const next = { x: mean(cur.x, c.x), y: mean(cur.y, c.y), z: mean(cur.z, c.z), n }
  return { zones: { ...zones, [m.zoneHostId]: next }, change: 'agree', place: place.name }
}

/** system-frame position of a marker, or null when its zone isn't known (or can't be) */
export function resolveMarker(zones: ZoneTable, m: MarkerPos): Vec3 | null {
  if (isRootFrame(m)) return { x: m.x, y: m.y, z: m.z }
  if (isSmallZone(m)) return null
  const zc = zones[m.zoneHostId]
  if (!zc || zc.bad) return null
  if (zc.root) return { x: m.x, y: m.y, z: m.z }
  return { x: zc.x + m.x, y: zc.y + m.y, z: zc.z + m.z }
}
