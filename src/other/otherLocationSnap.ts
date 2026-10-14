/**
 * Other-mode location snap.
 * Unique UEX name only. Log and OCR both call this so one sentence
 * cannot become two different stops.
 */
import type { Location } from '@shared/types'
import { isSystemDestination } from '@shared/contract'
import { splitLogAddress } from '@shared/logLocation'

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** CIG pad addresses. Other-only; haul splitLogAddress stays stock. */
function stripLagrangeFlavor(raw: string): string {
  return raw
    .replace(/\s+at\s+(?:the\s+)?[A-Za-z][\w']*'s\s+L[1-5]\s+Lagrange\s+point\.?$/i, '')
    .replace(/\s+at\s+the\s+L[1-5]\s+Lagrange\s+of\s+.+$/i, '')
    .replace(/^(?:an?\s+)?landing\s+pad\s+locker\s+in\s+/i, '')
    .trim()
}

export type OtherLocationSnap = {
  location: string
  locationRaw: string
  locationSnapped: boolean
}

export function snapOtherLocation(raw: string, locations: Location[]): OtherLocationSnap {
  const locationRaw = raw.replace(/\s+/g, ' ').replace(/[:.]+$/, '').trim()
  if (!locationRaw) return { location: '', locationRaw: '', locationSnapped: false }
  if (isSystemDestination(locationRaw)) {
    return { location: locationRaw, locationRaw, locationSnapped: false }
  }
  if (/patrol\s+coordinates/i.test(locationRaw)) {
    return { location: locationRaw, locationRaw, locationSnapped: false }
  }
  if (!locations.length) {
    return { location: locationRaw, locationRaw, locationSnapped: false }
  }

  const { name: culled } = splitLogAddress(locationRaw)
  const stripped = stripLagrangeFlavor(locationRaw)
  const candidates = [locationRaw, culled, stripped].filter((s, i, a) => s && a.indexOf(s) === i)

  for (const cand of candidates) {
    const exact = locations.filter((l) => l.name.toLowerCase() === cand.toLowerCase())
    if (exact.length === 1) {
      return {
        location: exact[0].name,
        locationRaw,
        locationSnapped: exact[0].name !== locationRaw
      }
    }
  }

  const hitsFor = (cand: string): Location[] => {
    const n = norm(cand)
    if (n.length < 8) return []
    const esc = cand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // "Reclamation and Disposal in Lorville" is a place inside Lorville, not Lorville itself
    const subPlace = new RegExp(`\\b(in|on|at|near|above|of)\\s+(the\\s+)?${esc}$`, 'i')
    return locations.filter((l) => {
      const ln = norm(l.name)
      const lc = norm(l.code || '')
      if (ln === n || (lc && lc === n)) return true
      if (ln.length > n.length && ln.includes(n) && subPlace.test(l.name.trim())) return false
      if (ln.length >= 8 && (ln.includes(n) || n.includes(ln))) return true
      if (lc.length >= 6 && (n.includes(lc) || lc.includes(n))) return true
      return false
    })
  }

  for (const cand of candidates) {
    const hits = hitsFor(cand)
    if (hits.length === 1 && hits[0].name !== locationRaw) {
      return { location: hits[0].name, locationRaw, locationSnapped: true }
    }
  }

  const cleaned = stripped || locationRaw
  return { location: cleaned, locationRaw, locationSnapped: false }
}

// ---- OCR-tolerant snap ----------------------------------------------------------------

/** "CRU-LS5" / "CRU-LS" / "CRU-I5" -> "CRU-L5": OCR reads the Lagrange digit as S or adds one. */
export function fixOcrLagrangeCodes(raw: string): string {
  return raw
    .replace(/\b([A-Za-z]{3})\s*-\s*[LI1|]\s*[S5]?\s*([1-5])\b/g, (_m, b: string, n: string) => `${b.toUpperCase()}-L${n}`)
    .replace(/\b([A-Za-z]{3})\s*-\s*[LI1|]\s*S\b/g, (_m, b: string) => `${b.toUpperCase()}-L5`)
}

// words every station / port name shares; they never decide a match
const GENERIC = new Set([
  'station', 'spaceport', 'outpost', 'research', 'facility', 'mining', 'point', 'the', 'and', 'from',
  'near', 'int', 'port', 'city', 'landing', 'pad', 'locker', 'zone', 'area', 'center', 'centre',
  'plaza', 'hub', 'base', 'depot', 'site', 'system'
])

// S<->5, O<->0, l<->1<->I; rn<->m is tried as a second form
const ocrCanon = (t: string): string => t.replace(/0/g, 'o').replace(/5/g, 's').replace(/[1i|]/g, 'l')
const ocrForms = (t: string): string[] => {
  const a = ocrCanon(t)
  const b = a.replace(/rn/g, 'm')
  return a === b ? [a] : [a, b]
}

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function tokenMatch(rawTok: string, locTok: string): boolean {
  for (const r of ocrForms(rawTok)) {
    for (const l of ocrForms(locTok)) {
      if (r === l) return true
      // a word whose start OCR lost: "dern" -> "modern"
      if (r.length >= 4 && l.length > r.length && r.length >= l.length * 0.6 && (l.endsWith(r) || l.startsWith(r))) return true
      if (Math.min(r.length, l.length) >= 5 && within1(r, l)) return true
    }
  }
  return false
}

const tokens = (s: string): string[] => norm(s).split(' ').filter((t) => t.length >= 3)

/** best roster place for a junk-laden OCR name, or null when not unique and confident */
function ocrTokenMatch(raw: string, locations: Location[]): Location | null {
  const rawToks = tokens(raw)
  if (!rawToks.length) return null
  let best: { loc: Location; score: number; cover: number } | null = null
  let tie = false
  for (const loc of locations) {
    const own = tokens(loc.name).filter((t) => !GENERIC.has(t))
    if (!own.length) continue
    const matched = own.filter((t) => rawToks.some((r) => tokenMatch(r, t)))
    const score = matched.length
    const cover = score / own.length
    const ok = (score >= 2 && cover >= 0.6) || (cover === 1 && matched.every((t) => t.length >= 5))
    if (!ok) continue
    if (!best || score > best.score || (score === best.score && cover > best.cover)) {
      best = { loc, score, cover }
      tie = false
    } else if (score === best.score && cover === best.cover && loc.name !== best.loc.name) {
      tie = true
    }
  }
  return best && !tie ? best.loc : null
}

/**
 * Same snap as the log path, made tolerant of OCR misreads (letter/digit swaps,
 * "CRU-LS5", a lost word start, junk words). locationRaw keeps the OCR text as read.
 * Only a unique confident match is taken; otherwise the log snap's result stands.
 */
export function snapOtherLocationOcr(raw: string, locations: Location[]): OtherLocationSnap {
  const locationRaw = raw.replace(/\s+/g, ' ').replace(/[:.]+$/, '').trim()
  if (!locationRaw) return { location: '', locationRaw: '', locationSnapped: false }
  const fixed = fixOcrLagrangeCodes(locationRaw)
  const plain = snapOtherLocation(fixed, locations)
  const inRoster = (name: string): boolean => locations.some((l) => l.name.toLowerCase() === name.toLowerCase())
  // snapped means "a roster name other than what OCR read", as on the log path
  const done = (location: string): OtherLocationSnap => ({
    location,
    locationRaw,
    locationSnapped: location !== locationRaw && inRoster(location)
  })
  if (!locations.length || isSystemDestination(fixed) || /patrol\s+coordinates/i.test(fixed)) return done(plain.location)
  if (inRoster(plain.location)) return done(plain.location)
  const hit = ocrTokenMatch(fixed, locations)
  return done(hit ? hit.name : plain.location)
}

/** Real New Objective lines from Stacie's Game.logs (2026-09-12). */
export const OTHER_LOCATION_SNAP_CASES: Array<{
  raw: string
  expect: string
  snapped: boolean
}> = [
  { raw: 'Everus Harbor', expect: 'Everus Harbor', snapped: false },
  { raw: 'Baijini Point', expect: 'Baijini Point', snapped: false },
  { raw: 'Port Tressler', expect: 'Port Tressler', snapped: false },
  { raw: 'Seraphim Station', expect: 'Seraphim Station', snapped: false },
  { raw: 'Hickes Research Outpost', expect: 'Hickes Research Outpost', snapped: false },
  { raw: 'NB Int. Spaceport', expect: 'NB Int. Spaceport', snapped: false },
  { raw: 'Shubin Mining Facility SM0-18', expect: 'Shubin Mining Facility SM0-18', snapped: false },
  { raw: 'Shubin Mining Facility SAL-5', expect: 'Shubin Mining Facility SAL-5', snapped: false },
  { raw: 'MIC-L5 Modern Icarus Station', expect: 'MIC-L5 Modern Icarus Station', snapped: false },
  { raw: "Red Crossroads Station at microTech's L4 Lagrange point", expect: 'MIC-L4 Red Crossroads Station', snapped: true },
  { raw: 'MIC-L4 Red Crossroads Station', expect: 'MIC-L4 Red Crossroads Station', snapped: false },
  { raw: 'Rayari Cantwell', expect: 'Rayari Cantwell Research Outpost', snapped: true },
  { raw: 'Rayari Cantwell Research Outpost', expect: 'Rayari Cantwell Research Outpost', snapped: false },
  { raw: 'Shubin SM0-18', expect: 'Shubin Mining Facility SM0-18', snapped: true },
  { raw: 'Rayari', expect: 'Rayari', snapped: false },
  { raw: 'Stanton System', expect: 'Stanton System', snapped: false },
  { raw: 'Pyro System', expect: 'Pyro System', snapped: false },
  { raw: 'Patrol Coordinates', expect: 'Patrol Coordinates', snapped: false },
  { raw: 'Keeger Belt Wreck Site', expect: 'Keeger Belt Wreck Site', snapped: false },
  { raw: 'Asteroid Mining Base', expect: 'Asteroid Mining Base', snapped: false },
  { raw: 'a Landing Pad Locker in New Babbage', expect: 'New Babbage', snapped: false },
  { raw: 'August Dunlow Spaceport', expect: 'August Dunlow Spaceport', snapped: false }
]

const loc = (name: string, code: string): Location => ({
  name, code, maxContainerSize: 32, uexId: 0, system: 'stanton'
})

export const OTHER_LOCATION_SNAP_ROSTER: Location[] = [
  loc('Everus Harbor', 'Everus Harbor'),
  loc('Baijini Point', 'Baijini Point'),
  loc('Port Tressler', 'Port Tressler'),
  loc('Seraphim Station', 'Seraphim Station'),
  loc('Hickes Research Outpost', 'Hickes Research'),
  loc('NB Int. Spaceport', 'NB Int. Spaceport'),
  loc('Shubin Mining Facility SM0-18', 'Shubin SM0-18'),
  loc('Shubin Mining Facility SAL-5', 'Shubin SAL-5'),
  loc('MIC-L5 Modern Icarus Station', 'MIC-L5'),
  loc('MIC-L4 Red Crossroads Station', 'MIC-L4'),
  loc('Rayari Cantwell Research Outpost', 'Rayari Cantwell'),
  loc('Rayari Deltana Research Outpost', 'Rayari Deltana'),
  loc('August Dunlow Spaceport', 'August Dunlow Spaceport')
]

export function checkOtherLocationSnapFixtures(): string[] {
  const failures: string[] = []
  for (const c of OTHER_LOCATION_SNAP_CASES) {
    const got = snapOtherLocation(c.raw, OTHER_LOCATION_SNAP_ROSTER)
    if (got.location !== c.expect || got.locationSnapped !== c.snapped) {
      failures.push(
        `"${c.raw}" → ${got.location} snapped=${got.locationSnapped} (want ${c.expect} snapped=${c.snapped})`
      )
    }
  }
  return failures
}
