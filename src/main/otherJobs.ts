/**
 * Persist Other-mode jobs next to settings.json / manifest.json.
 * Separate file on purpose: Haul mode never reads or writes this, and
 * flipping Work mode must not wipe the haul manifest.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import { EMPTY_OTHER_JOBS, type OtherJobsDoc } from '@shared/otherJob'
import { scanOtherSessionLog } from './scanLog'
import { loadCachedLocations } from './uex'
import { loadOtherPlaces, refreshOtherPlaces } from './otherUex'
import { wipeOtherOcrSession, saveOtherOcrShot, loadOtherOcrShot, hookOtherOcrSessionQuit } from './otherOcrSession'

const FILE = 'other-jobs.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

export function loadOtherJobs(): OtherJobsDoc {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OtherJobsDoc>
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    }
  } catch {
    return { jobs: [], history: [] }
  }
}

export function saveOtherJobs(doc: OtherJobsDoc): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(doc, null, 2), 'utf8')
  } catch (e) {
    console.error('[other-jobs] failed to write:', e)
  }
}

let registered = false

export function ensureOtherJobsIpc(): void {
  if (registered) return
  registered = true
  ipcMain.handle(IPC.otherJobsLoad, () => loadOtherJobs())
  ipcMain.handle(IPC.otherJobsSave, (_e, doc: OtherJobsDoc) => {
    saveOtherJobs(doc)
    return true
  })
  ipcMain.handle(IPC.otherJobsScan, (_e, logPath: string) => {
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
      return {
        ...j,
        status: abandoned ? 'abandoned' : 'complete',
        steps: abandoned ? j.steps : j.steps.map((s) => ({ ...s, done: true, have: s.need }))
      }
    })
    if (changed) saveOtherJobs({ jobs, history: doc.history ?? [] })
    return { contracts, ended, objectivesByMission }
  })
  ipcMain.handle(IPC.otherPlacesGet, () => loadOtherPlaces())
  ipcMain.handle(IPC.otherOcrShotSave, (_e, jobId: string, dataUrl: string) => saveOtherOcrShot(jobId, dataUrl))
  ipcMain.handle(IPC.otherOcrShotGet, (_e, jobId: string) => loadOtherOcrShot(jobId))
  wipeOtherOcrSession()
  hookOtherOcrSessionQuit()
  void refreshOtherPlaces(loadCachedLocations()?.locations ?? [])
}
