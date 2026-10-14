/**
 * One stop-place resolver. Weighs the evidence for every roster place (name, the address's body and
 * system, the game's objective marker, where you are) and returns one answer per stop that every
 * screen, the route sort and diagnostics read. Pure: no React, no store.
 */
import type { Location } from '@shared/types'
import { splitLogAddress } from '@shared/logLocation'
import type { OtherStep } from '@other/otherJob'
import type { GeoPoint } from './otherGeo'
import type { MemoryEntry } from './otherMemory'
import { learnedPlace, memoryKey, memoryLabel } from './otherMemory'
import { codeFromText, gameDataPlace, parentForCode, siteByCode, sitesNamed, stripCode } from './otherSiteCodes'

export type MatchStatus = 'exact' | 'corrected' | 'marker' | 'guess' | 'mismatch' | 'unsure' | 'none' | 'user' | 'learned'

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
  /** match-memory key for this stop: generic site -> memoryKey(text, site parent or ''), else memoryKey(text) */
  memoryKey: string
  /** set when a match-memory entry was used */
  memory?: StopMemory
}

export interface StopMemory {
  origin: MemoryEntry['origin']
  label: string
  disputed?: boolean
  wrongAt?: MemoryEntry['wrongAt']
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
  /** match memory lookup by memoryKey */
  memory?: (key: string) => MemoryEntry | undefined
}

/** how far a marker point may be from a roster place to be called "near" it */
export const NEAR_MAX_M = 25_000

// scoring (contract 8)
const PTS_EXACT = 6
const PTS_KEY = 5
const PTS_CLOSE = 4
const PTS_NEAR_SPELLING = 3
const PTS_CONTAINS = 3
const PTS_TOKEN = 2
const PTS_BODY = 2
const PTS_BODY_BAD = -6
const PTS_SYSTEM = 1
const PTS_SYSTEM_BAD = -6
const PTS_MARKER_NEAR = 4
const PTS_MARKER_FAR = -5
const PTS_HERE = 2
/** game data (scunpacked site codes): the contract's place has / lacks a site by this name */
const PTS_GAME_SITE = 2
const CONF_GAME_CODE = 10
const PTS_LEARNED = 4
const PTS_WRONG = -4
const WRONG_MIN = 2
const CONF_USER = 10
const CONF_DISPUTED = 6
const MARKER_NEAR_M = 2_000
const MARKER_FAR_M = 10_000
const HERE_M = 1_000
const ACCEPT_SCORE = 5
const ACCEPT_GAP = 3

const SAME_PLACE_M = 1_000

// OCR typo matching (contract 9 T): weighted Damerau-Levenshtein similarity on confusion-folded keys
const SIM_CLOSE = 0.9
const SIM_NEAR = 0.82
const CLOSE_MIN_LEN = 8
const CONFUSION_COST = 0.3

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
  /** confusion-folded key (OCR look-alikes folded): see foldKey */
  fold: string
  /** code tokens (any token with a digit, e.g. S1DC06, CRU-L5, SAL-2), confusion-folded and sorted */
  codes: string
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
  return { key, fold: foldKey(name), codes: codeTokens(name), name, ...(bodyHint ? { bodyHint } : {}), ...(systemHint ? { systemHint } : {}) }
}

