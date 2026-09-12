/**
 * Bind auto-OCR to job create without rewriting otherJobs.ts.
 * Wait until after init log replay so startup does not OCR every empty job.
 */
import { useOtherJobs } from './otherJobs'
import { requestAutoOcrIfEnabled } from './otherCapture'

let bound = false

export function bindOtherAutoOcr(): void {
  if (bound) return
  bound = true
  const origAdd = useOtherJobs.getState().addJob
  const origAccept = useOtherJobs.getState().ingestAccepted
  useOtherJobs.setState({
    addJob: (draft) => {
      origAdd(draft)
      const jobs = useOtherJobs.getState().jobs
      const job = jobs[jobs.length - 1]
      if (job) requestAutoOcrIfEnabled(job.id, job.steps.length, job.objectivesLocked)
    },
    ingestAccepted: (e, opts) => {
      const before = new Set(useOtherJobs.getState().jobs.map((j) => j.id))
      origAccept(e, opts)
      window.setTimeout(() => {
        const added = useOtherJobs.getState().jobs.find((j) => !before.has(j.id))
        if (added) requestAutoOcrIfEnabled(added.id, added.steps.length, added.objectivesLocked)
      }, 800)
    }
  })
}
