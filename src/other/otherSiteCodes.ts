/**
 * Star Citizen Wiki game data (scunpacked-data): internal location codes -> display names.
 * trade_locations.json maps codes like DC_Stan_Covalex_S1_S1DC06_FOB to "Security Compound"; each site
 * gets the parent place it sits in (the longest code prefix whose name is a real place), so a generic
 * stop ("Security Compound") can be checked against the place the contract names.
 * Pure: the builders run in scripts/gen-site-codes.mjs and main/gameData.ts; the lookups run on the
 * table set with setSiteCodes (empty until then).
 */
import { isGenericSite, placeKey } from './otherResolve'

export interface SiteCode {
  /** internal code (trade_locations ClassName), e.g. DC_Stan_Covalex_S1_S1DC06_FOB */
  code: string
  /** display name, e.g. "Security Compound" */
  name: string
  /** the place this site belongs to (absent: the site is a place of its own) */
  parentCode?: string
  parentName?: string
}

export interface SiteCodesDoc {
  generatedAt: string
  sites: SiteCode[]
}

/** Settings → DATA SOURCES game-data row; also the otherGameData:get reply (with the table) */
export interface GameDataStatus {
  sites: number
  positions: number
  source: 'bundled' | 'downloaded'
  /** generatedAt of the table in use ('' when unknown) */
  updatedAt: string
  /** last update's failure, cleared by the next good update */
  error?: string
}

/** otherGameData:get / :update reply and evt:other:gameData payload */
export interface GameDataReply extends GameDataStatus {
  siteCodes: SiteCodesDoc
}

export interface SiteParent {
  code: string
  name: string
}

/** one place from starmap_positions (same shape as data/uex/other-positions.json places) */
export interface StarmapPlace {
  name: string
  aliases?: string[]
  system: string
  body?: string
  x: number
  y: number
  z: number
}

export interface StarmapPositionsDoc {
  generatedAt: string
  source: string
  places: StarmapPlace[]
}

// ---------------------------------------------------------------------------------------------
// builders (pure)

/** names the game uses inside many places (rooms, zones, hangars): never a parent */
const GENERIC_EXTRA =
  /^(?:lobby|exterior zone \d+|hangar \d+|maintenance area[- ]?\d*|inventory center|shipping area|security checkpoint|staging point|on-call area|supply room|abandoned section|trading post|outpost (?:warehouse|storage shed|depot|landing area|main building))$/i

/** a display name that is a template or internal text, not a place name */
function templateName(n: string): boolean {
  return !n || n.includes('~') || n.includes('<=') || n === n.toLowerCase()
}

/** a display name that can't be a parent place (generic room/zone, "the X inside Y", template) */
function genericName(n: string): boolean {
  return templateName(n) || GENERIC_EXTRA.test(n.trim()) || /\binside\b/i.test(n) || isGenericSite(n)
}

/** a name used as its own place at this many unrelated codes is a template ("Windfall", "Caterpillar") */
const TEMPLATE_ROOTS = 3

const codeKey = (c: string): string => c.toLowerCase()
/** placeKey without a leading "the" ("the Security Compound" = "Security Compound") */
const nameKey = (n: string): string => placeKey(n).replace(/^the /, '')

/**
 * site table from trade_locations.json (array of { ClassName, DisplayName, Disabled? }): entries with a
 * real display name; parent = longest '_' prefix whose entry's name is a real (non-generic) place.
 * Generic children (FOB = Security Compound, Storehouse, ...) are kept with their parent.
 */
export function buildSiteCodes(trade: unknown, generatedAt = new Date().toISOString()): SiteCodesDoc {
  const list = Array.isArray(trade) ? trade : []
  const named = new Map<string, { code: string; name: string }>()
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const r = e as { ClassName?: unknown; DisplayName?: unknown; Disabled?: unknown }
    if (typeof r.ClassName !== 'string' || typeof r.DisplayName !== 'string') continue
    if (r.Disabled === true) continue
    const name = r.DisplayName.trim()
    const code = r.ClassName.trim()
    if (!code || templateName(name)) continue
    named.set(codeKey(code), { code, name })
  }

  const nearestNamed = (code: string, ok: (n: string) => boolean): { code: string; name: string } | undefined => {
    const parts = code.split('_')
    for (let i = parts.length - 1; i > 0; i--) {
      const hit = named.get(codeKey(parts.slice(0, i).join('_')))
      if (hit && ok(hit.name)) return hit
    }
    return undefined
  }

  // names that stand as their own place at several unrelated codes are templates
  const roots = new Map<string, number>()
  for (const s of named.values()) {
    const up = nearestNamed(s.code, () => true)
    if (up && up.name === s.name) continue
    roots.set(s.name, (roots.get(s.name) ?? 0) + 1)
  }
  const realPlace = (n: string): boolean => !genericName(n) && (roots.get(n) ?? 0) < TEMPLATE_ROOTS

  const sites: SiteCode[] = []
  for (const s of named.values()) {
    const parent = nearestNamed(s.code, realPlace)
    sites.push(parent ? { code: s.code, name: s.name, parentCode: parent.code, parentName: parent.name } : { code: s.code, name: s.name })
  }
  sites.sort((a, b) => a.code.localeCompare(b.code))
  return { generatedAt, sites }
}

