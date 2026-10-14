/**
 * Persist Other-mode jobs next to settings.json / manifest.json.
 * Separate file on purpose: Haul mode never reads or writes this, and
 * flipping Work mode must not wipe the haul manifest.
 */
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import { ipcMain } from 'electron'
import { dataFolder } from '../../main/paths'
import { IPC } from '@shared/channels'
import type { AppSettings } from '@shared/types'
import type { OtherJobsDoc } from '@other/otherJob'
import { scanOtherEvents, scanMarkersFor, resetLocationRoster } from './scanLog'
import { loadOtherPlaces, refreshOtherPlaces } from './uex'
import { loadCachedLocations } from '../../main/uex'
import { saveOtherOcrShot, loadOtherOcrShot } from './ocrSession'
import { sendOtherJobsChanged } from './ipc'
import { logger } from '../../main/logger'

const FILE = 'other-jobs.json'

function dir(): string {
  return dataFolder()
}
function filePath(): string {
  return path.join(dir(), FILE)
}

type Parsed = { ok: true; doc: OtherJobsDoc } | { ok: false; error: string }

/** Validate known fields' types; unknown fields pass through untouched. */
const WHERE_SOURCES = ['typed', 'tick', 'objective', 'inventory', 'map', 'displayinfo']
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
const isStrOrNull = (v: unknown): boolean => v === null || v === undefined || typeof v === 'string'

/** where: null, or an object with label/source/at, an optional finite point and optional accuracy 0-10 */
function isWhere(v: unknown): boolean {
  if (v === null) return true
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const w = v as Record<string, unknown>
  if (typeof w.label !== 'string' || typeof w.at !== 'string' || !WHERE_SOURCES.includes(w.source as string)) return false
  if (!isStrOrNull(w.name) || !isStrOrNull(w.system) || !isStrOrNull(w.body)) return false
  if (w.accuracy !== undefined && !(isNum(w.accuracy) && (w.accuracy as number) >= 0 && (w.accuracy as number) <= 10)) return false
  if (w.point === undefined) return true
  const p = w.point as Record<string, unknown> | null
  return !!p && typeof p === 'object' && isNum(p.x) && isNum(p.y) && isNum(p.z)
}

function parseDoc(raw: string): Parsed {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'not an object' }
  const o = j as Record<string, unknown>
  const dropped: string[] = []
  const out: Record<string, unknown> = { ...o }
  const check = (key: string, valid: (v: unknown) => boolean, fallback?: unknown): void => {
    if (!(key in o)) {
      if (fallback !== undefined) out[key] = fallback
      return
    }
    if (valid(o[key])) return
    dropped.push(key)
    if (fallback !== undefined) out[key] = fallback
    else delete out[key]
  }
  const isStr = (v: unknown): boolean => typeof v === 'string'
  check('jobs', Array.isArray, [])
  check('history', Array.isArray, [])
  check('startLocation', isStr)
  check('listOrder', (v) => v === 'distance' || v === 'route' || v === 'manual')
  check('jobOrder', (v) => Array.isArray(v) && v.every(isStr))
  check('lastLogEventAt', isStr)
  check('where', isWhere)
  check('startTypedAt', isStr)
  check('trackedMissionId', isStr)
  check('trackedAt', isStr)
  check('refreshedForVersion', isStr)
  check('rev', (v) => typeof v === 'number' && Number.isFinite(v))
  if (dropped.length) logger.warn('other', 'jobs file: bad field types reset', { fields: dropped })
  return { ok: true, doc: out as unknown as OtherJobsDoc }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw e
  }
}

/** Keep the bad file before anything can replace it. */
async function quarantine(raw: string, error: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(dir(), `other-jobs.corrupt-${stamp}.json`)
  await fsp.writeFile(dest, raw, 'utf8')
  logger.warn('other', 'jobs file corrupt, copied aside, starting empty', { file: filePath(), copy: dest, error })
}

