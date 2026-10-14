/**
 * Apply Other OCR confirm onto a job.
 * This pass fills empty unlocked jobs only. Overwrite comes later.
 * Confirm snaps location to a unique UEX roster name when one is obvious.
 */
import { mergeCollectIntoDeliver, stepFromParse, stepKey } from '@other/otherLog'
import type { OtherOcrRow } from '@other/otherOcrParse'
import type { OtherStep } from '@other/otherJob'
import { useOtherJobs } from './otherJobs'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { trace } from '@renderer/state/trace'
import { mergeLocations } from './otherPlaces'

/** 'ocr' trace record. Text is cut to 500 chars; images never go in. */
export function traceOcr(what: string, missionId: string | undefined, data: Record<string, unknown>, text?: string): void {
  const d: Record<string, unknown> = { ...data }
  if (text !== undefined) {
    d.textLength = text.length
    if (text) d.text = text.slice(0, 500)
  }
  trace({ area: 'ocr', mode: 'other', what, missionId, data: d })
}

let seq = 0
function nid(): string {
  seq += 1
  return `ocr-${Date.now().toString(36)}-${seq}`
}

export function applyOcrRows(
  jobId: string,
  payload: { reward?: number; rows: OtherOcrRow[]; overwrite?: boolean }
): boolean {
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job) dlog.warn('other', 'ocr rows: job not found', { jobId })
  if (!job) traceOcr('rows not applied: job not found', undefined, { jobId, rowsParsed: payload.rows.length })
  if (!job) return false
  const overwrite = !!payload.overwrite
  if (!overwrite && (job.objectivesLocked || job.steps.length > 0)) {
    traceOcr('rows not applied: job locked or has steps', job.missionId, {
      ref: job.ref,
      rowsParsed: payload.rows.length,
      rowsApplied: 0,
      overwrite,
      locked: !!job.objectivesLocked,
      steps: job.steps.length
    })
    dlog.info('other', 'ocr rows skipped: job locked or has steps', { ref: job.ref, locked: !!job.objectivesLocked, steps: job.steps.length })
  }
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
  if (steps.length === 0) dlog.info('other', 'ocr rows: no steps built', { ref: job.ref, rows: payload.rows.length })
  if (steps.length === 0) traceOcr('rows not applied: no steps built', job.missionId, { ref: job.ref, rowsParsed: payload.rows.length, rowsApplied: 0, overwrite })
  if (steps.length === 0) return false
  traceOcr('rows applied', job.missionId, {
    ref: job.ref,
    rowsParsed: payload.rows.length,
    rowsApplied: steps.length,
    overwrite,
    replacedSteps: job.steps.length,
    rewardFound: Number(payload.reward) || 0,
    reward,
    steps: steps.map((s) => ({ kind: s.kind, label: s.label, location: s.location, item: s.item, need: s.need }))
  })
  dlog.info('other', 'ocr rows applied', {
    ref: job.ref,
    rows: payload.rows.length,
    steps: steps.length,
    overwrite,
    replacedSteps: job.steps.length,
    reward
  })

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
  if (!(amount > 0)) traceOcr('reward not applied: none found', undefined, { jobId, rewardFound: amount })
  if (!(amount > 0)) return false
  const store = useOtherJobs.getState()
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job || job.reward > 0) dlog.debug('other', 'ocr reward skipped', { jobId, found: !!job, has: job?.reward })
  if (!job || job.reward > 0) traceOcr('reward not applied', job?.missionId, { jobId, found: !!job, has: job?.reward, rewardFound: amount })
  if (!job || job.reward > 0) return false
  traceOcr('reward applied', job.missionId, { ref: job.ref, rewardFound: amount })
  dlog.info('other', 'ocr reward applied', { ref: job.ref, amount })
  useOtherJobs.setState({
    jobs: store.jobs.map((j) => (j.id === jobId ? { ...j, reward: amount } : j))
  })
  useOtherJobs.getState().persist()
  return true
}