const SKIP_TYPES = new Set(['Asteroid', 'Star', 'unknown', 'NavPoint', 'JumpPoint'])
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

function usableStarmapName(n: string): boolean {
  if (!n || n.includes('<=') || n.includes('~')) return false
  if (n === n.toLowerCase()) return false
  if (/mission location$/i.test(n) || /^contested zone$/i.test(n)) return false
  return true
}

/**
 * named starmap places from starmap_positions.json ({ entities }), same rules as
 * scripts/gen-other-positions.mjs: skip stars/asteroids/nav points, internal names and names seen
 * twice in a system; body = nearest Planet/Moon ancestor; "X Outpost"/"X Facility" also as alias "X".
 */
export function buildStarmapPlaces(starmap: unknown, generatedAt = new Date().toISOString()): StarmapPositionsDoc {
  const raw = (starmap as { entities?: unknown } | null)?.entities
  const entities = (Array.isArray(raw) ? raw : []).filter((e) => e && typeof e === 'object') as Array<{
    uuid?: string
    name?: string
    type?: string
    system?: string
    parent_uuid?: string | null
    x?: number
    y?: number
    z?: number
  }>
  const byUuid = new Map(entities.map((e) => [e.uuid, e]))
  const bodyOf = (e: (typeof entities)[number]): string | undefined => {
    let p = byUuid.get(e.parent_uuid ?? undefined)
    for (let i = 0; p && i < 10; i++) {
      if (p.type === 'Planet' || p.type === 'Moon') return p.name
      p = byUuid.get(p.parent_uuid ?? undefined)
    }
    return undefined
  }
  const count = new Map<string, number>()
  for (const e of entities) {
    const k = `${norm(String(e.name ?? ''))}|${e.system}`
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const places: StarmapPlace[] = []
  for (const e of entities) {
    const name = String(e.name ?? '').trim()
    if (SKIP_TYPES.has(String(e.type)) || !usableStarmapName(name)) continue
    if (typeof e.x !== 'number' || typeof e.y !== 'number' || typeof e.z !== 'number') continue
    if (typeof e.system !== 'string') continue
    if ((count.get(`${norm(name)}|${e.system}`) ?? 0) > 1) continue
    const short = name.replace(/\s+(Outpost|Facility)$/i, '')
    const body = bodyOf(e)
    places.push({
      name,
      ...(short !== name ? { aliases: [short] } : {}),
      system: e.system,
      ...(body ? { body } : {}),
      x: e.x,
      y: e.y,
      z: e.z
    })
  }
  places.sort((a, b) => a.name.localeCompare(b.name) || a.system.localeCompare(b.system))
  return { generatedAt, source: 'scunpacked-data starmap_positions.json', places }
}

/** a parsed site-codes file, or null when the shape is wrong */
export function normalizeSiteCodesDoc(j: unknown): SiteCodesDoc | null {
  const o = j as { generatedAt?: unknown; sites?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.sites)) return null
  const sites: SiteCode[] = []
  for (const s of o.sites) {
    if (!s || typeof s.code !== 'string' || typeof s.name !== 'string') continue
    const out: SiteCode = { code: s.code, name: s.name }
    if (typeof s.parentCode === 'string' && typeof s.parentName === 'string') {
      out.parentCode = s.parentCode
      out.parentName = s.parentName
    }
    sites.push(out)
  }
  return { generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : '', sites }
}

// ---------------------------------------------------------------------------------------------
// lookups on the current table

interface SiteIndex {
  doc: SiteCodesDoc
  byCode: Map<string, SiteCode>
  /** placeKey(child name) -> parents having a site with that name */
  parentsByName: Map<string, SiteParent[]>
  /** placeKey(name) -> the site that is a place of its own by that name */
  placesByName: Map<string, SiteParent>
  /** lower-cased code tokens per site, for panel-style codes */
  tokens: Array<{ site: SiteCode; set: Set<string> }>
}

