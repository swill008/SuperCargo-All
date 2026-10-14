// Rebuilds data/uex/other-positions.json: named starmap places (outposts,
// research/mining sites, aid shelters, landing zones, stations) with
// system-frame coords, so Other mode can place UEX outposts the haul cache lacks.
// Same frame as locations.json (both read scunpacked starmap_positions x/y/z).
// node scripts/gen-other-positions.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT = path.join(ROOT, 'data', 'uex', 'other-positions.json')
const URL_ = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/starmap_positions.json'

const SKIP_TYPES = new Set(['Asteroid', 'Star', 'unknown', 'NavPoint', 'JumpPoint'])
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

// generic or internal names, not places a player would type
function usableName(n) {
  if (!n || n.includes('<=') || n.includes('~')) return false
  if (n === n.toLowerCase()) return false
  if (/mission location$/i.test(n) || /^contested zone$/i.test(n)) return false
  return true
}

// UEX shortens some names ("Deakins Research" for "Deakins Research Outpost")
function aliasesFor(name) {
  const out = new Set()
  const short = name.replace(/\s+(Outpost|Facility)$/i, '')
  if (short !== name) out.add(short)
  return [...out]
}

const res = await fetch(URL_, { headers: { Accept: 'application/json' } })
if (!res.ok) throw new Error(`starmap: HTTP ${res.status}`)
const entities = (await res.json()).entities || []
const byUuid = new Map(entities.map((e) => [e.uuid, e]))

function bodyOf(e) {
  let p = byUuid.get(e.parent_uuid)
  for (let i = 0; p && i < 10; i++) {
    if (p.type === 'Planet' || p.type === 'Moon') return p.name
    p = byUuid.get(p.parent_uuid)
  }
  return undefined
}

// names seen more than once in a system are ambiguous; drop them
const count = new Map()
for (const e of entities) {
  const k = `${norm(e.name)}|${e.system}`
  count.set(k, (count.get(k) || 0) + 1)
}

const places = []
for (const e of entities) {
  const name = String(e.name || '').trim()
  if (SKIP_TYPES.has(e.type) || !usableName(name)) continue
  if (typeof e.x !== 'number' || typeof e.y !== 'number' || typeof e.z !== 'number') continue
  if (count.get(`${norm(name)}|${e.system}`) > 1) continue
  const aliases = aliasesFor(name)
  const body = bodyOf(e)
  places.push({
    name,
    ...(aliases.length ? { aliases } : {}),
    system: e.system,
    ...(body ? { body } : {}),
    x: e.x,
    y: e.y,
    z: e.z
  })
}
places.sort((a, b) => a.name.localeCompare(b.name) || a.system.localeCompare(b.system))

fs.writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'scunpacked-data starmap_positions.json', places }, null, 2) + '\n'
)
console.log(`wrote ${places.length} places to ${path.relative(ROOT, OUT)}`)
