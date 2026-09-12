/** Merge haul pad roster with Other UEX cities/stations/outposts. */
import type { Location } from '@shared/types'

let extra: Location[] = []

export function setOtherPlaces(list: Location[]): void {
  extra = Array.isArray(list) ? list : []
}

export function getOtherPlacesCached(): Location[] {
  return extra
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
  return extra
}
