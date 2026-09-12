/**
 * Bind auto-OCR to job create without rewriting otherJobs.ts.
 * Wait until after init log replay so startup does not OCR every empty job.
 * Auto-fire waits 2s so Game.log objectives can land first.
 */
import { useOtherJobs } from './otherJobs'
import { requestAutoOcrIfEnabled } from './otherCapture'

const AUTO_OCR_DELAY_MS = 2000

let bound = false

export function bindOtherAutoOcr(): void {
  if (bound) return
  bound = true
  const origAdd = useOtherJobs.getState().addJob
  const origAccept = useOtherJobs.getState().ingestAccepted
  useOtherJobs.setState({
    addJob: (draft) => {
      origAdd(draft)
      const beforeId = useOtherJobs.getState().jobs.at(-1)?.id
      window.setTimeout(() => {
        const job = useOtherJobs.getState().jobs.find((j) => j.id === beforeId) ?? useOtherJobs.getState().jobs.at(-1)
        if (job) requestAutoOcrIfEnabled(job.id, job.steps.length, job.objectivesLocked)
      }, AUTO_OCR_DELAY_MS)
    },
    ingestAccepted: (e, opts) => {
      const before = new Set(useOtherJobs.getState().jobs.map((j) => j.id))
      origAccept(e, opts)
      window.setTimeout(() => {
        const added = useOtherJobs.getState().jobs.find((j) => !before.has(j.id))
        if (added) requestAutoOcrIfEnabled(added.id, added.steps.length, added.objectivesLocked)
      }, AUTO_OCR_DELAY_MS)
    }
  })
}
