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
 * - a zone with no z-match can still be a planet or moon's own frame: |position| equals that
 *   body's radius and centre + position lands within 10 km of one of the body's places
 *   (exactly one body must pass; Hurston and microTech are both ~1000 km).
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

const vec = (l: Location): Vec3 | null => (l.x != null && l.y != null && l.z != null ? { x: l.x, y: l.y, z: l.z } : null)
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const sameName = (a: string | undefined, b: string): boolean => !!a && a.toLowerCase() === b.toLowerCase()

/** a body radius must be within this fraction of |position| */
const RADIUS_TOL = 0.03
/** centre + position must land this close to one of the body's places */
const BODY_PLACE_M = 10_000

/** system-frame centre of a planet/moon: the roster entry named after it */
export function bodyCentre(body: string, locations: Location[]): Vec3 | null {
  for (const l of locations) if (sameName(l.name, body)) { const v = vec(l); if (v) return v }
  return null
}

/** planet table lookup (otherBodies.bodyRadiusFromTable): metres, or null when the table doesn't know the body */
export type BodyRadiusLookup = (body: string) => number | null | undefined

/**
 * Radius of a planet/moon in metres, or null when unknown: the planet table first (lookup), else an
 * estimate, the median distance of the body's places (Location.body) from its centre.
 */
export function bodyRadius(body: string, locations: Location[], lookup?: BodyRadiusLookup): number | null {
  const t = lookup?.(body)
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t
  const c = bodyCentre(body, locations)
  if (!c) return null
  const d: number[] = []
  for (const l of locations) {
    if (!sameName(l.body, body) || sameName(l.name, body)) continue
    const v = vec(l)
    if (v) d.push(dist(c, v))
  }
  if (!d.length) return null
  d.sort((a, b) => a - b)
  const mid = d.length >> 1
  return d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2
}

export type BodyFrameMatch = { body: string; centre: Vec3; place: string; meters: number }
export type BodyFrameResult = { match: BodyFrameMatch | null; why: string; candidates: string[]; accepted: string[] }

/** is this marker in a planet/moon's own frame? exactly one body must fit radius and a nearby place */
export function bodyFrameMatch(m: MarkerPos, locations: Location[], lookup?: BodyRadiusLookup): BodyFrameResult {
  const r = Math.hypot(m.x, m.y, m.z)
  const bodies = new Set<string>()
  for (const l of locations) if (l.body && vec(l)) bodies.add(l.body)
  const candidates: string[] = []
  const hits: BodyFrameMatch[] = []
  for (const body of bodies) {
    const rad = bodyRadius(body, locations, lookup)
    if (rad == null || Math.abs(rad - r) > rad * RADIUS_TOL) continue
    candidates.push(body)
    const centre = bodyCentre(body, locations)!
    const p = { x: centre.x + m.x, y: centre.y + m.y, z: centre.z + m.z }
    let best: { name: string; meters: number } | null = null
    for (const l of locations) {
      if (!sameName(l.body, body)) continue
      const v = vec(l)
      if (!v) continue
      const dm = dist(p, v)
      if (dm <= BODY_PLACE_M && (!best || dm < best.meters)) best = { name: l.name, meters: dm }
    }
    if (best) hits.push({ body, centre, place: best.name, meters: best.meters })
  }
  const accepted = hits.map((h) => h.body)
  if (!candidates.length) return { match: null, why: 'no body with this radius', candidates, accepted }
  if (!hits.length) return { match: null, why: 'no place near the point on any body', candidates, accepted }
  if (hits.length > 1) return { match: null, why: 'more than one body fits', candidates, accepted }
  return { match: hits[0], why: 'one body fits', candidates, accepted }
}

export type CalibrateResult = {
  zones: ZoneTable
  change: 'none' | 'root' | 'new' | 'agree' | 'conflict' | 'body'
  place?: string
  /** body-frame path: the body taken, or why none was */
  body?: string
  bodyWhy?: string
  meters?: number
}

/** learn from one marker; returns a new table when anything changed */
export function calibrateZone(zones: ZoneTable, m: MarkerPos, locations: Location[], lookup?: BodyRadiusLookup): CalibrateResult {
  const cur = zones[m.zoneHostId]
  if (isRootFrame(m)) {
    if (cur?.root) return { zones, change: 'none' }
    return { zones: { ...zones, [m.zoneHostId]: { x: 0, y: 0, z: 0, n: 0, root: true } }, change: 'root' }
  }
  if (isSmallZone(m) || cur?.root || cur?.bad) return { zones, change: 'none' }
  const place = markerUexPlace(m, locations)
  if (!place) {
    if (cur) return { zones, change: 'none' }
    // no z-match and no centre yet: try the planet/moon frame
    const b = bodyFrameMatch(m, locations, lookup)
    if (!b.match) return { zones, change: 'none', bodyWhy: b.why + (b.accepted.length > 1 ? ` (${b.accepted.join(', ')})` : '') }
    const c = b.match.centre
    return {
      zones: { ...zones, [m.zoneHostId]: { x: c.x, y: c.y, z: c.z, n: 1 } },
      change: 'body',
      place: b.match.place,
      body: b.match.body,
      bodyWhy: b.why,
      meters: Math.round(b.match.meters)
    }
  }
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
