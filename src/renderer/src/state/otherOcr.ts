/**
 * Apply Other OCR confirm onto a job.
 * This pass fills empty unlocked jobs only. Overwrite comes later.
 * Confirm snaps location to a unique UEX roster name when one is obvious.
 */
import { mergeCollectIntoDeliver, parseOtherObjectiveText, stepFromParse, stepKey } from '@shared/otherLog'
import type { OtherOcrRow } from '@shared/otherOcrParse'
import type { OtherStep } from '@shared/otherJob'
import { useOtherJobs } from './otherJobs'
import { useStore } from './store'
import { mergeLocations } from './otherPlaces'

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
  const locations = mergeLocations(useStore.getState().locations)

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
    const step = stepFromParse(nid(), parsed, locations)
    if (steps.some((s) => stepKey(s) === stepKey(step))) continue
    steps.push(step)
  }

  const reward =
    job.reward > 0 ? job.reward : Math.max(0, Number(payload.reward) || 0)
  if (steps.length === 0 && reward === job.reward) return false

  useOtherJobs.setState({
    jobs: store.jobs.map((j) =>
      j.id === jobId ? { ...j, reward, steps: steps.length ? steps : j.steps, filledBy: 'ocr' as const } : j
    )
  })
  useOtherJobs.getState().persist()
  return true
}

export function applyOcrRows(
  jobId: string,
  payload: { reward?: number; rows: OtherOcrRow[]; overwrite?: boolean }
): boolean {
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job) return false
  const overwrite = !!payload.overwrite
  if (!overwrite && (job.objectivesLocked || job.steps.length > 0)) return false
  const locations = mergeLocations(useStore.getState().locations)

  const incoming = mergeCollectIntoDeliver(payload.rows)
  const steps: OtherStep[] = []
  for (const row of incoming) {
    const loc = row.location || ''
    const label = row.label || (row.item && loc
      ? `Deliver 0/${row.need || 1} ${row.item} to ${loc}`
      : loc
        ? `Go to ${loc}`
        : row.item || 'Objective')
    const step = stepFromParse(nid(), {
      kind: row.kind,
      label,
      location: loc,
      pickupLocation: row.pickupLocation,
      item: row.item,
      have: row.have || 0,
      need: Math.max(1, row.need || 1)
    }, locations)
    if (steps.some((s) => stepKey(s) === stepKey(step))) continue
    steps.push(step)
  }

  const reward = overwrite
    ? Math.max(0, Number(payload.reward) || 0)
    : job.reward > 0 ? job.reward : Math.max(0, Number(payload.reward) || 0)
  if (steps.length === 0) return false

  useOtherJobs.setState({
    jobs: store.jobs.map((j) =>
      j.id === jobId
        ? {
            ...j,
            reward,
            steps,
            filledBy: 'ocr' as const,
            objectivesLocked: overwrite ? false : j.objectivesLocked,
            edited: overwrite ? false : j.edited
          }
        : j
    )
  })
  useOtherJobs.getState().persist()
  return true
}

/** Log jobs that already have steps: write payout only. */
export function applyOcrRewardOnly(jobId: string, amount: number): boolean {
  if (!(amount > 0)) return false
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job || job.reward > 0) return false
  useOtherJobs.setState({
    jobs: store.jobs.map((j) => (j.id === jobId ? { ...j, reward: amount } : j))
  })
  useOtherJobs.getState().persist()
  return true
}