/** OCR look-alikes in every word (on lower case, before the word split): rn -> m, vv -> w, cl -> d, '|' -> l */
const foldAllWords = (s: string): string => s.toLowerCase().replace(/\|/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd')

/** inside a word with a digit: S -> 5, B -> 8, Z -> 2, G -> 6 (after foldWord's O -> 0, I/l -> 1) */
const foldDigitWord = (w: string): string => {
  const f = foldWord(w)
  return /\d/.test(f) ? f.replace(/s/g, '5').replace(/b/g, '8').replace(/z/g, '2').replace(/g/g, '6') : f
}

/** confusion-folded key: placeKey plus the OCR look-alike folds; two names with the same fold read the same to OCR */
function foldKey(name: string): string {
  return words(foldAllWords(name)).map(foldDigitWord).join(' ')
}

/** designators that tell sibling places apart without a digit: roman numerals, single letters, greek letters */
const DESIGNATOR = /^(?:[ivx]+|[a-z]|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|omega|sigma|tau)$/

/**
 * code tokens: words with a digit ("S1DC06", the "l5" of CRU-L5, the "2" of SAL-2, "141") and designators
 * ("Farro Data Center IX", "Complex-A", "Station Delta"), folded, sorted, joined. Two names whose code
 * tokens differ are different places however close the rest reads.
 */
function codeTokens(name: string): string {
  return words(foldAllWords(name))
    .filter((t) => /\d/.test(t) || DESIGNATOR.test(t))
    .map(foldDigitWord)
    .sort()
    .join(' ')
}

const CONFUSABLE = new Set(['o0', 'i1', 'l1', 'il', 's5', 'b8', 'z2', 'g6'])
const confusable = (a: string, b: string): boolean => CONFUSABLE.has(a + b) || CONFUSABLE.has(b + a)

/** weighted Damerau-Levenshtein (optimal string alignment) similarity, 0-1: OCR confusion pairs cost 0.3, other edits 1 */
export function spellingSimilarity(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (!n || !m) return n === m ? 1 : 0
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : confusable(a[i - 1], b[j - 1]) ? CONFUSION_COST : 1
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1)
      d[i][j] = v
    }
  }
  return 1 - d[n][m] / Math.max(n, m)
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
  /** confusion-folded key and code tokens of the chosen spelling */
  fold: string
  codes: string
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
    if (!same) {
      const nm = parsePlace(l.name).name
      list.push({ loc: l, names: [l.name.toLowerCase()], key, fold: foldKey(nm), codes: codeTokens(nm), hasCoords: coords })
    }
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
  nameKind: 'exact' | 'key' | 'close' | 'contains' | 'token'
  /** containment with the text inside the roster name (a shortened name), not the other way */
  partOf?: boolean
  evidence: Evidence[]
  markerM?: number
}

type NameHit = { pts: number; kind: Scored['nameKind']; text: string; partOf?: boolean }

/** " · from starmap data" when the place (or its coordinates) came from the bundled starmap file */
function sourceNote(l: Location): string {
  const s = l as Location & { source?: string; coordsFrom?: string }
  return s.source === 'starmap' || s.coordsFrom === 'starmap' ? ' · from starmap data' : ''
}

function nameEvidence(p: Parsed, rawLower: string, e: RosterEntry, spelling = true): NameHit | null {
  const hit = nameHit(p, rawLower, e, spelling)
  return hit ? { ...hit, text: hit.text + sourceNote(e.loc) } : null
}

/** close spelling on the folded keys; code tokens must agree (S1DC06 never matches S4DC05) */
function closeSpelling(p: Parsed, e: RosterEntry): NameHit | null {
  if (!p.fold || !e.fold || p.codes !== e.codes) return null
  const len = Math.max(p.fold.length, e.fold.length)
  // a length gap alone already puts it under the lowest band
  if (Math.abs(p.fold.length - e.fold.length) > (1 - SIM_NEAR) * len) return null
  const sim = spellingSimilarity(p.fold, e.fold)
  if (sim >= SIM_CLOSE && e.fold.length >= CLOSE_MIN_LEN) return { pts: PTS_CLOSE, kind: 'close', text: `close spelling: ${e.loc.name}` }
  if (sim >= SIM_NEAR) return { pts: PTS_NEAR_SPELLING, kind: 'close', text: `similar spelling: ${e.loc.name}` }
  return null
}

