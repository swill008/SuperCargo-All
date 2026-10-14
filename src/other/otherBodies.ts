/**
 * Planet table (pure): planets/moons from the place roster, with their radius.
 * Exact radius comes from the r_DisplayInfo panel ("Radius:"); until one is read, an estimate:
 * the median distance of the body's roster places from its centre. Saved by main (other-bodies.json).
 * Also the learned generic places ("Security Compound" near a known place), for diagnostics and labels.
 * Table keys are bodyKey(name) (trimmed, lower case); BodyInfo.name keeps the roster spelling.
 */

export type Vec3 = { x: number; y: number; z: number }

/** the roster fields this module reads (Location and the bundled starmap entries both fit) */
export interface RosterPlace {
  name: string
  system?: string
  body?: string
  type?: string
  x?: number
  y?: number
  z?: number
}

export interface BodyInfo {
  name: string
  system: string
  /** 'Planet' | 'Moon' | ...; undefined when the roster doesn't say */
  type?: string
  /** planet a moon orbits (the centre entry's own body); undefined when the roster doesn't say */
  parent?: string
  /** star-frame centre, metres */
  centre: Vec3
  /** exact, from the panel's "Radius:" line */
  radiusM?: number
  /** median distance of the body's roster places from its centre */
  radiusEstM?: number
  radiusSource: 'panel' | 'estimate' | null
  /** panel radius reads recorded */
  seen: number
  lastSeen?: string
}

export interface LearnedPlace {
  /** generic place name, e.g. "Security Compound" */
  name: string
  /** roster place it was found near */
  near: string
  nearMeters: number
  body?: string
  system?: string
  point: Vec3
  seen: number
  lastSeen: string
}

/** what the renderer reports (main adds seen / lastSeen) */
export type LearnedPlaceReport = Omit<LearnedPlace, 'seen' | 'lastSeen'>

export interface BodiesDoc {
  bodies: Record<string, BodyInfo>
  learned: LearnedPlace[]
}

/** panel radius sanity: a real planet/moon is 50 km - 10,000 km */
export const RADIUS_MIN_M = 50_000
export const RADIUS_MAX_M = 10_000_000
export const LEARNED_MAX = 200

export const bodyKey = (name: string): string => name.trim().toLowerCase()

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec = (v: unknown): v is Vec3 =>
  !!v && typeof v === 'object' && isNum((v as Vec3).x) && isNum((v as Vec3).y) && isNum((v as Vec3).z)
const vecOf = (p: RosterPlace): Vec3 | null => (isNum(p.x) && isNum(p.y) && isNum(p.z) ? { x: p.x, y: p.y, z: p.z } : null)
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

export function radiusSane(m: unknown): m is number {
  return isNum(m) && m >= RADIUS_MIN_M && m <= RADIUS_MAX_M
}

export function emptyBodiesDoc(): BodiesDoc {
  return { bodies: {}, learned: [] }
}

function median(d: number[]): number | null {
  if (!d.length) return null
  d.sort((a, b) => a - b)
  const mid = d.length >> 1
  return d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2
}

/**
 * Table from the roster, merged with a saved doc. Bodies = names some place gives as its `body`,
 * centred on the roster entry of that name (skipped without one). The saved panel radius / seen / lastSeen
 * carry over; saved bodies the roster no longer has are kept when they have a centre.
 */
export function buildBodies(locations: RosterPlace[], saved?: BodiesDoc | null): Record<string, BodyInfo> {
  const names = new Map<string, string>()
  for (const l of locations) {
    const b = str(l.body)
    if (b && !names.has(bodyKey(b))) names.set(bodyKey(b), b.trim())
  }
  const centres = new Map<string, RosterPlace>()
  for (const l of locations) {
    const k = bodyKey(l.name ?? '')
    if (names.has(k) && !centres.has(k) && vecOf(l)) centres.set(k, l)
  }
  const dists = new Map<string, number[]>()
  for (const l of locations) {
    const b = str(l.body)
    if (!b) continue
    const k = bodyKey(b)
    const c = centres.get(k)
    const v = vecOf(l)
    // places that are bodies themselves (moons listing their planet) don't measure the surface
    if (!c || !v || names.has(bodyKey(l.name ?? ''))) continue
    const list = dists.get(k) ?? []
    list.push(dist(vecOf(c)!, v))
    dists.set(k, list)
  }

  const out: Record<string, BodyInfo> = {}
  for (const [k, entry] of centres) {
    const prev = saved?.bodies?.[k]
    const est = median(dists.get(k) ?? [])
    const radiusEstM = est !== null && radiusSane(est) ? est : undefined
    const radiusM = prev && radiusSane(prev.radiusM) ? prev.radiusM : undefined
    out[k] = {
      name: names.get(k) ?? entry.name,
      system: str(entry.system) ?? str(prev?.system) ?? '',
      type: str(entry.type) ?? str(prev?.type),
      parent: str(entry.body) && bodyKey(entry.body!) !== k ? entry.body!.trim() : str(prev?.parent),
      centre: vecOf(entry)!,
      radiusM,
      radiusEstM,
      radiusSource: radiusM !== undefined ? 'panel' : radiusEstM !== undefined ? 'estimate' : null,
      seen: prev && isNum(prev.seen) ? prev.seen : 0,
      lastSeen: str(prev?.lastSeen)
    }
  }
  for (const [k, prev] of Object.entries(saved?.bodies ?? {})) {
    if (out[k] || !prev || !isVec(prev.centre) || !str(prev.name)) continue
    const radiusM = radiusSane(prev.radiusM) ? prev.radiusM : undefined
    const radiusEstM = radiusSane(prev.radiusEstM) ? prev.radiusEstM : undefined
    out[k] = {
      ...prev,
      radiusM,
      radiusEstM,
      radiusSource: radiusM !== undefined ? 'panel' : radiusEstM !== undefined ? 'estimate' : null,
      seen: isNum(prev.seen) ? prev.seen : 0
    }
  }
  return out
}

