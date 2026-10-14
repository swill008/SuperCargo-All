/**
 * Persist Other-mode jobs next to settings.json / manifest.json.
 * Separate file on purpose: Haul mode never reads or writes this, and
 * flipping Work mode must not wipe the haul manifest.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import { EMPTY_OTHER_JOBS, type OtherJobsDoc } from '@other/otherJob'
import { scanOtherSessionLog } from './scanLog'
import { loadCachedLocations } from '../../main/uex'
import { loadOtherPlaces, refreshOtherPlaces } from './uex'
import { wipeOtherOcrSession, saveOtherOcrShot, loadOtherOcrShot, hookOtherOcrSessionQuit } from './ocrSession'
import { sendOtherJobsChanged } from './ipc'
import { logger } from '../../main/logger'

const FILE = 'other-jobs.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

export function loadOtherJobs(): OtherJobsDoc {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OtherJobsDoc>
    logger.info('other', 'jobs file loaded', {
      file: filePath(),
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs.length : 'invalid',
      history: Array.isArray(parsed.history) ? parsed.history.length : 'invalid',
      active: Array.isArray(parsed.jobs) ? parsed.jobs.filter((j) => j.status === 'active').length : 0
    })
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      startLocation: typeof parsed.startLocation === 'string' ? parsed.startLocation : ''
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') logger.info('other', 'jobs file missing, starting empty', { file: filePath() })
    else logger.warn('other', 'jobs file unreadable, starting empty', { file: filePath(), error: err?.message ?? String(e) })
    return { jobs: [], history: [] }
  }
}

export function saveOtherJobs(doc: OtherJobsDoc): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(doc, null, 2), 'utf8')
    logger.info('other', 'jobs file saved', {
      jobs: doc.jobs.length,
      active: doc.jobs.filter((j) => j.status === 'active').length,
      history: doc.history?.length ?? 0,
      startLocation: doc.startLocation !== undefined
    })
  } catch (e) {
    console.error('[other-jobs] failed to write:', e)
    logger.error('other', 'jobs file write failed', { file: filePath(), error: (e as Error)?.message ?? String(e) })
  }
}

let registered = false

export function ensureOtherJobsIpc(): void {
  if (registered) return
  registered = true
  ipcMain.handle(IPC.otherJobsLoad, () => loadOtherJobs())
  ipcMain.handle(IPC.otherJobsSave, (e, doc: OtherJobsDoc) => {
    logger.debug('other', 'save requested by window', { senderId: e.sender.id, jobs: doc?.jobs?.length })
    saveOtherJobs(doc)
    sendOtherJobsChanged()
    return true
  })
  ipcMain.handle(IPC.otherJobsScan, (_e, logPath: string) => {
    if (!logPath) logger.warn('other', 'startup scan skipped: no log path')
    if (!logPath) return []
    const { contracts, ended, objectivesByMission } = scanOtherSessionLog(logPath)
    const still = new Set(contracts.map((c) => c.accepted.missionId))
    const doc = loadOtherJobs()
    let changed = false
    const jobs = doc.jobs.map((j) => {
      if (!j.missionId || j.status !== 'active' || still.has(j.missionId)) return j
      if (j.source === 'manual') return j
      const ev = ended.find((e) => e.missionId === j.missionId)
      changed = true
      const abandoned = !ev || ev.completion === 'Abandon' || ev.completion === 'Fail'
      logger.info('other', 'job status change (reason: startup scan)', {
        ref: j.id,
        id: j.missionId.slice(0, 8),
        to: abandoned ? 'abandoned' : 'complete',
        why: ev ? `ended ${ev.completion}` : 'not active in Game.log and no end seen'
      })
      return {
        ...j,
        status: abandoned ? 'abandoned' : 'complete',
        steps: abandoned ? j.steps : j.steps.map((s) => ({ ...s, done: true, have: s.need }))
      }
    })
    logger.info('other', 'startup scan (main) result', {
      active: contracts.length,
      ended: ended.length,
      jobs: doc.jobs.length,
      changed
    })
    if (changed) {
      saveOtherJobs({ jobs, history: doc.history ?? [], startLocation: doc.startLocation ?? '' })
      sendOtherJobsChanged()
    }
    return { contracts, ended, objectivesByMission }
  })
  ipcMain.handle(IPC.otherPlacesGet, () => loadOtherPlaces())
  ipcMain.handle(IPC.otherOcrShotSave, (_e, jobId: string, dataUrl: string) => saveOtherOcrShot(jobId, dataUrl))
  ipcMain.handle(IPC.otherOcrShotGet, (_e, jobId: string) => loadOtherOcrShot(jobId))
  wipeOtherOcrSession()
  hookOtherOcrSessionQuit()
  void refreshOtherPlaces(loadCachedLocations()?.locations ?? [])
}
