/**
 * Other-mode place book: UEX cities, stations, outposts.
 * Cached under userData. Does not change haul terminalsToLocations.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Location } from '@shared/types'
import { logger } from '../../main/logger'

const FILE = 'other-uex-places.json'
const BASE = 'https://api.uexcorp.space/2.0'

const CITY_PAD: Record<string, string> = {
  'new babbage': 'Port Tressler',
  area18: 'Baijini Point',
  lorville: 'Everus Harbor',
  orison: 'Orison',
  'grim hex': 'Grim HEX',
  grimhex: 'Grim HEX'
}

type UexRow = {
  id?: number
  name?: string
  nickname?: string
  code?: string
  star_system_name?: string | null
  planet_name?: string | null
  moon_name?: string | null
  orbit_name?: string | null
  is_visible?: number
}

function cacheFile(): string {
  return path.join(app.getPath('userData'), FILE)
}

function asLoc(row: UexRow): Location | null {
  const name = String(row.name || row.nickname || '').trim()
  if (!name) return null
  if (row.is_visible === 0) return null
  return {
    name,
    code: String(row.code || row.nickname || '').trim(),
    maxContainerSize: 0,
    uexId: Number(row.id) || 0,
    hasElevator: false,
    system: String(row.star_system_name || '').toLowerCase() || undefined,
    body: String(row.moon_name || row.planet_name || row.orbit_name || '') || undefined
  }
}

async function pull(resource: string): Promise<UexRow[]> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/${resource}`)
  logger.info('net', 'uex places fetch', { host: new URL(BASE).host, path: `/2.0/${resource}`, status: res.status, ms: Date.now() - t0 })
  if (!res.ok) throw new Error(`${resource} ${res.status}`)
  const json = (await res.json()) as { data?: UexRow[] }
  return Array.isArray(json.data) ? json.data : []
}

function attachCoords(places: Location[], haul: Location[]): Location[] {
  const byName = new Map(haul.map((l) => [l.name.toLowerCase(), l]))
  return places.map((p) => {
    const exact = byName.get(p.name.toLowerCase())
    if (exact?.x != null) return { ...p, x: exact.x, y: exact.y, z: exact.z, system: p.system || exact.system }
    const padName = CITY_PAD[p.name.toLowerCase()]
    const pad = padName ? byName.get(padName.toLowerCase()) : undefined
    if (pad?.x != null) return { ...p, x: pad.x, y: pad.y, z: pad.z, system: p.system || pad.system }
    const key = p.name.toLowerCase()
    for (const h of haul) {
      if (h.x == null) continue
      const n = h.name.toLowerCase()
      if (n.length >= 8 && (n.includes(key) || key.includes(n))) {
        return { ...p, x: h.x, y: h.y, z: h.z, system: p.system || h.system }
      }
    }
    return p
  })
}

type Pos = { name: string; aliases?: string[]; system: string; body?: string; x: number; y: number; z: number }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// bundled data/uex/other-positions.json (scripts/gen-other-positions.mjs)
let positions: Map<string, Pos[]> | null = null
function positionIndex(): Map<string, Pos[]> {
  if (positions) return positions
  positions = new Map()
  const candidates = [
    path.join(process.resourcesPath ?? '', 'data', 'uex', 'other-positions.json'),
    path.join(app.getAppPath(), 'data', 'uex', 'other-positions.json'),
    path.join(app.getAppPath(), '..', '..', 'data', 'uex', 'other-positions.json')
  ]
  const file = candidates.find((p) => fs.existsSync(p))
  if (!file) return positions
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { places?: Pos[] }
    const add = (k: string, p: Pos): void => {
      if (!k) return
      const list = positions!.get(k) ?? []
      list.push(p)
      positions!.set(k, list)
    }
    // names first, then aliases, so a name match wins over an alias
    for (const p of j.places ?? []) add(norm(p.name), p)
    for (const p of j.places ?? []) for (const a of p.aliases ?? []) if (!positions.has(norm(a))) add(norm(a), p)
  } catch (e) {
    logger.warn('other', 'other-positions.json unreadable', { error: (e as Error)?.message ?? String(e) })
  }
  return positions
}

// fill places the haul cache could not place from the bundled starmap positions
function fillFromPositions(places: Location[]): Location[] {
  const idx = positionIndex()
  if (!idx.size) return places
  return places.map((p) => {
    if (p.x != null) return p
    const hits = idx.get(norm(p.name))
    if (!hits) return p
    const hit = hits.find((h) => !p.system || h.system === p.system) ?? (hits.length === 1 && !p.system ? hits[0] : undefined)
    if (!hit) return p
    return { ...p, x: hit.x, y: hit.y, z: hit.z, system: p.system || hit.system, body: p.body || hit.body }
  })
}

function dedupe(list: Location[]): Location[] {
  const by = new Map<string, Location>()
  for (const l of list) {
    const k = l.name.toLowerCase()
    const prev = by.get(k)
    if (!prev || (prev.x == null && l.x != null)) by.set(k, l)
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function loadOtherPlaces(): Location[] {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as { places?: Location[] }
    return Array.isArray(j.places) ? fillFromPositions(j.places) : []
  } catch {
    return []
  }
}

export async function refreshOtherPlaces(haul: Location[]): Promise<Location[]> {
  try {
    const [cities, stations, outposts] = await Promise.all([
      pull('cities'),
      pull('space_stations'),
      pull('outposts')
    ])
    const mapped = [...cities, ...stations, ...outposts].map(asLoc).filter((x): x is Location => !!x)
    const places = dedupe(fillFromPositions(attachCoords(mapped, haul)))
    fs.writeFileSync(cacheFile(), JSON.stringify({ syncedAt: new Date().toISOString(), places }, null, 2))
    console.log(`[otherUex] cached ${places.length} cities/stations/outposts`)
    logger.info('other', 'places cached', { places: places.length, withCoords: places.filter((p) => p.x != null).length })
    return places
  } catch (e) {
    console.warn('[otherUex] refresh failed, using cache:', e)
    logger.warn('net', 'uex places refresh failed, using cache', { error: (e as Error)?.message ?? String(e) })
    return loadOtherPlaces()
  }
}