/** radius in metres: the panel's exact value first, then the estimate; null when unknown */
export function bodyRadiusFromTable(table: Record<string, BodyInfo> | null | undefined, name: string | null | undefined): number | null {
  if (!table || !name) return null
  const b = table[bodyKey(name)]
  if (!b) return null
  if (radiusSane(b.radiusM)) return b.radiusM
  if (radiusSane(b.radiusEstM)) return b.radiusEstM
  return null
}

/**
 * Record a panel "Radius:" read. Returns the same doc object when nothing changed
 * (unknown body, or radius outside 50 km - 10,000 km).
 */
export function recordPanelRadius(doc: BodiesDoc, body: string, system: string | null | undefined, radiusM: number, at: string): BodiesDoc {
  if (!body || !radiusSane(radiusM)) return doc
  const k = bodyKey(body)
  const prev = doc.bodies[k]
  if (!prev) return doc
  const next: BodyInfo = {
    ...prev,
    system: prev.system || str(system)?.toLowerCase() || '',
    radiusM,
    radiusSource: 'panel',
    seen: (isNum(prev.seen) ? prev.seen : 0) + 1,
    lastSeen: at
  }
  return { ...doc, bodies: { ...doc.bodies, [k]: next } }
}

const learnedKey = (name: string, near: string): string => `${bodyKey(name)}|${bodyKey(near)}`

/**
 * Record a generic place found near a roster place. Keyed by name + near; a repeat updates the point and
 * moves to the end (newest). Keeps the newest LEARNED_MAX. Returns the same doc when the entry is invalid.
 */
export function recordLearned(doc: BodiesDoc, entry: LearnedPlaceReport, at: string): BodiesDoc {
  if (!entry || !str(entry.name) || !str(entry.near) || !isVec(entry.point) || !isNum(entry.nearMeters) || entry.nearMeters < 0) return doc
  const k = learnedKey(entry.name, entry.near)
  const prev = doc.learned.find((l) => learnedKey(l.name, l.near) === k)
  const rest = doc.learned.filter((l) => learnedKey(l.name, l.near) !== k)
  const item: LearnedPlace = {
    name: entry.name.trim(),
    near: entry.near.trim(),
    nearMeters: entry.nearMeters,
    body: str(entry.body) ?? prev?.body,
    system: str(entry.system) ?? prev?.system,
    point: { x: entry.point.x, y: entry.point.y, z: entry.point.z },
    seen: (prev?.seen ?? 0) + 1,
    lastSeen: at
  }
  const learned = [...rest, item]
  return { ...doc, learned: learned.length > LEARNED_MAX ? learned.slice(learned.length - LEARNED_MAX) : learned }
}

/** saved file -> doc; drops anything malformed */
export function normalizeBodiesDoc(raw: unknown): BodiesDoc {
  const out = emptyBodiesDoc()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as { bodies?: unknown; learned?: unknown }
  if (r.bodies && typeof r.bodies === 'object' && !Array.isArray(r.bodies)) {
    for (const [k, v] of Object.entries(r.bodies as Record<string, unknown>)) {
      const b = v as Partial<BodyInfo> | null
      if (!b || typeof b !== 'object' || !str(b.name) || !isVec(b.centre)) continue
      const radiusM = radiusSane(b.radiusM) ? b.radiusM : undefined
      const radiusEstM = radiusSane(b.radiusEstM) ? b.radiusEstM : undefined
      out.bodies[bodyKey(k)] = {
        name: b.name!,
        system: str(b.system) ?? '',
        type: str(b.type),
        parent: str(b.parent),
        centre: { x: b.centre!.x, y: b.centre!.y, z: b.centre!.z },
        radiusM,
        radiusEstM,
        radiusSource: radiusM !== undefined ? 'panel' : radiusEstM !== undefined ? 'estimate' : null,
        seen: isNum(b.seen) && b.seen >= 0 ? b.seen : 0,
        lastSeen: str(b.lastSeen)
      }
    }
  }
  if (Array.isArray(r.learned)) {
    for (const v of r.learned) {
      const l = v as Partial<LearnedPlace> | null
      if (!l || !str(l.name) || !str(l.near) || !isVec(l.point) || !isNum(l.nearMeters)) continue
      out.learned.push({
        name: l.name!,
        near: l.near!,
        nearMeters: l.nearMeters!,
        body: str(l.body),
        system: str(l.system),
        point: { x: l.point!.x, y: l.point!.y, z: l.point!.z },
        seen: isNum(l.seen) && l.seen > 0 ? l.seen : 1,
        lastSeen: str(l.lastSeen) ?? ''
      })
    }
    if (out.learned.length > LEARNED_MAX) out.learned = out.learned.slice(out.learned.length - LEARNED_MAX)
  }
  return out
}

/** diagnostics 'BODIES' section: one row per body (km), then the learned places */
export function bodiesDiag(doc: BodiesDoc): { table: Record<string, unknown>[]; learned: LearnedPlace[] } {
  const km = (m: number | undefined): number | undefined => (m === undefined ? undefined : Math.round(m / 100) / 10)
  const table = Object.values(doc.bodies)
    .sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name))
    .map((b) => ({
      name: b.name,
      system: b.system,
      type: b.type,
      parent: b.parent,
      radiusKm: km(b.radiusM),
      estimateKm: km(b.radiusEstM),
      source: b.radiusSource,
      seen: b.seen,
      lastSeen: b.lastSeen
    }))
  return { table, learned: doc.learned }
}
