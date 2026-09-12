/**
 * Other-mode job model.
 *
 * This is intentionally NOT a HaulingContract. Haul contracts have SCU,
 * box breakdowns, pickups, and a hold pack. Other jobs are a checklist:
 * go to a place, pick up a named item, or turn in a count at one pad.
 *
 * Kind mapping from the screenshot pass:
 * - delivery  → staged "Go to X" then a small drop (workflow 2)
 * - collection → player-sourced "Bring 0/N" (workflow 3)
 * - mining    → purchase orders (ship / hand / ROC) (workflow 3)
 * - salvage   → RMC / component turn-in (workflow 3)
 *
 * Combat types (bounty, merc, PVP, investigation) stay out until we ask
 * for them. Do not add them here just to fill the sidebar list.
 */

export type OtherJobKind = 'delivery' | 'collection' | 'mining' | 'salvage'

export type OtherStepKind = 'go' | 'pickup' | 'turnin'

export type OtherJobStatus = 'active' | 'complete' | 'abandoned'

export interface OtherStep {
  id: string
  kind: OtherStepKind
  /** Short line shown in Jobs + Next + overlay. */
  label: string
  /** Place name we group Next-page rows by. Empty = ungrouped. */
  location: string
  item?: string
  have: number
  need: number
  done: boolean
}

export interface OtherJob {
  id: string
  /** Display ref J01, J02… — parallel to haul C01. */
  ref: string
  title: string
  kind: OtherJobKind
  reward: number
  status: OtherJobStatus
  steps: OtherStep[]
  createdAt: number
}

export interface OtherJobsDoc {
  jobs: OtherJob[]
}

export const EMPTY_OTHER_JOBS: OtherJobsDoc = { jobs: [] }

export const OTHER_KIND_LABEL: Record<OtherJobKind, string> = {
  delivery: 'DELIVERY',
  collection: 'COLLECTION',
  mining: 'MINING PO',
  salvage: 'SALVAGE'
}

export function otherJobRef(index: number): string {
  return 'J' + String(index + 1).padStart(2, '0')
}

/** First incomplete step — what the overlay should show. */
export function nextOpenStep(job: OtherJob): OtherStep | null {
  if (job.status !== 'active') return null
  return job.steps.find((s) => !s.done) ?? null
}

export function jobProgress(job: OtherJob): { done: number; total: number } {
  const total = job.steps.length
  const done = job.steps.filter((s) => s.done).length
  return { done, total }
}