function nameHit(p: Parsed, rawLower: string, e: RosterEntry, spelling: boolean): NameHit | null {
  const shown = e.loc.name
  if (e.names.includes(rawLower) || e.names.includes(p.name.toLowerCase())) return { pts: PTS_EXACT, kind: 'exact', text: `name exact: ${shown}` }
  if (!p.key) return null
  if (e.key === p.key) return { pts: PTS_KEY, kind: 'key', text: `name corrected: "${p.name}" = ${shown}` }
  if (p.fold && e.fold === p.fold) return { pts: PTS_KEY, kind: 'key', text: `name corrected (OCR look-alikes): "${p.name}" = ${shown}` }
  let best: NameHit | null = null
  const shorter = e.key.length <= p.key.length ? e.key : p.key
  if (shorter.length >= 4 && (containsWords(p.key, e.key) || containsWords(e.key, p.key)))
    best = { pts: PTS_CONTAINS, kind: 'contains', text: `name partly matches: ${shown}`, partOf: containsWords(e.key, p.key) }
  if (!best) {
    const mine = new Set(p.key.split(' ').filter(distinctive))
    const shared = e.key.split(' ').find((w) => mine.has(w))
    if (shared) best = { pts: PTS_TOKEN, kind: 'token', text: `shares code ${shared.toUpperCase()}: ${shown}` }
  }
  const close = spelling ? closeSpelling(p, e) : null
  return close && (!best || close.pts > best.pts) ? close : best
}

/** match-memory evidence for one roster place (by name); `add` makes it a candidate without name points */
interface Adjust {
  place: string
  points: number
  text: string
  add?: boolean
}

const adjFor = (e: RosterEntry, adj: Adjust[]): Adjust[] => adj.filter((a) => e.names.includes(a.place.toLowerCase()))

