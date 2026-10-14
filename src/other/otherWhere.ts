// "Where am I?": the player's position from any clue (typed, ticks, Objective Complete,
// inventory, the map's bottom line, r_DisplayInfo text). Parsers and resolvers are pure.
import type { Location } from '@shared/types'
import type { GeoPoint } from './otherGeo'

export type WhereSource = 'typed' | 'tick' | 'objective' | 'inventory' | 'map' | 'displayinfo'

export interface Where {
  /** nearest known place when close enough to count as "at" it (roster name); null = open space / unknown */
  name: string | null
  /** what the UI shows, e.g. "HDRSO-Stott · 22.8 km", "Open space · 443,380 km from Hurston", "Seraphim Station" */
  label: string
  /** star-frame position to measure from; absent when only a name is known */
  point?: GeoPoint
  system: string | null
  body: string | null
  source: WhereSource
  /** ISO time: log time for log clues, wall clock for map / display info / typed */
  at: string
}

/** map bottom line: "STANTON > HURSTON > 0.00° 0.00° 12.85GM" (body and place optional) */
export interface MapLine {
  system: string
  body?: string
  place?: string
  latDeg: number
  lonDeg: number
  distGm: number
}

/** r_DisplayInfo 3 text block (upper right) */
export interface DisplayInfo {
  /** "Stanton" from "Current player location : Stanton1" / "StantonSolarSystem" or the zone names */
  system: string | null
  /** "Hurston" from "Planet:OOC_Stanton_1_Hurston" */
  body: string | null
  /** "CamPos Planet Zone: x y z" in metres, body frame (turns with the body; matches our data's surface frame) */
  planetPos?: { x: number; y: number; z: number }
  /** "Zone: SolarSystem_… Pos: x y z" converted km -> metres, star frame */
  solarPos?: { x: number; y: number; z: number }
  /** "Radius:" metres */
  radiusM?: number
  /** "Altitude" metres above the body surface */
  altitudeM?: number
}

/** "STANTON SYSTEM" / "stanton" / "StantonSolarSystem" -> "Stanton" */
function titleSystem(raw: string): string {
  const w = raw.replace(/solar\s*system$/i, '').replace(/\s*system$/i, '').trim()
  const last = w.split(/\s+/).pop() ?? ''
  return last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : ''
}

/** OCR number: '-'/'–'/'−' minus, ',' read for '.', stray space after the sign */
function num(raw: string): number {
  let t = raw.replace(/[–—−]/g, '-').replace(/\s+/g, '')
  t = t.includes('.') ? t.replace(/,/g, '') : t.replace(/,/g, '.')
  return Number(t)
}

const MAP_COORDS =
  /(-?\s?\d+(?:[.,]\d+)?)\s*[°ºo*˚]?\s*([-–−]?\s?\d+(?:[.,]\d+)?)\s*[°ºo*˚]?\s*(\d+(?:[.,]\d+)?)\s*([GMK])\s*M\b/i

