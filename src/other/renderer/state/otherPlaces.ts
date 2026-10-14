/** Merge haul pad roster with Other UEX cities/stations/outposts. */
import { useMemo, useSyncExternalStore } from 'react'
import type { Location } from '@shared/types'
import { dlog } from '@renderer/state/log'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'

let extra: Location[] = []
let version = 0
const listeners = new Set<() => void>()

export function setOtherPlaces(list: Location[]): void {
  extra = Array.isArray(list) ? list : []
  version += 1
  for (const l of listeners) l()
}

/** bumps each time the Other places load or change, or a data source is switched */
export function otherPlacesVersion(): number {
  return version
}

// a data-source switch changes the merged roster: bump the version so version-keyed caches recompute too
let lastStarmap: boolean | undefined
useStore.subscribe((s) => {
  const on = otherSetting(s.settings, 'otherSourceStarmap') !== false
  if (lastStarmap === undefined) lastStarmap = on
  if (on === lastStarmap) return
  lastStarmap = on
  version += 1
  dlog.info('other', 'data source switched', { starmap: on })
  for (const l of listeners) l()
})

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** haul roster + Other places; recomputes when either changes (Other places load from main after first render)
 *  or when the starmap data-source switch flips */
export function useMergedLocations(): Location[] {
  const haul = useStore((s) => s.locations)
  const starmap = useStore((s) => otherSetting(s.settings, 'otherSourceStarmap'))
  const v = useSyncExternalStore(subscribe, () => version)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeLocations(haul ?? []), [haul, v, starmap])
}

/** the starmap data-source switch (Settings → DATA SOURCES); UEX is always on */
export function starmapSourceOn(): boolean {
  return otherSetting(useStore.getState().settings, 'otherSourceStarmap') !== false
}

/** haul roster + Other places with the data-source switches applied */
export function mergeLocations(haul: Location[] | undefined): Location[] {
  return mergeLocationsWith(haul, extra, starmapSourceOn())
}

/** a place without what the starmap gave it: no x/y/z when they came from the starmap */
function withoutStarmapCoords(l: Location): Location {
  if (l.coordsFrom !== 'starmap') return l
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { x, y, z, coordsFrom, ...rest } = l
  return rest
}

/**
 * Pure merge: haul roster first (source UEX), then the Other places by name; a later entry only fills a place
 * that has no coords. starmap off: starmap-only places are dropped and starmap-filled coords are stripped.
 */
export function mergeLocationsWith(haul: Location[] | undefined, others: Location[], starmap: boolean): Location[] {
  const by = new Map<string, Location>()
  for (const l of haul ?? []) by.set(l.name.toLowerCase(), starmap ? l : withoutStarmapCoords(l))
  for (const raw of others) {
    if (!starmap && raw.source === 'starmap') continue
    const l = starmap ? raw : withoutStarmapCoords(raw)
    const k = l.name.toLowerCase()
    const prev = by.get(k)
    if (!prev) by.set(k, l)
    // the place keeps the source it was first listed under; only the coords (and their source) come from l
    else if (prev.x == null && l.x != null) by.set(k, { ...prev, ...l, source: prev.source })
    // same name with coords but no body (haul S4DC05): take the body from the other listing at the same spot
    else if (!prev.body && l.body && prev.x != null && l.x != null && l.y != null && l.z != null &&
      Math.hypot(prev.x - l.x, prev.y! - l.y, prev.z! - l.z) <= 1000)
      by.set(k, { ...prev, body: l.body, system: prev.system || l.system })
  }
  return fillMissingBody([...by.values()])
}

/** "Covalex Distribution Center S4DC05" (UEX, no body) and "...Centre S4DC05" (starmap, microTech): same place */
const spellingKey = (n: string): string => n.toLowerCase().replace(/centre/g, 'center').replace(/[^a-z0-9]+/g, '')

/**
 * A place with coords but no body takes the body (and system) of the same place under another spelling within 1 km,
 * so "on <Body>" in a contract can be checked against it.
 */
function fillMissingBody(list: Location[]): Location[] {
  const withBody = new Map<string, Location[]>()
  for (const l of list) {
    if (!l.body || l.x == null) continue
    const k = spellingKey(l.name)
    withBody.set(k, [...(withBody.get(k) ?? []), l])
  }
  return list.map((l) => {
    if (l.body || l.x == null || l.y == null || l.z == null) return l
    const twin = withBody
      .get(spellingKey(l.name))
      ?.find((o) => o !== l && Math.hypot(o.x! - l.x!, o.y! - l.y!, o.z! - l.z!) <= 1000)
    return twin ? { ...l, body: twin.body, system: l.system || twin.system } : l
  })
}

export interface SourceCounts {
  /** UEX: haul roster + UEX cities/stations/outposts */
  uex: { places: number; withCoords: number }
  /** bundled starmap positions: places it adds, coordinates it fills on UEX places */
  starmap: { adds: number; fills: number }
}

/** what each data source contributes (counted with every source on, so a switched-off source still shows its size) */
export function sourceCounts(haul: Location[] | undefined, others: Location[] = extra): SourceCounts {
  const all = mergeLocationsWith(haul, others, true)
  const out: SourceCounts = { uex: { places: 0, withCoords: 0 }, starmap: { adds: 0, fills: 0 } }
  for (const l of all) {
    if (l.source === 'starmap') {
      out.starmap.adds += 1
      continue
    }
    out.uex.places += 1
    if (l.x == null) continue
    if (l.coordsFrom === 'starmap') out.starmap.fills += 1
    else out.uex.withCoords += 1
  }
  return out
}

/** why a place is off: 'place' = only listed by a source that is off; 'coords' = still listed but its
 *  coordinates came from a source that is off (the resolver needs coords, so it is ignored either way) */
export type OffSource = 'place' | 'coords'

/** lower-case place names that a switched-off source took away (empty when every source is on) */
export function offSourcePlaces(haul: Location[] | undefined, others: Location[] = extra, starmap = starmapSourceOn()): Map<string, OffSource> {
  const off = new Map<string, OffSource>()
  if (starmap) return off
  const now = new Map(mergeLocationsWith(haul, others, false).map((l) => [l.name.toLowerCase(), l]))
  for (const l of mergeLocationsWith(haul, others, true)) {
    const k = l.name.toLowerCase()
    const cur = now.get(k)
    if (!cur) off.set(k, 'place')
    else if (l.x != null && cur.x == null) off.set(k, 'coords')
  }
  return off
}

export async function loadOtherPlacesFromMain(): Promise<Location[]> {
  const list = (await window.supercargo.getOtherPlaces?.()) ?? []
  setOtherPlaces(list)
  dlog.debug('other', 'places loaded from main', { count: list.length })
  return extra
}