function scoreEntry(p: Parsed, rawLower: string, e: RosterEntry, ctx: ResolveCtx, marker?: GeoPoint, adj: Adjust[] = [], spelling = true): Scored | null {
  const mine = adjFor(e, adj)
  const n = nameEvidence(p, rawLower, e, spelling) ?? (mine.some((a) => a.add) ? { pts: 0, kind: 'token' as const, text: `no name match: ${e.loc.name}` } : null)
  if (!n) return null
  const ev: Evidence[] = n.pts ? [{ kind: 'name', ok: true, points: n.pts, text: n.text }] : []
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
  for (const a of mine) {
    score += a.points
    ev.push({ kind: 'name', ok: a.points > 0, points: a.points, text: a.text })
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

function weigh(raw: string, ctx: ResolveCtx, mk?: GeoPoint, adj: Adjust[] = []): Weighed {
  const p = parsePlace(raw)
  const rawLower = raw.toLowerCase()
  const scored: Scored[] = []
  if (raw) {
    const entries = rosterEntries(ctx.locations)
    // spelling similarity is the last name tier: only when no place has the name (exact, key or OCR-folded key)
    const named = entries.some((e) => e.names.includes(rawLower) || e.names.includes(p.name.toLowerCase()) || (!!p.key && (e.key === p.key || e.fold === p.fold)))
    for (const e of entries) {
      const s = scoreEntry(p, rawLower, e, ctx, mk, adj, !named)
      if (s) scored.push(s)
    }
  }
  // highest score first; ties: with coords, then the stronger name evidence, then roster order
  const nameRank = { exact: 0, key: 1, close: 2, contains: 3, token: 4 }
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
  // a "[CODE]" part (game data) is not part of the name
  const named = stripCode(raw)
  const generic = !!named && isGenericSite(named)
  const base = resolveCore(raw, ctx, mk, related, jobTexts)
  const key = generic ? memoryKey(named, base.site?.name ?? '') : memoryKey(named)
  const entry = ctx.memory?.(key)
  const learned = entry ? learnedPlace(entry) : null
  if (!entry) return { ...base, memoryKey: key }
  const memory: StopMemory = {
    origin: entry.origin,
    label: memoryLabel(entry),
    ...(entry.origin === 'user' && (entry.disputed || entry.wrong >= WRONG_MIN) ? { disputed: true } : {}),
    ...(entry.wrongAt?.length ? { wrongAt: entry.wrongAt } : {})
  }

  // the user's place wins outright (when the roster has it with coords)
  if (learned?.strength === 'user') {
    const want = learned.place.toLowerCase()
    const hit = rosterEntries(ctx.locations).find((e) => e.hasCoords && e.names.includes(want))
    if (hit) {
      const loc = hit.loc
      const disputed = !!memory.disputed
      const first: Evidence = {
        kind: 'name',
        ok: !disputed,
        points: 0,
        text: disputed ? `you set this; ⚠ the game disagrees ×${entry.wrong}` : 'you set this ✓'
      }
      const common = { text: raw, candidates: base.candidates, status: 'user' as const, confidence: disputed ? CONF_DISPUTED : CONF_USER, memoryKey: key, memory }
      if (generic) {
        // the user's place is the site; the marker still gives the point
        if (mk) {
          const m = markerPlace(mk, ctx.locations)
          const meters = dist(loc, mk)
          return {
            ...common,
            label: raw,
            point: m.point,
            source: 'marker',
            evidence: [first, { kind: 'marker', ok: true, points: 0, text: `measured to the game marker, at ${loc.name} (${shortDist(meters)})` }],
            ...(m.near ? { near: m.near } : {}),
            site: { name: loc.name, meters, from: 'contract' }
          }
        }
        return { ...common, label: raw, match: loc, point: locPoint(loc), source: 'roster', evidence: [first], site: { name: loc.name, meters: null, from: 'contract' } }
      }
      return { ...common, label: loc.name, match: loc, point: locPoint(loc), source: 'roster', evidence: [first, ...base.evidence] }
    }
    return { ...base, memoryKey: key }
  }

  // game memory: +4 for a learned place, -4 for a place the game showed wrong
  if (entry.origin !== 'game' || !entry.place) return { ...base, memoryKey: key }
  const adj: Adjust[] = []
  if (learned?.strength === 'learned')
    adj.push({ place: learned.place, points: PTS_LEARNED, text: `learned: game confirmed ×${entry.confirmed}`, add: !generic })
  if (entry.wrong >= WRONG_MIN) adj.push({ place: entry.place, points: PTS_WRONG, text: `the game showed this was wrong ×${entry.wrong}` })
  if (!adj.length) return { ...base, memoryKey: key }
  const out = resolveCore(raw, ctx, mk, related, jobTexts, adj)
  const used = rosterEntries(ctx.locations).some((e) => adjFor(e, adj).length && out.candidates.some((c) => c.name === e.loc.name))
  const res: StopPlace = { ...out, memoryKey: key, ...(used ? { memory } : {}) }
  if (learned?.strength === 'learned' && out.source === 'roster' && out.match && out.status !== 'mismatch') {
    const won = out.match.name.toLowerCase() === learned.place.toLowerCase() || rosterEntries(ctx.locations).some((e) => e.loc === out.match && e.names.includes(learned.place.toLowerCase()))
    const score = out.candidates.find((c) => c.name === out.match!.name)?.score
    if (won && score != null) return { ...res, status: 'learned', confidence: Math.max(0, Math.min(10, score)) }
  }
  return res
}

type CorePlace = Omit<StopPlace, 'memoryKey' | 'memory'>

/** the roster place nearest a marker (within NEAR_MAX_M), by name */
function fromMarkerNear(mk: GeoPoint, ctx: ResolveCtx): string | undefined {
  return markerPlace(mk, ctx.locations).near?.name
}

/**
 * game data: does the place `parent` have a site named `site`? +2 when the game data lists one there,
 * -2 when the game data knows the place and it has none; nothing when the game data doesn't know the site
 * name (or the game data source is off: the table is empty then)
 */
function gameSiteEvidence(site: string, parent: string): Evidence | undefined {
  const parents = sitesNamed(site)
  if (!parents.length) return undefined
  const k = placeKey(parent)
  if (parents.some((p) => placeKey(p.name) === k)) return { kind: 'name', ok: true, points: PTS_GAME_SITE, text: `game data: ${parent} has a ${site} ✓` }
  if (!gameDataPlace(parent)) return undefined
  return { kind: 'name', ok: false, points: -PTS_GAME_SITE, text: `game data: ${parent} has no ${site}` }
}

const clampConf = (n: number): number => Math.max(0, Math.min(10, n))

/** a text carrying a game code ("Security Compound [DC_Stan_Covalex_S1_S1DC06_FOB]"): the code's place, exactly */
function fromGameCode(raw: string, ctx: ResolveCtx, mk: GeoPoint | undefined): CorePlace | undefined {
  const code = codeFromText(raw)
  const parent = code ? parentForCode(code) : undefined
  if (!code || !parent) return undefined
  const w = weigh(parent.name, { locations: ctx.locations, useMarker: false })
  const win = w.winner
  if (!win || !win.e.hasCoords || (win.nameKind !== 'exact' && win.nameKind !== 'key')) return undefined
  const loc = win.e.loc
  const site = siteByCode(code)
  const text = stripCode(raw) || site?.name || parent.name
  const first: Evidence = { kind: 'name', ok: true, points: 0, text: `game code ${code} ✓` }
  const candidates = w.scored.slice(0, 5).map(toCandidate)
  const isSite = !!site && placeKey(site.name) !== placeKey(parent.name)
  if (!isSite) return { text: raw, candidates, label: loc.name, match: loc, point: locPoint(loc), source: 'roster', status: 'exact', confidence: CONF_GAME_CODE, evidence: [first] }
  if (mk) {
    const m = markerPlace(mk, ctx.locations)
    const meters = dist(loc, mk)
    return {
      text: raw,
      candidates,
      label: text,
      point: m.point,
      source: 'marker',
      status: 'marker',
      confidence: CONF_GAME_CODE,
      evidence: [first, { kind: 'marker', ok: true, points: 0, text: `measured to the game marker, at ${loc.name} (${shortDist(meters)})` }],
      ...(m.near ? { near: m.near } : {}),
      site: { name: loc.name, meters, from: 'contract' }
    }
  }
  return { text: raw, candidates, label: text, match: loc, point: locPoint(loc), source: 'roster', status: 'exact', confidence: CONF_GAME_CODE, evidence: [first], site: { name: loc.name, meters: null, from: 'contract' } }
}

function resolveCore(raw: string, ctx: ResolveCtx, mk: GeoPoint | undefined, related: string[], jobTexts: string[], adj: Adjust[] = []): CorePlace {
  const coded = fromGameCode(raw, ctx, mk)
  if (coded) return coded
  const { scored, winner, accepted } = weigh(raw, ctx, mk, adj)
  const candidates = scored.slice(0, 5).map(toCandidate)

  const evidence: Evidence[] = []
  const lead = winner ?? scored[0]
  if (lead) evidence.push(...lead.evidence)
  const other = lead ? scored.find((s) => s !== lead) : undefined
  if (other) evidence.push({ kind: 'name', ok: false, points: 0, text: `runner-up ${other.e.loc.name} (score ${other.score})` })

  const base = { text: raw, candidates }
  const fromMarker = (status: MatchStatus, confidence: number, extra: Evidence[] = []): CorePlace => {
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
      const game = gameSiteEvidence(raw, parent.loc.name)
      const out = fromMarker('marker', clampConf(8 + (game?.points ?? 0)), game ? [...why, game] : why)
      return { ...out, site }
    }
    const nearName = generic ? fromMarkerNear(mk, ctx) : undefined
    const nearGame = nearName ? gameSiteEvidence(raw, nearName) : undefined
    const out = fromMarker('marker', clampConf(8 + (nearGame?.points ?? 0)), nearGame ? [...why, nearGame] : why)
    return generic && out.near ? { ...out, site: { name: out.near.name, meters: out.near.meters, from: 'marker' } } : out
  }
  if (parent) {
    const name = parent.loc.name
    const game = gameSiteEvidence(raw, name)
    return {
      ...base,
      label: raw,
      match: parent.loc,
      point: locPoint(parent.loc),
      source: 'roster',
      status: 'guess',
      confidence: clampConf(5 + (game?.points ?? 0)),
      evidence: [
        { kind: 'name', ok: false, points: 0, text: 'no roster place by this name' },
        { kind: 'marker', ok: false, points: 0, text: `no game marker: using ${name}, named in the contract` },
        ...(game ? [game] : [])
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
  none: '✗ not found',
  user: '✓ you set',
  learned: '✓ learned'
}

export function matchWord(status: MatchStatus): string {
  return WORDS[status]
}
