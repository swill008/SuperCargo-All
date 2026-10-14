/** Merge haul pad roster with Other UEX cities/stations/outposts. */
import { useMemo, useSyncExternalStore } from 'react'
import type { Location } from '@shared/types'
import { dlog } from '@renderer/state/log'
import { useStore } from '@renderer/state/store'

let extra: Location[] = []
let version = 0
const listeners = new Set<() => void>()

export function setOtherPlaces(list: Location[]): void {
  extra = Array.isArray(list) ? list : []
  version += 1
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** haul roster + Other places; recomputes when either changes (Other places load from main after first render) */
export function useMergedLocations(): Location[] {
  const haul = useStore((s) => s.locations)
  const v = useSyncExternalStore(subscribe, () => version)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeLocations(haul ?? []), [haul, v])
}

export function mergeLocations(haul: Location[] | undefined): Location[] {
  const by = new Map<string, Location>()
  for (const l of haul ?? []) by.set(l.name.toLowerCase(), l)
  for (const l of extra) {
    const k = l.name.toLowerCase()
    const prev = by.get(k)
    if (!prev) by.set(k, l)
    else if (prev.x == null && l.x != null) by.set(k, { ...prev, ...l })
  }
  return [...by.values()]
}

export async function loadOtherPlacesFromMain(): Promise<Location[]> {
  const list = (await window.supercargo.getOtherPlaces?.()) ?? []
  setOtherPlaces(list)
  dlog.debug('other', 'places loaded from main', { count: list.length })
  return extra
}
