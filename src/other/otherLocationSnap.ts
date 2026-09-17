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
    return locations.filter((l) => {
      const ln = norm(l.name)
      const lc = norm(l.code || '')
      if (ln === n || (lc && lc === n)) return true
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
