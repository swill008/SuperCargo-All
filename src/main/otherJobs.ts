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

const FILE = 'other-jobs.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

export function loadOtherJobs(): OtherJobsDoc {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OtherJobsDoc>
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] }
  } catch {
    return { ...EMPTY_OTHER_JOBS, jobs: [] }
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
    return scanOtherSessionLog(logPath)
  })
}
