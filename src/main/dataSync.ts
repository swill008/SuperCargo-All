// refresh bundled uex lists, no update

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { dataPath } from './paths'
import type { DataSyncResult, RefDataFileState, RefDataFileStatus, RefDataStatus } from '@shared/types'
import { logger } from './logger'

const RAW_BASE = 'https://raw.githubusercontent.com/AquatikJustice/SuperCargo/main/data/uex'
const STATUS_FILE = 'reference-data-status.json'
const FETCH_TIMEOUT_MS = 12000

const SPECS = [
  { repo: 'ships.json', cache: 'uex-vehicles.json', key: 'ships', label: 'Ships' },
  { repo: 'locations.json', cache: 'uex-locations.json', key: 'locations', label: 'Locations' },
  { repo: 'commodities.json', cache: 'uex-commodities.json', key: 'commodities', label: 'Commodities' },
  { repo: 'grid-faces.json', cache: 'uex-grid-faces.json', key: 'gridFaces', label: 'Cargo grids' },
  { repo: 'contract-overrides.json', cache: 'uex-contract-overrides.json', key: 'contractOverrides', label: 'Contract box sizes' }
] as const

function cachePath(file: string): string {
  return dataPath(file)
}

function seedDir(): string {
  const candidates = [
    path.join(process.resourcesPath, 'data', 'uex'),
    path.join(app.getAppPath(), 'data', 'uex'),
    path.join(app.getAppPath(), '..', '..', 'data', 'uex')
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// don't clobber a user-updated cache
export function seedCacheIfNeeded(): void {
  const dir = seedDir()
  for (const s of SPECS) {
    const dst = cachePath(s.cache)
    const src = path.join(dir, s.repo)
    try {
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        logger.info('net', 'data seeded (no cache)', { file: s.cache })
        continue
      }
      if (fs.statSync(src).mtimeMs <= fs.statSync(dst).mtimeMs) continue
      if (sha256(fs.readFileSync(src)) === sha256(fs.readFileSync(dst))) continue
      fs.copyFileSync(src, dst)
      logger.info('net', 'data seeded (bundled newer)', { file: s.cache })
    } catch (e) {
      console.warn(`[data] seed ${s.repo} failed:`, (e as Error).message)
      logger.warn('net', 'data seed failed', { file: s.repo, error: (e as Error).message })
    }
  }
}

// tests point this at a local dir (file:// or a plain path) or another http server
function rawBase(): string {
  return (process.env.SC_TEST_REFDATA_BASE || RAW_BASE).replace(/\/+$/, '')
}

function isRemote(base: string): boolean {
  return /^https?:\/\//i.test(base)
}

async function fetchText(url: string): Promise<string | null> {
  if (!isRemote(url)) {
    // test base only: a file:// url or a plain path
    try {
      const file = url.startsWith('file:') ? fileURLToPath(url) : url
      return fs.readFileSync(file, 'utf8')
    } catch (e) {
      logger.warn('net', 'data read failed (test base)', { error: (e as Error).message })
      return null
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const u = new URL(url)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) logger.warn('net', 'data fetch bad status', { host: u.host, path: u.pathname, status: res.status, ms: Date.now() - t0 })
    if (!res.ok) return null
    const text = await res.text()
    logger.debug('net', 'data fetch ok', { host: u.host, path: u.pathname, status: res.status, bytes: text.length, ms: Date.now() - t0 })
    return text
  } catch (e) {
    logger.warn('net', 'data fetch failed', { host: u.host, path: u.pathname, error: (e as Error).message, ms: Date.now() - t0 })
    return null
  } finally {
    clearTimeout(timer)
  }
}

const STATES: RefDataFileState[] = ['upToDate', 'updated', 'downloadFailed', 'hashMismatch', 'badFormat', 'notChecked']

// missing or unreadable file -> every file notChecked
export function loadRefDataStatus(): RefDataStatus {
  let saved: Partial<RefDataStatus> = {}
  try {
    const raw = JSON.parse(fs.readFileSync(dataPath(STATUS_FILE), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) saved = raw
  } catch {
    /* never checked yet */
  }
  const list = Array.isArray(saved.files) ? saved.files : []
  const files = SPECS.map((s): RefDataFileStatus => {
    const f = list.find((x) => x && x.key === s.key)
    if (f && STATES.includes(f.state) && typeof f.at === 'number') {
      return { key: s.key, label: s.label, state: f.state, at: f.at, ...(typeof f.detail === 'string' ? { detail: f.detail } : {}) }
    }
    return { key: s.key, label: s.label, state: 'notChecked', at: 0 }
  })
  return {
    checkedAt: typeof saved.checkedAt === 'number' ? saved.checkedAt : null,
    reached: saved.reached === true,
    source: rawBase(),
    files
  }
}

// IPC refDataGet
export function refDataStatus(): RefDataStatus {
  return loadRefDataStatus()
}

let broadcastFn: ((s: RefDataStatus) => void) | null = null
// index.ts passes a fn that sends IPC.evtRefData to every window
export function setRefDataBroadcast(fn: ((s: RefDataStatus) => void) | null): void {
  broadcastFn = fn
}

function saveAndTell(status: RefDataStatus): void {
  try {
    fs.writeFileSync(dataPath(STATUS_FILE), JSON.stringify(status, null, 2))
  } catch (e) {
    logger.warn('net', 'data status save failed', { error: (e as Error).message })
  }
  const counts: Record<string, number> = {}
  for (const f of status.files) counts[f.state] = (counts[f.state] ?? 0) + 1
  logger.info('net', 'reference data checked', { reached: status.reached, ...counts })
  try {
    broadcastFn?.(status)
  } catch (e) {
    logger.warn('net', 'data status broadcast failed', { error: (e as Error).message })
  }
}

// reached=false means "couldn't check"
async function runRefresh(): Promise<DataSyncResult> {
  const now = Date.now()
  const base = rawBase()
  const mark = (s: (typeof SPECS)[number], state: RefDataFileState, detail: string): RefDataFileStatus => {
    if (state === 'downloadFailed' || state === 'hashMismatch' || state === 'badFormat') {
      logger.warn('net', 'reference data file not updated', { key: s.key, state, detail })
    }
    return { key: s.key, label: s.label, state, at: now, detail }
  }
  const failAll = (detail: string): DataSyncResult => {
    const status: RefDataStatus = { checkedAt: now, reached: false, source: base, files: SPECS.map((s) => mark(s, 'downloadFailed', detail)) }
    saveAndTell(status)
    return { reached: false, changed: false, updated: [], status }
  }

  const hashesText = await fetchText(`${base}/hashes.json`)
  if (!hashesText) return failAll("couldn't reach the list")
  let hashes: Record<string, string>
  try {
    hashes = JSON.parse(hashesText)
    if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) throw new Error('not an object')
  } catch {
    logger.warn('net', 'data hashes.json unparseable')
    return failAll("couldn't read the list")
  }

  const updated: string[] = []
  const files: RefDataFileStatus[] = []
  for (const s of SPECS) {
    const want = hashes[s.key]
    if (!want || typeof want !== 'string') {
      files.push(mark(s, 'downloadFailed', 'not in the published list'))
      continue
    }
    let have = ''
    try {
      have = sha256(fs.readFileSync(cachePath(s.cache)))
    } catch {
      /* no local copy yet */
    }
    if (have === want) {
      files.push(mark(s, 'upToDate', 'matches the published fingerprint'))
      continue
    }

    const body = await fetchText(`${base}/${s.repo}`)
    if (!body) {
      files.push(mark(s, 'downloadFailed', `couldn't download ${s.repo}`))
      continue
    }
    // guards a truncated download
    if (sha256(body) !== want) {
      files.push(mark(s, 'hashMismatch', `${s.repo} didn't match the published fingerprint; kept the old copy`))
      continue
    }
    let shapeOk = false
    try {
      const parsed = JSON.parse(body)
      shapeOk = !!parsed && Array.isArray(parsed[s.key])
    } catch {
      /* not JSON */
    }
    if (!shapeOk) {
      files.push(mark(s, 'badFormat', `${s.repo} has no "${s.key}" list; kept the old copy`))
      continue
    }
    try {
      fs.writeFileSync(cachePath(s.cache), body)
      updated.push(s.key)
      files.push(mark(s, 'updated', `downloaded and checked ${s.repo}`))
    } catch (e) {
      console.warn(`[data] write ${s.cache} failed:`, (e as Error).message)
      logger.warn('net', 'data write failed', { file: s.cache, error: (e as Error).message })
      files.push(mark(s, 'downloadFailed', `couldn't save ${s.cache}: ${(e as Error).message}`))
    }
  }
  logger.info('net', 'data refresh done', { updated })
  const status: RefDataStatus = { checkedAt: now, reached: true, source: base, files }
  saveAndTell(status)
  return { reached: true, changed: updated.length > 0, updated, status }
}

// one check at a time; a second caller shares the running one
let inFlight: Promise<DataSyncResult> | null = null
export function refreshFromRepo(): Promise<DataSyncResult> {
  if (!inFlight) inFlight = runRefresh().finally(() => (inFlight = null))
  return inFlight
}

// IPC refDataCheck: seed + check; the caller then reloads overrides and rosters (as the dataRefresh handler does)
export async function checkRefDataNow(): Promise<RefDataStatus> {
  seedCacheIfNeeded()
  const res = await refreshFromRepo()
  return res.status ?? loadRefDataStatus()
}
