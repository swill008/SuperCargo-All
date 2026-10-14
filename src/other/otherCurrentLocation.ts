/**
 * Other-mode "where am I" from Game.log, to pre-fill STARTING AT until the user sets one.
 *
 * Reliability (7 real logs, 2026-09-26..10-14): the only line that names the player's place is
 * `<RequestLocationInventory> Player[..] requested inventory for Location[<code>]`. All 36 of them
 * fired while the player stood in that place (36/36 agree with the preceding
 * `<Update Inventory Location> ... Landing [h] -> [h]. Location [x] -> [h]` arrival), so no false
 * positives. It fires 0-25 s after arriving; 12 of 15 arrivals got one directly, the other 3 were
 * repeat visits to a place already seen that session, which the hash learned here covers (15/15).
 * Codes are internal (Stanton2_Orison, RR_CRU_L1, RR_CRU_LEO, Stanton4_NewBabbage) and map to the
 * UEX roster by table; unknown codes (Pyro, outposts, roster gaps like New Babbage) give null rather
 * than a guess. "Entered ... Jurisdiction / Monitored Space", ATC and quantum lines carry no usable
 * name. Stale: once you leave (Location hash changes away), `current` is null; `last` keeps the
 * last station, which can be hours old. One log of 7 (a 13-minute session) had no location at all.
 */
import type { Location } from '@shared/types'

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const RE_REQUEST = /requested inventory for Location\[([^\]]+)\]/
const RE_MOVE = /is changing location\. Landing \[(\d+)\] -> \[(\d+)\]\. Location \[(\d+)\] -> \[(\d+)\]/

const BODY: Record<string, string> = { HUR: 'HUR', CRU: 'CRU', ARC: 'ARC', MIC: 'MIC' }
const LEO: Record<string, string> = {
  HUR: 'Everus Harbor',
  CRU: 'Seraphim Station',
  ARC: 'Baijini Point',
  MIC: 'Port Tressler'
}
const CITY: Record<string, string> = {
  Stanton1_Lorville: 'Lorville',
  Stanton2_Orison: 'Orison',
  Stanton3_Area18: 'Area18',
  Stanton4_NewBabbage: 'New Babbage'
}

/** game location code -> roster name, or null when it isn't on the roster */
export function rosterNameForCode(code: string, locations: Location[]): string | null {
  const byName = (name: string): string | null =>
    locations.find((l) => norm(l.name) === norm(name))?.name ?? null
  const rr = /^RR_([A-Z]{3})_(L[1-5]|LEO)$/i.exec(code.trim())
  if (rr) {
    const body = BODY[rr[1].toUpperCase()]
    if (!body) return null
    if (rr[2].toUpperCase() === 'LEO') return byName(LEO[body])
    const want = norm(`${body}-${rr[2].toUpperCase()}`)
    return locations.find((l) => norm(l.code || '') === want)?.name ?? null
  }
  const city = CITY[code.trim()]
  return city ? byName(city) : null
}

/** stateless: the roster name a single line places the player at, or null */
export function currentLocationFromLine(line: string, locations: Location[]): string | null {
  if (line.indexOf('requested inventory for Location[') < 0) return null
  const m = RE_REQUEST.exec(line)
  return m ? rosterNameForCode(m[1], locations) : null
}

export type CurrentLocationTracker = {
  /** feed every Game.log line in order */
  push: (line: string) => void
  /** roster name while the player is inside a known place, else null */
  current: () => string | null
  /** last place seen this session, even after leaving (may be stale) */
  last: () => string | null
}

/** learns inventory-hash -> name per session so repeat arrivals resolve without a request line */
export function createCurrentLocationTracker(locations: Location[]): CurrentLocationTracker {
  const names = new Map<string, string>()
  let here = '0'
  let cur: string | null = null
  let last: string | null = null
  return {
    push(line) {
      if (line.indexOf('is changing location.') >= 0) {
        const m = RE_MOVE.exec(line)
        if (!m) return
        here = m[4]
        cur = m[2] !== '0' && m[2] === here ? (names.get(here) ?? null) : null
        if (cur) last = cur
        return
      }
      const name = currentLocationFromLine(line, locations)
      if (!name) return
      if (here !== '0') names.set(here, name)
      cur = name
      last = name
    },
    current: () => cur,
    last: () => last
  }
}
