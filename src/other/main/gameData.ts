/**
 * Star Citizen Wiki game data (scunpacked-data): site codes (trade_locations.json) and starmap
 * positions (starmap_positions.json). The app ships both (data/uex/site-codes.json,
 * data/uex/other-positions.json); "Update game data" downloads fresh copies into
 * userData/game-data/, which then win over the bundled ones (main/uex.ts reads
 * gameDataPositionsFile()).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import {
  buildSiteCodes,
  buildStarmapPlaces,
  normalizeSiteCodesDoc,
  setSiteCodes,
  type GameDataReply,
  type GameDataStatus,
  type SiteCodesDoc
} from '@other/otherSiteCodes'
import { logger } from '../../main/logger'

export const GAME_DATA_BASE = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master'
export const GAME_DATA_CREDIT = 'Star Citizen Wiki game data (scunpacked-data)'
const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024
/** fewer than this in a download means the file isn't what we expect */
const MIN_SITES = 50
const MIN_PLACES = 50

const SITES_FILE = 'site-codes.json'
const POSITIONS_FILE = 'other-positions.json'

export type { GameDataReply, GameDataStatus }

let loaded: { doc: SiteCodesDoc; positions: number; source: GameDataStatus['source'] } | null = null
let lastError: string | undefined
let updating: Promise<GameDataStatus> | null = null
const listeners = new Set<() => void>()

function userDir(): string {
  return path.join(app.getPath('userData'), 'game-data')
}

function bundledFile(name: string): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'data', 'uex', name),
    path.join(app.getAppPath(), 'data', 'uex', name),
    path.join(app.getAppPath(), '..', '..', 'data', 'uex', name)
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

function readJson(file: string | null): unknown {
  if (!file) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') logger.warn('other', 'game data file unreadable', { file: path.basename(file), error: (e as Error)?.message ?? String(e) })
    return null
  }
}

const placesCount = (j: unknown): number => {
  const p = (j as { places?: unknown } | null)?.places
  return Array.isArray(p) ? p.length : 0
}

function load(): NonNullable<typeof loaded> {
  if (loaded) return loaded
  const dir = userDir()
  const userSites = normalizeSiteCodesDoc(readJson(path.join(dir, SITES_FILE)))
  const userPositions = placesCount(readJson(path.join(dir, POSITIONS_FILE)))
  if (userSites && userSites.sites.length && userPositions) {
    loaded = { doc: userSites, positions: userPositions, source: 'downloaded' }
  } else {
    const doc = normalizeSiteCodesDoc(readJson(bundledFile(SITES_FILE))) ?? { generatedAt: '', sites: [] }
    loaded = { doc, positions: placesCount(readJson(bundledFile(POSITIONS_FILE))), source: 'bundled' }
  }
  setSiteCodes(loaded.doc)
  logger.info('other', 'game data loaded', { source: loaded.source, sites: loaded.doc.sites.length, positions: loaded.positions })
  return loaded
}

/** counts, where the data came from and when it was made */
export function getGameDataStatus(): GameDataStatus {
  const l = load()
  return {
    sites: l.doc.sites.length,
    positions: l.positions,
    source: l.source,
    updatedAt: l.doc.generatedAt,
    ...(lastError ? { error: lastError } : {})
  }
}

/** the site-codes table in use (for the renderer's lookups) */
export function getSiteCodes(): SiteCodesDoc {
  return load().doc
}

/** the downloaded positions file when there is one (main/uex.ts prefers it over the bundled copy) */
export function gameDataPositionsFile(): string | null {
  return load().source === 'downloaded' ? path.join(userDir(), POSITIONS_FILE) : null
}

/** called after an update replaced the tables (main/uex.ts drops its position cache) */
export function onGameDataUpdated(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** GET a JSON file: timeout, size cap, parsed */
async function fetchJson(file: string): Promise<unknown> {
  const url = `${GAME_DATA_BASE}/${file}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) throw new Error(`${file}: too large (${declared} bytes)`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error(`${file}: empty response`)
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        controller.abort()
        throw new Error(`${file}: too large (over ${MAX_BYTES} bytes)`)
      }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    logger.debug('net', 'game data fetch ok', { file, bytes: size, ms: Date.now() - t0 })
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${file}: not JSON`)
    }
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? `${file}: timed out or cut off` : ((e as Error)?.message ?? String(e))
    throw new Error(msg)
  } finally {
    clearTimeout(timer)
  }
}

/** write to a temp file, then rename over the old one */
function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data) + '\n')
  fs.renameSync(tmp, file)
}

async function runUpdate(): Promise<GameDataStatus> {
  try {
    const [trade, starmap] = await Promise.all([fetchJson('trade_locations.json'), fetchJson('starmap_positions.json')])
    if (!Array.isArray(trade)) throw new Error('trade_locations.json: expected an array')
    if (!Array.isArray((starmap as { entities?: unknown } | null)?.entities)) throw new Error('starmap_positions.json: expected { entities: [...] }')
    const at = new Date().toISOString()
    const sites = buildSiteCodes(trade, at)
    const positions = buildStarmapPlaces(starmap, at)
    if (sites.sites.length < MIN_SITES) throw new Error(`trade_locations.json: only ${sites.sites.length} sites`)
    if (positions.places.length < MIN_PLACES) throw new Error(`starmap_positions.json: only ${positions.places.length} places`)
    const dir = userDir()
    fs.mkdirSync(dir, { recursive: true })
    writeAtomic(path.join(dir, POSITIONS_FILE), positions)
    writeAtomic(path.join(dir, SITES_FILE), { ...sites, source: `${GAME_DATA_CREDIT} trade_locations.json` })
    loaded = { doc: sites, positions: positions.places.length, source: 'downloaded' }
    setSiteCodes(sites)
    lastError = undefined
    logger.info('other', 'game data updated', { sites: sites.sites.length, positions: positions.places.length })
    for (const fn of listeners) {
      try {
        fn()
      } catch (e) {
        logger.warn('other', 'game data listener failed', { error: (e as Error)?.message ?? String(e) })
      }
    }
  } catch (e) {
    lastError = (e as Error)?.message ?? String(e)
    logger.warn('other', 'game data update failed', { error: lastError })
  }
  return getGameDataStatus()
}

/** "Update game data": download both files, rebuild, save under userData/game-data (one at a time) */
export function updateGameData(): Promise<GameDataStatus> {
  if (!updating) updating = runUpdate().finally(() => (updating = null))
  return updating
}

/** status + the site table (renderer lookups) */
export function getGameDataReply(): GameDataReply {
  return { ...getGameDataStatus(), siteCodes: getSiteCodes() }
}

let bound = false

/** IPC: otherGameData:get, otherGameData:update (both -> GameDataReply); every update broadcasts evt:other:gameData */
export function registerOtherGameDataIpc(): void {
  if (bound) return
  bound = true
  ipcMain.handle(IPC.otherGameDataGet, () => getGameDataReply())
  ipcMain.handle(IPC.otherGameDataUpdate, async () => {
    await updateGameData()
    const reply = getGameDataReply()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherGameData, reply)
    return reply
  })
}