/** CONTRACT (where-parse agent implements). Tolerates OCR noise (° as o/º, > as ›, spaces, GM/Gm). */
export function parseMapLine(text: string): MapLine | null {
  if (!text) return null
  for (const rawLine of text.split(/\r?\n/).reverse()) {
    const line = rawLine.replace(/[›»〉>]/g, '>').replace(/[–−]/g, '-')
    if (!line.includes('>')) continue
    const m = MAP_COORDS.exec(line)
    if (!m) continue
    const names = line
      .slice(0, m.index)
      .split('>')
      .map((t) => t.replace(/^[^A-Za-z0-9"]+|[^A-Za-z0-9"']+$/g, '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0)
    if (!names.length) continue
    const system = titleSystem(names[0])
    if (!/^[A-Za-z]{2,}$/.test(system)) continue
    const unit = m[4].toUpperCase()
    const scale = unit === 'G' ? 1 : unit === 'M' ? 1e-3 : 1e-6
    const latDeg = num(m[1])
    const lonDeg = num(m[2])
    const distGm = num(m[3]) * scale
    if (![latDeg, lonDeg, distGm].every(Number.isFinite) || Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 360) continue
    const out: MapLine = { system, latDeg, lonDeg, distGm }
    if (names.length >= 2) out.body = names[1]
    if (names.length >= 3) out.place = names[names.length - 1]
    return out
  }
  return null
}

const NUM = String.raw`([-–—−]?\s?\d+(?:[.,]\d+)?)\s*(km|m)?`
const TRIPLE = `${NUM}\\s*${NUM}\\s*${NUM}`

function triple(m: RegExpExecArray | null, defaultUnit: 'm' | 'km'): { x: number; y: number; z: number } | undefined {
  if (!m) return undefined
  const v = [1, 3, 5].map((i) => num(m[i]) * ((m[i + 1] ?? defaultUnit).toLowerCase() === 'km' ? 1000 : 1))
  if (!v.every(Number.isFinite)) return undefined
  return { x: v[0], y: v[1], z: v[2] }
}

function bodyName(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/** CONTRACT: null when no usable position or system. */
export function parseDisplayInfo(text: string): DisplayInfo | null {
  if (!text) return null
  const t = text.replace(/[–—−]/g, '-')
  const ooc = /Zone\s*[:;]?\s*OOC[_ ]([A-Za-z]+)[_ ](\d+[a-z]?)[_ ]([A-Za-z][\w ]*?)\s*Pos\s*[:;]?\s*/i.exec(t)
  const camPos = triple(new RegExp(`CamPos\\s*Planet\\s*Zone\\s*[:;]?\\s*${TRIPLE}`, 'i').exec(t), 'm')
  const oocPos = ooc ? triple(new RegExp(`^${TRIPLE}`, 'i').exec(t.slice(ooc.index + ooc[0].length)), 'km') : undefined
  const solarPos = triple(new RegExp(`Zone\\s*[:;]?\\s*Solar\\s*System[_ ]?\\d*\\s*Pos\\s*[:;]?\\s*${TRIPLE}`, 'i').exec(t), 'km')
  const planetPos = camPos ?? oocPos

  let system: string | null = null
  const loc = /location\s*[:;]?\s*([A-Za-z]+)/i.exec(t)
  if (loc) system = titleSystem(loc[1]) || null
  const planet = /Planet\s*[:;]?\s*OOC[_ ]([A-Za-z]+)[_ ](\d+[a-z]?)[_ ]([^\s(]+(?:[_ ][^\s(]+)*)/i.exec(t)
  if (!system && ooc) system = titleSystem(ooc[1])
  if (!system && planet) system = titleSystem(planet[1])
  const body = planet ? bodyName(planet[3]) : ooc ? bodyName(ooc[3]) : null

  if (!system || (!planetPos && !solarPos)) return null
  const out: DisplayInfo = { system, body: body || null }
  if (planetPos) out.planetPos = planetPos
  if (solarPos) out.solarPos = solarPos
  const radius = new RegExp(`Radius\\s*[:;]?\\s*${NUM}`, 'i').exec(t)
  if (radius && Number.isFinite(num(radius[1]))) out.radiusM = num(radius[1])
  const alt = new RegExp(`Altitude\\s*[:;]?\\s*${NUM}`, 'i').exec(t)
  if (alt && Number.isFinite(num(alt[1]))) out.altitudeM = num(alt[1])
  return out
}

// ---- resolving against the roster ----

type Pt = { x: number; y: number; z: number }
type Placed = Location & Pt

const sameSystem = (a: string | undefined | null, b: string | null): boolean =>
  !b || !a || a.toLowerCase() === b.toLowerCase()

function placed(locations: Location[], system: string | null): Placed[] {
  return locations.filter(
    (l): l is Placed =>
      typeof l.x === 'number' && typeof l.y === 'number' && typeof l.z === 'number' && sameSystem(l.system, system)
  )
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** exact / case-insensitive first, then contains (shortest roster name wins) */
function snap(name: string | undefined, pool: Placed[]): Placed | null {
  if (!name) return null
  const n = norm(name)
  if (!n) return null
  const exact = pool.find((l) => norm(l.name) === n)
  if (exact) return exact
  if (n.length < 4) return null
  const hits = pool.filter((l) => {
    const r = norm(l.name)
    return r.length >= 4 && (r.includes(n) || n.includes(r))
  })
  hits.sort((a, b) => Math.abs(norm(a.name).length - n.length) - Math.abs(norm(b.name).length - n.length))
  return hits[0] ?? null
}

/** planets and moons: roster entries some other entry names as its body */
function bodies(pool: Placed[]): Placed[] {
  const names = new Set(pool.map((l) => l.body?.toLowerCase()).filter((b): b is string => !!b))
  return pool.filter((l) => names.has(l.name.toLowerCase()))
}

function isBody(loc: Placed, pool: Placed[]): boolean {
  const n = loc.name.toLowerCase()
  return pool.some((l) => l.body?.toLowerCase() === n)
}

function nearest(p: Pt, pool: Placed[]): { loc: Placed; d: number } | null {
  let best: { loc: Placed; d: number } | null = null
  for (const l of pool) {
    const d = dist(p, l)
    if (!best || d < best.d) best = { loc: l, d }
  }
  return best
}

/** "22.8 km", "443,380 km", "12.5 Gm"; under 1 km in metres */
export function formatWhereDistance(m: number): string {
  const km = Math.abs(m) / 1000
  if (km < 1) return `${Math.round(Math.abs(m))} m`
  if (km < 100) return `${km.toFixed(1)} km`
  if (km < 10_000_000) return `${Math.round(km).toLocaleString('en-US')} km`
  return `${(km / 1e6).toFixed(1)} Gm`
}

function openSpace(p: Pt, pool: Placed[], prefer?: Placed | null): string {
  const ref = prefer ? { loc: prefer, d: dist(p, prefer) } : nearest(p, bodies(pool))
  return ref ? `Open space · ${formatWhereDistance(ref.d)} from ${ref.loc.name}` : 'Open space'
}

const geo = (p: Pt, system: string | null, body: string | null): GeoPoint => ({ x: p.x, y: p.y, z: p.z, system, body })

/** CONTRACT: most specific name wins (place, then body); 0°/0° coordinates are ignored as a position. */
export function resolveMapLine(line: MapLine, locations: Location[], at: string): Where | null {
  const system = line.system ? titleSystem(line.system) : null
  const pool = placed(locations, system)
  const bodyLoc = snap(line.body, pool)
  const placeLoc = line.place ? snap(line.place, pool) : null
  for (const loc of [placeLoc, bodyLoc]) {
    if (!loc) continue
    const body = isBody(loc, pool) ? loc.name : (loc.body ?? bodyLoc?.name ?? null)
    return { name: loc.name, label: loc.name, point: geo(loc, system, body), system, body, source: 'map', at }
  }
  if (line.latDeg === 0 && line.lonDeg === 0) return null
  if (!(line.distGm > 0)) return null
  const r = line.distGm * 1e9
  const lat = (line.latDeg * Math.PI) / 180
  const lon = (line.lonDeg * Math.PI) / 180
  const p = { x: r * Math.cos(lat) * Math.cos(lon), y: r * Math.cos(lat) * Math.sin(lon), z: r * Math.sin(lat) }
  return { name: null, label: openSpace(p, pool), point: geo(p, system, null), system, body: null, source: 'map', at }
}

/** CONTRACT: near a body (altitude under ~100 km) = body centre + planetPos (surface frame); else solarPos. */
export function resolveDisplayInfo(info: DisplayInfo, locations: Location[], at: string): Where | null {
  const system = info.system ? titleSystem(info.system) : null
  const pool = placed(locations, system)
  const bodyLoc = info.body ? snap(info.body, pool) : null
  const NEAR = 100_000
  let near = false
  if (bodyLoc && info.planetPos) {
    if (typeof info.altitudeM === 'number') near = info.altitudeM < NEAR
    else if (typeof info.radiusM === 'number') {
      const { x, y, z } = info.planetPos
      near = Math.hypot(x, y, z) - info.radiusM < NEAR
    }
  }
  let p: Pt
  if (near && bodyLoc && info.planetPos) {
    p = { x: bodyLoc.x + info.planetPos.x, y: bodyLoc.y + info.planetPos.y, z: bodyLoc.z + info.planetPos.z }
  } else if (info.solarPos) {
    p = info.solarPos
  } else return null
  const hit = nearest(p, pool)
  const limit = near ? 50_000 : 100_000
  if (hit && hit.d <= limit) {
    const body = near && bodyLoc ? bodyLoc.name : isBody(hit.loc, pool) ? hit.loc.name : (hit.loc.body ?? null)
    return {
      name: hit.loc.name,
      label: `${hit.loc.name} · ${formatWhereDistance(hit.d)}`,
      point: geo(p, system, body),
      system,
      body,
      source: 'displayinfo',
      at
    }
  }
  const body = near && bodyLoc ? bodyLoc.name : null
  return {
    name: null,
    label: openSpace(p, pool, bodyLoc),
    point: geo(p, system, body),
    system,
    body,
    source: 'displayinfo',
    at
  }
}

/** main <-> renderer result of one WHERE AM I read */
export interface WhereRunResult {
  ok: boolean
  where?: Where
  /** which zone gave the answer */
  zone?: 1 | 2
  /** raw OCR text per zone, for TEST and diagnostics */
  raw: { zone1?: string; zone2?: string }
  error?: string
  ms: number
}
