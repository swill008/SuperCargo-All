// Other-mode travel distance between two star-frame points: system-aware (gateway + jumps)
// and over the surface when both points sit on the same body. Pure; no Electron.
import type { Location } from '@shared/types'

/** star-frame metres (origin = that system's star); system/body when known */
export interface GeoPoint {
  x: number
  y: number
  z: number
  system?: string | null
  body?: string | null
}

export interface Travel {
  /** metres travelled in normal space: same system = a to b; other system = a to its gateway + exit gateway to b */
  meters: number
  /** jump-point crossings (0 = same system) */
  jumps: number
  /** true when measured over a body's surface (both points on the same planet or moon) */
  surface: boolean
}

const norm = (s?: string | null): string => (s ?? '').trim().toLowerCase()

/** "Stanton1" / "Stantonl" / "StantonSolarSystem" / "Stanton System" -> "stanton" (letters/digits only) */
const baseSystem = (s?: string | null): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/solar\s*system|system/g, '')
    .replace(/[^a-z0-9]+/g, '')

// systems the roster knows (normalised), cached per roster array
const knownCache = new WeakMap<Location[], string[]>()
function knownSystems(locations: Location[]): string[] {
  let hit = knownCache.get(locations)
  if (!hit) {
    hit = [...new Set(locations.map((l) => baseSystem(l.system)).filter(Boolean))].sort((a, b) => b.length - a.length)
    knownCache.set(locations, hit)
  }
  return hit
}

/**
 * Roster system key for a (possibly misread) system name, or '' when the roster has no such system.
 * Exact or prefix + trailing OCR junk (digits, l, i, |): "Stantonl" -> "stanton".
 */
export function systemKey(s: string | null | undefined, locations: Location[]): string {
  const n = baseSystem(s)
  if (!n) return ''
  for (const k of knownSystems(locations)) {
    if (n === k || (n.startsWith(k) && /^[0-9li]*$/.test(n.slice(k.length)))) return k
  }
  return ''
}

const finite = (p?: { x?: number; y?: number; z?: number } | null): boolean =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

type XYZ = { x: number; y: number; z: number }
const xyz = (l: Location): XYZ => ({ x: l.x!, y: l.y!, z: l.z! })

/** a body's centre: the roster entry named like the body (same system first) */
function bodyCentre(body: string, system: string, locations: Location[]): XYZ | undefined {
  const key = norm(body)
  const hits = locations.filter((l) => norm(l.name) === key && finite(l))
  const hit = hits.find((l) => !system || !l.system || baseSystem(l.system) === system) ?? hits[0]
  return hit ? xyz(hit) : undefined
}

/** "<to> Gateway" sitting in system `inSys` ("Pyro Gateway" or UEX "Pyro Gateway (Stanton)"); clinics etc. excluded */
function gateway(inSys: string, to: string, locations: Location[]): XYZ | undefined {
  const want = `${to} gateway`
  const hit = locations.find((l) => {
    if (!finite(l) || baseSystem(l.system) !== inSys) return false
    const n = norm(l.name)
    return n === want || n === `${want} (${inSys})`
  })
  return hit ? xyz(hit) : undefined
}

/** both points within 5% of the same distance from the body centre = on its surface */
const SURFACE_RADIUS_TOL = 0.05

/**
 * null when either point is unknown or no gateway joins the systems. Names are normalised
 * (systemKey); a system the roster doesn't have, or none, on either side = same system.
 */
export function travel(a: GeoPoint | undefined, b: GeoPoint | undefined, locations: Location[]): Travel | null {
  if (!a || !b || !finite(a) || !finite(b)) return null
  const sa = systemKey(a.system, locations)
  const sb = systemKey(b.system, locations)
  if (!sa || !sb || sa === sb) {
    const chord = dist(a, b)
    const body = norm(a.body)
    if (body && body === norm(b.body)) {
      const c = bodyCentre(body, sa || sb, locations)
      if (c) {
        const ra = dist(a, c)
        const rb = dist(b, c)
        if (ra > 0 && rb > 0 && Math.abs(ra - rb) <= SURFACE_RADIUS_TOL * Math.max(ra, rb)) {
          const r = (ra + rb) / 2
          return { meters: r * 2 * Math.asin(Math.min(1, chord / (2 * r))), jumps: 0, surface: true }
        }
      }
    }
    return { meters: chord, jumps: 0, surface: false }
  }
  const gwA = gateway(sa, sb, locations)
  const gwB = gateway(sb, sa, locations)
  if (!gwA || !gwB) return null
  return { meters: dist(a, gwA) + dist(gwB, b), jumps: 1, surface: false }
}

/** fewer jumps first, then shorter; null sorts last; 0 when both null. */
export function compareTravel(a: Travel | null, b: Travel | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  if (a.jumps !== b.jumps) return a.jumps - b.jumps
  return a.meters - b.meters
}

/** short form for play (otherNext.formatDistance): "830 km", "4.7 Mm", "57.9 Gm"; under 1 km in metres */
export function formatShortDistance(m: number): string {
  const km = Math.abs(m) / 1000
  if (km < 1) return `${Math.round(Math.abs(m))} m`
  if (Math.round(km) < 1000) return `${Math.round(km)} km`
  const Mm = km / 1000
  if (Number(Mm.toFixed(1)) < 1000) return `${Mm.toFixed(1)} Mm`
  return `${(Mm / 1000).toFixed(1)} Gm`
}

/** "12.3 Gm", "≈490 km surface", "38.0 Gm + 1 jump"; "—" for null. */
export function formatTravel(t: Travel | null): string {
  if (!t || !Number.isFinite(t.meters)) return '—'
  let s = formatShortDistance(t.meters)
  if (t.surface) s = `≈${s} surface`
  if (t.jumps > 0) s += ` + ${t.jumps} jump${t.jumps === 1 ? '' : 's'}`
  return s
}