export async function loadOtherJobs(): Promise<OtherJobsDoc> {
  const empty: OtherJobsDoc = { jobs: [], history: [] }
  let raw: string | null
  try {
    raw = await readIfExists(filePath())
  } catch (e) {
    logger.warn('other', 'jobs file unreadable, starting empty', { file: filePath(), error: (e as Error)?.message ?? String(e) })
    return empty
  }
  if (raw === null) {
    logger.info('other', 'jobs file missing, starting empty', { file: filePath() })
    return empty
  }
  const p = parseDoc(raw)
  if (!p.ok) {
    try {
      await quarantine(raw, p.error)
    } catch (e) {
      logger.error('other', 'jobs corrupt copy failed', { error: (e as Error)?.message ?? String(e) })
    }
    return empty
  }
  const d = p.doc
  logger.info('other', 'jobs file loaded', {
    file: filePath(),
    jobs: d.jobs.length,
    active: d.jobs.filter((j) => j?.status === 'active').length,
    history: d.history.length,
    rev: d.rev,
    lastLogEventAt: d.lastLogEventAt
  })
  return d
}

let chain: Promise<unknown> = Promise.resolve()

/** Atomic: tmp then rename; previous good file kept as .bak; a corrupt file is copied aside first. */
async function writeDoc(doc: OtherJobsDoc): Promise<void> {
  const file = filePath()
  const tmp = `${file}.tmp`
  await fsp.mkdir(dir(), { recursive: true })
  const prev = await readIfExists(file)
  if (prev !== null) {
    const p = parseDoc(prev)
    if (p.ok) await fsp.copyFile(file, path.join(dir(), 'other-jobs.json.bak'))
    else await quarantine(prev, p.error)
  }
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

export function saveOtherJobs(doc: OtherJobsDoc): Promise<boolean> {
  const run = chain.then(async () => {
    try {
      await writeDoc(doc)
      logger.info('other', 'jobs file saved', {
        jobs: doc.jobs.length,
        active: doc.jobs.filter((j) => j.status === 'active').length,
        history: doc.history?.length ?? 0,
        rev: doc.rev,
        lastLogEventAt: doc.lastLogEventAt
      })
      return true
    } catch (e) {
      logger.error('other', 'jobs file write failed', { file: filePath(), error: (e as Error)?.message ?? String(e) })
      return false
    }
  })
  chain = run
  return run
}

let registered = false

export function registerOtherJobsIpc(getSettings: () => AppSettings): void {
  if (registered) return
  registered = true
  ipcMain.handle(IPC.otherJobsLoad, () => loadOtherJobs())
  ipcMain.handle(IPC.otherJobsSave, async (e, doc: OtherJobsDoc) => {
    if (!doc || !Array.isArray(doc.jobs)) {
      logger.warn('other', 'save rejected: bad doc', { sender: e.sender.id })
      return false
    }
    logger.debug('other', 'save requested by window', { sender: e.sender.id, jobs: doc.jobs.length, rev: doc.rev })
    const ok = await saveOtherJobs(doc)
    if (ok) sendOtherJobsChanged({ rev: doc.rev, sender: e.sender.id })
    return ok
  })
  ipcMain.handle(IPC.otherJobsScanEvents, (_e, since?: string) => scanOtherEvents(getSettings().gameLogPath, since))
  ipcMain.handle(IPC.otherJobsRefreshScan, (_e, missionIds: string[]) =>
    scanMarkersFor(getSettings().gameLogPath, Array.isArray(missionIds) ? missionIds : [])
  )
  ipcMain.handle(IPC.otherPlacesGet, () => loadOtherPlaces())
  // REFRESH: re-pull the places roster (UEX + starmap; falls back to the cache) and rebuild the location roster
  ipcMain.handle(IPC.otherPlacesRefresh, async () => {
    const places = await refreshOtherPlaces(loadCachedLocations()?.locations ?? [])
    resetLocationRoster()
    logger.info('other', 'places refreshed on request', { places: places.length })
    return places
  })
  ipcMain.handle(IPC.otherOcrShotSave, (_e, jobId: string, dataUrl: string) => saveOtherOcrShot(jobId, dataUrl))
  ipcMain.handle(IPC.otherOcrShotGet, (_e, jobId: string) => loadOtherOcrShot(jobId))
  logger.info('other', 'jobs ipc registered')
}
