/**
 * One stop-place resolver. Weighs the evidence for every roster place (name, the address's body and
 * system, the game's objective marker, where you are) and returns one answer per stop that every
 * screen, the route sort and diagnostics read. Pure: no React, no store.
 */
import type { Location } from '@shared/types'
import { splitLogAddress } from '@shared/logLocation'
import type { OtherStep } from '@other/otherJob'
import type { GeoPoint } from './otherGeo'

export type MatchStatus = 'exact' | 'corrected' | 'marker' | 'guess' | 'mismatch' | 'unsure' | 'none'

export interface Evidence {
  kind: 'name' | 'body' | 'system' | 'marker' | 'here'
  ok: boolean
  points: number
  text: string
}

export interface Candidate {
  name: string
  score: number
  hasCoords: boolean
  system?: string | null
  body?: string | null
}

export interface StopPlace {
  /** the active place text (stepActivePlace) */
  text: string
  /** what to show: roster name, or text (" · near X (d)" is the UI's job via `near`) */
  label: string
  /** chosen roster place (with coords) when one won */
  match?: Location
  /** position to measure to (roster coords, or marker point with body/system from the nearest place) */
  point?: GeoPoint
  source: 'roster' | 'marker' | null
  status: MatchStatus
  /** 0-10, same scale as WHERE AM I accuracy */
  confidence: number
  /** in the order weighed */
  evidence: Evidence[]
  /** top 5 by score */
  candidates: Candidate[]
  /** marker points only: nearest roster place within NEAR_MAX_M (same object as site when site.from is 'marker') */
  near?: { name: string; meters: number }
  /**
   * a generic site (Security Compound, Storehouse) belongs to a roster place: the one the contract names
   * ('contract'), else the one nearest the marker ('marker'). meters = marker -> place; null without a marker
   */
  site?: StopSite
}

export interface StopSite {
  name: string
  meters: number | null
  from: 'contract' | 'marker'
}

export interface ResolveCtx {
  /** merged roster */
  locations: Location[]
  /** otherMarkerDistance setting */
  useMarker: boolean
  /** start point when it came from a read (not typed): 'here' evidence */
  here?: GeoPoint
}

/** how far a marker point may be from a roster place to be called "near" it */
export const NEAR_MAX_M = 25_000

// scoring (contract 8)
const PTS_EXACT = 6
const PTS_KEY = 5
const PTS_CONTAINS = 3
const PTS_TOKEN = 2
const PTS_BODY = 2
const PTS_BODY_BAD = -6
const PTS_SYSTEM = 1
const PTS_SYSTEM_BAD = -6
const PTS_MARKER_NEAR = 4
const PTS_MARKER_FAR = -5
const PTS_HERE = 2
const MARKER_NEAR_M = 2_000
const MARKER_FAR_M = 10_000
const HERE_M = 1_000
const ACCEPT_SCORE = 5
const ACCEPT_GAP = 3

const SAME_PLACE_M = 1_000

/**
 * generic site names the game uses at many places (not roster places): such a stop belongs to the
 * place the contract names, or the one by the marker
 */
const GENERIC_SITE = /^(?:the )?(?:security (?:compound|post|checkpoint)|storehouse|warehouse|storage (?:depot|facility|area)|depot|bunker|checkpoint|drop (?:off|point)|delivery point|hangar|loading dock|cargo (?:area|deck))s?$/

/** true for a generic site name ("Security Compound", "Storehouse") */
export function isGenericSite(text: string): boolean {
  return GENERIC_SITE.test(placeKey(text))
}

const SYSTEMS = new Set(['stanton', 'pyro', 'nyx', 'terra', 'magnus'])

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const plain = (s?: string | null): string => words(s ?? '').join(' ')
const sysKey = (s?: string | null): string => (s ?? '').toLowerCase().replace(/solar\s*system|system/g, '').replace(/[^a-z]+/g, '')