function buildIndex(doc: SiteCodesDoc): SiteIndex {
  const byCode = new Map<string, SiteCode>()
  const parentsByName = new Map<string, SiteParent[]>()
  const placesByName = new Map<string, SiteParent>()
  const tokens: SiteIndex['tokens'] = []
  for (const s of doc.sites) {
    byCode.set(codeKey(s.code), s)
    tokens.push({ site: s, set: new Set(s.code.toLowerCase().split('_')) })
    if (!s.parentCode && !genericName(s.name)) {
      const k = nameKey(s.name)
      if (k && !placesByName.has(k)) placesByName.set(k, { code: s.code, name: s.name })
    }
    if (!s.parentCode || !s.parentName || s.name === s.parentName) continue
    const k = nameKey(s.name)
    if (!k) continue
    const list = parentsByName.get(k) ?? []
    if (!list.some((p) => p.code === s.parentCode)) list.push({ code: s.parentCode, name: s.parentName })
    parentsByName.set(k, list)
  }
  return { doc, byCode, parentsByName, placesByName, tokens }
}

let index: SiteIndex = buildIndex({ generatedAt: '', sites: [] })

/** use this table for the lookups below */
export function setSiteCodes(doc: SiteCodesDoc): void {
  index = buildIndex(doc)
}

/** the table in use */
export function siteCodesDoc(): SiteCodesDoc {
  return index.doc
}

/** the site for an internal code (any case) */
export function siteByCode(code: string): SiteCode | undefined {
  return index.byCode.get(codeKey(code.trim()))
}

/** places that have a site with this display name ("Security Compound" -> Covalex S1DC06, ...) */
export function sitesNamed(name: string): SiteParent[] {
  return index.parentsByName.get(nameKey(name)) ?? []
}

/** the game data's place by this name (a site that is a place of its own), if the game data knows it */
export function gameDataPlace(name: string): SiteParent | undefined {
  return index.placesByName.get(nameKey(name))
}

/** the place a code belongs to: its parent, or the site itself when it is a place of its own */
export function parentForCode(code: string): SiteParent | undefined {
  const s = siteByCode(code)
  if (!s) return undefined
  if (s.parentCode && s.parentName) return { code: s.parentCode, name: s.parentName }
  return genericName(s.name) ? undefined : { code: s.code, name: s.name }
}

/** system/body tokens in panel codes ("Stanton1", "Pyro5a") say nothing about the site itself */
const SYSTEM_TOKEN = /^(?:stanton|pyro|nyx|terra|magnus)\d*[a-z]?$/
/** a distinctive code token: letters and digits ("s1dc06", "sm018"), not a system/body token */
const codeToken = (t: string): boolean => /[a-z]/.test(t) && /\d/.test(t) && !SYSTEM_TOKEN.test(t)

/**
 * a panel-style code ("Stanton1_DistributionCentre_Covalex_S1DC06") -> the trade code with the most
 * tokens in common that has every distinctive token; ties go to the shortest code (the place itself);
 * no unique best -> undefined
 */
export function tradeCodeForPanel(code: string): string | undefined {
  const want = code.toLowerCase().split('_').filter(Boolean)
  const must = want.filter(codeToken)
  if (!must.length) return undefined
  let best: SiteCode | undefined
  let bestScore = 0
  let tie = false
  for (const { site, set } of index.tokens) {
    if (!must.every((t) => set.has(t))) continue
    const score = want.filter((t) => set.has(t)).length * 100 - set.size
    if (score > bestScore) {
      best = site
      bestScore = score
      tie = false
    } else if (score === bestScore && best && best.code !== site.code) tie = true
  }
  return best && !tie ? best.code : undefined
}

/** the text without a "[CODE]" part ("Security Compound [DC_..._FOB]" -> "Security Compound") */
export function stripCode(text: string): string {
  return (text ?? '').replace(/\s*\[[A-Za-z][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)+\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

const BRACKET_CODE = /\[([A-Za-z][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)+)\]/
const BARE_CODE = /(?:^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+){2,})(?![A-Za-z0-9_])/

/**
 * an internal code in a text: "[DC_Stan_Covalex_S1_S1DC06_FOB]" or a bare
 * "Stanton1_DistributionCentre_Covalex_S1DC06"; returned as the trade code when the table knows it (or
 * can map the panel style to it), else as found; undefined when the text has no code
 */
export function codeFromText(text: string): string | undefined {
  if (!text) return undefined
  const m = BRACKET_CODE.exec(text) ?? BARE_CODE.exec(text)
  if (!m) return undefined
  const found = m[1]
  const known = siteByCode(found)
  if (known) return known.code
  return tradeCodeForPanel(found) ?? found
}
