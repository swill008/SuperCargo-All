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
 * UEX roster by the one code table (otherSiteCodes.placeForCode); unknown codes (Pyro, outposts, roster gaps like New Babbage) give null rather
 * than a guess. "Entered ... Jurisdiction / Monitored Space", ATC and quantum lines carry no usable
 * name. Stale: once you leave (Location hash changes away), `current` is null; `last` keeps the
 * last station, which can be hours old. One log of 7 (a 13-minute session) had no location at all.
 */
import type { Location } from '@shared/types'
import { placeForCode } from './otherSiteCodes'

const RE_REQUEST = /requested inventory for Location\[([^\]]+)\]/
const RE_MOVE = /is changing location\. Landing \[(\d+)\] -> \[(\d+)\]\. Location \[(\d+)\] -> \[(\d+)\]/

/** stateless: the roster name a single line places the player at, or null */
export function currentLocationFromLine(line: string, locations: Location[]): string | null {
  if (line.indexOf('requested inventory for Location[') < 0) return null
  const m = RE_REQUEST.exec(line)
  return m ? (placeForCode(m[1], locations)?.name ?? null) : null
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