function foldWord(w: string): string {
  if (w === 'centre') return 'center'
  if (!/\d/.test(w)) return w
  return w.replace(/o/g, '0').replace(/[il]/g, '1').replace(/0+/g, '0')
}

interface Parsed {
  key: string
  /** the name part (address hints removed), as typed */
  name: string
  bodyHint?: string
  systemHint?: string
}

function parsePlace(s: string): Parsed {
  const t = s.trim().replace(/\s*\([^)]*\)\s*$/, '')
  const { name, systemHint } = splitLogAddress(t)
  let bodyHint: string | undefined
  if (name !== t && t.startsWith(name)) {
    // only "on <Body>" names the body the place sits on; Lagrange / orbit addresses don't
    const m = /^\s+on\s+(.+?)\s*\.?$/i.exec(t.slice(name.length))
    const b = m ? plain(m[1]) : ''
    if (b && !SYSTEMS.has(b)) bodyHint = b
  }
  const key = words(name).map(foldWord).join(' ')
  return { key, name, ...(bodyHint ? { bodyHint } : {}), ...(systemHint ? { systemHint } : {}) }
}

/**
 * The one place-name normaliser: lower case, trailing "(...)" and address ("... on Hurston") dropped,
 * words only, centre -> center; inside words with a digit o -> 0, i/l -> 1, runs of 0 -> one 0.
 */
export function placeKey(s: string): string {
  return parsePlace(s).key
}

const hasXYZ = (p?: { x?: number; y?: number; z?: number } | null): boolean =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

type XYZ = { x: number; y: number; z: number }

const dist = (a: { x?: number; y?: number; z?: number }, b: XYZ): number =>
  Math.hypot(a.x! - b.x, a.y! - b.y, a.z! - b.z)

function shortDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`
}

/** one roster place per key (two spellings of one place = one entry, the one with coords) */
interface RosterEntry {
  loc: Location
  /** every spelling's name, lower case */
  names: string[]
  key: string
  hasCoords: boolean
}

const rosterCache = new WeakMap<Location[], RosterEntry[]>()

function rosterEntries(locations: Location[]): RosterEntry[] {
  let hit = rosterCache.get(locations)
  if (hit) return hit
  const byKey = new Map<string, RosterEntry[]>()
  for (const l of locations) {
    const key = placeKey(l.name)
    if (!key) continue
    const coords = hasXYZ(l)
    const list = byKey.get(key) ?? []
    if (!list.length) byKey.set(key, list)
    // same key = one place when either lacks coords or both sit within 1 km (twins in two systems stay apart)
    const same = list.find((e) => !coords || !e.hasCoords || dist(e.loc, l as XYZ) <= SAME_PLACE_M)
    if (!same) list.push({ loc: l, names: [l.name.toLowerCase()], key, hasCoords: coords })
    else {
      same.names.push(l.name.toLowerCase())
      if (coords && !same.hasCoords) {
        same.loc = l
        same.hasCoords = true
      }
    }
  }
  hit = [...byKey.values()].flat()
  rosterCache.set(locations, hit)
  return hit
}

/** whole-word containment of b in a */
const containsWords = (a: string, b: string): boolean => ` ${a} `.includes(` ${b} `)

const distinctive = (w: string): boolean => w.length >= 4 && /\d/.test(w)

interface Scored {
  e: RosterEntry
  score: number
  nameKind: 'exact' | 'key' | 'contains' | 'token'
  /** containment with the text inside the roster name (a shortened name), not the other way */
  partOf?: boolean
  evidence: Evidence[]
  markerM?: number
}

function nameEvidence(p: Parsed, rawLower: string, e: RosterEntry): { pts: number; kind: Scored['nameKind']; text: string; partOf?: boolean } | null {
  const shown = e.loc.name
  if (e.names.includes(rawLower) || e.names.includes(p.name.toLowerCase())) return { pts: PTS_EXACT, kind: 'exact', text: `name exact: ${shown}` }
  if (!p.key) return null
  if (e.key === p.key) return { pts: PTS_KEY, kind: 'key', text: `name corrected: "${p.name}" = ${shown}` }
  const shorter = e.key.length <= p.key.length ? e.key : p.key
  if (shorter.length >= 4 && (containsWords(p.key, e.key) || containsWords(e.key, p.key)))
    return { pts: PTS_CONTAINS, kind: 'contains', text: `name partly matches: ${shown}`, partOf: containsWords(e.key, p.key) }
  const mine = new Set(p.key.split(' ').filter(distinctive))
  const shared = e.key.split(' ').find((w) => mine.has(w))
  if (shared) return { pts: PTS_TOKEN, kind: 'token', text: `shares code ${shared.toUpperCase()}: ${shown}` }
  return null
}

function scoreEntry(p: Parsed, rawLower: string, e: RosterEntry, ctx: ResolveCtx, marker?: GeoPoint): Scored | null {
  const n = nameEvidence(p, rawLower, e)
  if (!n) return null
  const ev: Evidence[] = [{ kind: 'name', ok: true, points: n.pts, text: n.text }]
  let score = n.pts
  const l = e.loc
  if (p.bodyHint) {
    const body = plain(l.body)
    const isBody = plain(l.name) === p.bodyHint
    if (isBody || body === p.bodyHint) {
      score += PTS_BODY
      ev.push({ kind: 'body', ok: true, points: PTS_BODY, text: `contract says ${titleCase(p.bodyHint)} ✓` })
    } else if (body) {
      score += PTS_BODY_BAD
      ev.push({ kind: 'body', ok: false, points: PTS_BODY_BAD, text: `contract says ${titleCase(p.bodyHint)}, ${l.name} is on ${l.body} ✗` })
    }
  }
  if (p.systemHint) {
    const sys = sysKey(l.system)
    if (sys && sys === sysKey(p.systemHint)) {
      score += PTS_SYSTEM
      ev.push({ kind: 'system', ok: true, points: PTS_SYSTEM, text: `system ${titleCase(p.systemHint)} ✓` })
    } else if (sys) {
      score += PTS_SYSTEM_BAD
      ev.push({ kind: 'system', ok: false, points: PTS_SYSTEM_BAD, text: `contract says ${titleCase(p.systemHint)}, ${l.name} is in ${l.system} ✗` })
    }
  }
  let markerM: number | undefined
  if (marker && e.hasCoords) {
    markerM = dist(l, marker)
    const d = shortDist(markerM)
    if (markerM <= MARKER_NEAR_M) {
      score += PTS_MARKER_NEAR
      ev.push({ kind: 'marker', ok: true, points: PTS_MARKER_NEAR, text: `game marker ${d} away ✓` })
    } else if (markerM > MARKER_FAR_M) {
      score += PTS_MARKER_FAR
      ev.push({ kind: 'marker', ok: false, points: PTS_MARKER_FAR, text: `game marker ${d} away ✗` })
    } else ev.push({ kind: 'marker', ok: true, points: 0, text: `game marker ${d} away` })
  }
  if (ctx.here && e.hasCoords && hasXYZ(ctx.here) && dist(l, ctx.here) <= HERE_M) {
    score += PTS_HERE
    ev.push({ kind: 'here', ok: true, points: PTS_HERE, text: 'you are here ✓' })
  }
  return { e, score, nameKind: n.kind, ...(n.partOf ? { partOf: true } : {}), evidence: ev, ...(markerM != null ? { markerM } : {}) }
}

const titleCase = (s: string): string => s.replace(/\b[a-z]/g, (c) => c.toUpperCase())

const toCandidate = (s: Scored): Candidate => ({
  name: s.e.loc.name,
  score: s.score,
  hasCoords: s.e.hasCoords,
  system: s.e.loc.system ?? null,
  body: s.e.loc.body ?? null
})

function locPoint(l: Location): GeoPoint {
  return { x: l.x!, y: l.y!, z: l.z!, system: l.system ?? null, body: l.body ?? null }
}

/** marker point with body/system from the nearest roster place (within NEAR_MAX_M), and that place as `near` */
function markerPlace(marker: GeoPoint, locations: Location[]): { point: GeoPoint; near?: { name: string; meters: number } } {
  let nearest: { l: Location; d: number } | undefined
  let bodied: { l: Location; d: number } | undefined
  for (const l of locations) {
    if (!hasXYZ(l)) continue
    const d = dist(l, marker)
    if (d > NEAR_MAX_M) continue
    if (!nearest || d < nearest.d) nearest = { l, d }
    if (l.body && (!bodied || d < bodied.d)) bodied = { l, d }
  }
  const point: GeoPoint = bodied
    ? { ...marker, body: marker.body ?? bodied.l.body ?? null, system: marker.system ?? bodied.l.system ?? null }
    : marker
  return { point, ...(nearest ? { near: { name: nearest.l.name, meters: nearest.d } } : {}) }
}

interface Weighed {
  scored: Scored[]
  winner?: Scored
  accepted: boolean
}

function weigh(raw: string, ctx: ResolveCtx, mk?: GeoPoint): Weighed {
  const p = parsePlace(raw)
  const rawLower = raw.toLowerCase()
  const scored: Scored[] = []
  if (raw) {
    for (const e of rosterEntries(ctx.locations)) {
      const s = scoreEntry(p, rawLower, e, ctx, mk)
      if (s) scored.push(s)
    }
  }
  // highest score first; ties: with coords, then the stronger name evidence, then roster order
  const nameRank = { exact: 0, key: 1, contains: 2, token: 3 }
  scored.sort((a, b) => b.score - a.score || Number(b.e.hasCoords) - Number(a.e.hasCoords) || nameRank[a.nameKind] - nameRank[b.nameKind])
  const winner = scored.find((s) => s.e.hasCoords)
  const second = winner ? scored.find((s) => s !== winner) : undefined
  const accepted = !!winner && winner.score >= ACCEPT_SCORE && (!second || winner.score - second.score >= ACCEPT_GAP)
  return { scored, ...(winner ? { winner } : {}), accepted }
}

/** place phrases a contract text names: "Collect X from A. Deliver X to B" -> A, B */
function phrases(label: string): string[] {
  const out: string[] = []
  for (const part of label.split(/\.\s+/)) {
    const m = /\b(?:from|to|at)\s+(?:the\s+)?(.+?)\.?$/i.exec(part.trim())
    if (m) out.push(m[1].trim())
  }
  return out
}

/** the roster place a generic site belongs to: a place named elsewhere in the contract that wins clearly, within 25 km of the marker */
function contractParent(raw: string, related: string[], jobTexts: string[], ctx: ResolveCtx, mk?: GeoPoint): { loc: Location; meters: number | null } | undefined {
  const own = placeKey(raw)
  const hint = parsePlace(raw).bodyHint
  const found = new Map<Location, number | null>()
  // without a marker only the step's own text counts: another step's place (J74's pickup) is often elsewhere
  for (const t of mk ? [...related, ...jobTexts] : related) {
    if (!t?.trim() || placeKey(t) === own) continue
    const w = weigh(t.trim(), { locations: ctx.locations, useMarker: false })
    if (!w.accepted || !w.winner) continue
    const loc = w.winner.e.loc
    if (hint && plain(loc.body) && plain(loc.body) !== hint && plain(loc.name) !== hint) continue
    const meters = mk ? dist(loc, mk) : null
    if (meters != null && meters > NEAR_MAX_M) continue
    found.set(loc, meters)
  }
  const list = [...found.entries()].map(([loc, meters]) => ({ loc, meters }))
  if (!list.length) return undefined
  if (mk) return list.sort((a, b) => a.meters! - b.meters!)[0]
  // no marker: only when the contract names one place
  return list.length === 1 ? list[0] : undefined
}

/**
 * resolve a place text; `marker` = the objective marker for this place, if any. For a generic site:
 * `related` = other place texts of the same step (label phrases, pickup), `jobTexts` = the job's other
 * steps' places (used only with a marker, which must be within 25 km of the place)
 */
export function resolvePlaceText(text: string, ctx: ResolveCtx, marker?: GeoPoint, related: string[] = [], jobTexts: string[] = []): StopPlace {
  const raw = (text ?? '').trim()
  const mk: GeoPoint | undefined =
    ctx.useMarker && marker && hasXYZ(marker) ? { x: marker.x, y: marker.y, z: marker.z, system: marker.system ?? null, body: marker.body ?? null } : undefined
  const { scored, winner, accepted } = weigh(raw, ctx, mk)
  const candidates = scored.slice(0, 5).map(toCandidate)

  const evidence: Evidence[] = []
  const lead = winner ?? scored[0]
  if (lead) evidence.push(...lead.evidence)
  const other = lead ? scored.find((s) => s !== lead) : undefined
  if (other) evidence.push({ kind: 'name', ok: false, points: 0, text: `runner-up ${other.e.loc.name} (score ${other.score})` })

  const base = { text: raw, candidates }
  const fromMarker = (status: MatchStatus, confidence: number, extra: Evidence[] = []): StopPlace => {
    const m = markerPlace(mk!, ctx.locations)
    const nearTxt = m.near ? `, near ${m.near.name} (${shortDist(m.near.meters)})` : ''
    return {
      ...base,
      label: raw,
      point: m.point,
      source: 'marker',
      status,
      confidence,
      evidence: [...evidence, ...extra, { kind: 'marker', ok: true, points: 0, text: `measured to the game marker${nearTxt}` }],
      ...(m.near ? { near: m.near } : {})
    }
  }

  if (accepted && winner) {
    if (mk && winner.markerM != null && winner.markerM > MARKER_FAR_M) return fromMarker('mismatch', 4)
    const status: MatchStatus = winner.nameKind === 'exact' ? 'exact' : winner.nameKind === 'key' ? 'corrected' : 'guess'
    const confidence = Math.max(0, Math.min(10, winner.score) - (status === 'guess' ? 2 : 0))
    return {
      ...base,
      label: winner.e.loc.name,
      match: winner.e.loc,
      point: locPoint(winner.e.loc),
      source: 'roster',
      status,
      confidence,
      evidence
    }
  }
  // the contract's label names the place in full ("Deakins Research" -> "Deakins Research Outpost on Yela")
  const ownKey = placeKey(raw)
  if (ownKey.length >= 4) {
    for (const t of related) {
      const k = placeKey(t)
      if (k === ownKey || !containsWords(k, ownKey)) continue
      const w = weigh(t.trim(), ctx, mk)
      if (!w.accepted || !w.winner || (w.winner.nameKind !== 'exact' && w.winner.nameKind !== 'key')) continue
      if (mk && w.winner.markerM != null && w.winner.markerM > MARKER_FAR_M) continue
      const loc = w.winner.e.loc
      return {
        ...base,
        candidates: w.scored.slice(0, 5).map(toCandidate),
        label: loc.name,
        match: loc,
        point: locPoint(loc),
        source: 'roster',
        status: 'corrected',
        confidence: Math.min(10, w.winner.score),
        evidence: [{ kind: 'name', ok: true, points: 0, text: `contract names it in full: ${t.trim()}` }, ...w.winner.evidence]
      }
    }
  }
  // the text is part of one place's name ("Deakins Research"), nothing else scores and nothing disagrees: a guess, never shown as correct
  if (
    winner &&
    winner.nameKind === 'contains' &&
    winner.partOf &&
    winner.score >= PTS_CONTAINS &&
    !scored.some((s) => s !== winner && s.score > 0) &&
    !winner.evidence.some((e) => !e.ok || e.points < 0)
  ) {
    return {
      ...base,
      label: winner.e.loc.name,
      match: winner.e.loc,
      point: locPoint(winner.e.loc),
      source: 'roster',
      status: 'guess',
      confidence: 3,
      evidence: [{ kind: 'name', ok: true, points: 0, text: `only one place fits: ${winner.e.loc.name} (partial name)` }, ...evidence]
    }
  }
  const strong = scored.filter((s) => s.score >= ACCEPT_SCORE).length
  // a generic site (no roster place by this name): it belongs to the place the contract names, else the one by the marker
  const generic = !scored.length && !!raw && isGenericSite(raw)
  const parent = generic ? contractParent(raw, related, jobTexts, ctx, mk) : undefined
  if (mk) {
    const why: Evidence[] = !scored.length ? [{ kind: 'name', ok: false, points: 0, text: 'no roster place by this name' }] : []
    if (parent) {
      const site: StopSite = { name: parent.loc.name, meters: parent.meters, from: 'contract' }
      why.push({ kind: 'name', ok: true, points: 0, text: `site at ${parent.loc.name}, named in the contract (${shortDist(parent.meters!)} from the marker)` })
      const out = fromMarker('marker', 8, why)
      return { ...out, site }
    }
    const out = fromMarker('marker', 8, why)
    return generic && out.near ? { ...out, site: { name: out.near.name, meters: out.near.meters, from: 'marker' } } : out
  }
  if (parent) {
    const name = parent.loc.name
    return {
      ...base,
      label: raw,
      match: parent.loc,
      point: locPoint(parent.loc),
      source: 'roster',
      status: 'guess',
      confidence: 5,
      evidence: [
        { kind: 'name', ok: false, points: 0, text: 'no roster place by this name' },
        { kind: 'marker', ok: false, points: 0, text: `no game marker: using ${name}, named in the contract` }
      ],
      site: { name, meters: null, from: 'contract' }
    }
  }
  if (!scored.length && raw) evidence.push({ kind: 'name', ok: false, points: 0, text: 'no roster place by this name' })
  if (strong >= 2) return { ...base, label: raw, source: null, status: 'unsure', confidence: 2, evidence }
  return { ...base, label: raw, source: null, status: 'none', confidence: 0, evidence }
}

/** true while the step's next place is a pickup not yet collected (same rule as otherNext.stepIsPickup) */
const isPickup = (step: OtherStep): boolean => !!step.pickupLocation && !step.pickedUp && !step.done

/** place texts a step names: its label phrases and places */
function stepTexts(s: OtherStep): string[] {
  return [s.pickupLocation, s.pickupLocationRaw, s.location, s.locationRaw, ...phrases(s.label ?? '')].filter((t): t is string => !!t?.trim())
}

/**
 * The step's active place, resolved. step.position belongs to the step's own objective place
 * (step.location), so while the pickup of a combined step is open there is no marker for it.
 * `job` (its steps) lets a generic site find the place the contract names.
 */
export function resolveStopPlace(step: OtherStep, ctx: ResolveCtx, job?: { steps: OtherStep[] }): StopPlace {
  const pickup = isPickup(step)
  const text = pickup ? step.pickupLocation! : step.location || step.label || ''
  const marker = !pickup && step.position && hasXYZ(step.position) ? { ...step.position, system: null, body: null } : undefined
  const others = (job?.steps ?? []).filter((s) => s !== step && s.id !== step.id).flatMap(stepTexts)
  return resolvePlaceText(text, ctx, marker, [...new Set(stepTexts(step))], [...new Set(others)])
}

const WORDS: Record<MatchStatus, string> = {
  exact: '✓ exact',
  corrected: '≈ corrected',
  marker: '📍 game marker',
  guess: '? guess',
  mismatch: '⚠ mismatch',
  unsure: '? not sure',
  none: '✗ not found'
}

export function matchWord(status: MatchStatus): string {
  return WORDS[status]
}
