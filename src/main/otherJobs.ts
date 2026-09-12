/**
 * Persist Other-mode jobs next to settings.json / manifest.json.
 * Separate file on purpose: Haul mode never reads or writes this, and
 * flipping Work mode must not wipe the haul manifest.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import { EMPTY_OTHER_JOBS, type OtherJobsDoc } from '@shared/otherJob'

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
