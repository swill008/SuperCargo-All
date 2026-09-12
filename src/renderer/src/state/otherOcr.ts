/**
 * Apply Other OCR confirm onto a job.
 * This pass fills empty unlocked jobs only. Overwrite comes later.
 */
import { parseOtherObjectiveText, stepFromParse, stepKey } from '@shared/otherLog'
import type { OtherOcrRow } from '@shared/otherOcrParse'
import type { OtherStep } from '@shared/otherJob'
import { useOtherJobs } from './otherJobs'

let seq = 0
function nid(): string {
  seq += 1
  return `ocr-${Date.now().toString(36)}-${seq}`
}

export function applyOcrObjectives(
  jobId: string,
  payload: {
    reward?: number
    objectives: { commodity: string; scuAmount: number; destination: string }[]
  }
): boolean {
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job) return false
  if (job.objectivesLocked || job.steps.length > 0) return false

  const steps: OtherStep[] = []
  for (const o of payload.objectives) {
    const item = (o.commodity || '').trim()
    const dest = (o.destination || '').trim()
    const need = Math.max(1, Number(o.scuAmount) || 1)
    const raw = item && dest
      ? `Deliver 0/${need} SCU of ${item} to ${dest}`
      : dest
        ? `Go to ${dest}`
        : item
          ? `Deliver 0/${need} ${item}`
          : ''
    const parsed = parseOtherObjectiveText(raw)
    if (!parsed) continue
    const step = stepFromParse(nid(), parsed)
    if (steps.some((s) => stepKey(s) === stepKey(step))) continue
    steps.push(step)
  }

  const reward =
    job.reward > 0 ? job.reward : Math.max(0, Number(payload.reward) || 0)
  if (steps.length === 0 && reward === job.reward) return false

  useOtherJobs.setState({
    jobs: store.jobs.map((j) =>
      j.id === jobId ? { ...j, reward, steps: steps.length ? steps : j.steps } : j
    )
  })
  useOtherJobs.getState().persist()
  return true
}

/** Preferred path: rows already parsed by otherOcrParse. */
export function applyOcrRows(
  jobId: string,
  payload: { reward?: number; rows: OtherOcrRow[] }
): boolean {
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job) return false
  if (job.objectivesLocked || job.steps.length > 0) return false

  const steps: OtherStep[] = []
  for (const row of payload.rows) {
    const step = stepFromParse(nid(), {
      kind: row.kind,
      label: row.label || (row.item && row.location
        ? `Deliver 0/${row.need || 1} ${row.item} to ${row.location}`
        : row.location
          ? `Go to ${row.location}`
          : row.item || 'Objective'),
      location: row.location || '',
      item: row.item,
      have: row.have || 0,
      need: Math.max(1, row.need || 1)
    })
    if (steps.some((s) => stepKey(s) === stepKey(step))) continue
    steps.push(step)
  }

  const reward = job.reward > 0 ? job.reward : Math.max(0, Number(payload.reward) || 0)
  if (steps.length === 0 && reward === job.reward) return false

  useOtherJobs.setState({
    jobs: store.jobs.map((j) =>
      j.id === jobId ? { ...j, reward, steps: steps.length ? steps : j.steps } : j
    )
  })
  useOtherJobs.getState().persist()
  return true
}
