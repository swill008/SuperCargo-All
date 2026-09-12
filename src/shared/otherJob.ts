/**
 * Other-mode job model.
 *
 * This is intentionally NOT a HaulingContract. Haul contracts have SCU,
 * box breakdowns, pickups, and a hold pack. Other jobs are a checklist:
 * go to a place, pick up a named item, or turn in a count at one pad.
 */

export type OtherJobKind = 'delivery' | 'collection' | 'mining' | 'salvage'

export type OtherStepKind = 'go' | 'pickup' | 'turnin'

export type OtherJobStatus = 'active' | 'complete' | 'abandoned'

/** Why the contract is no longer live. */
export type OtherOutcome = 'completed' | 'abandoned'

/** How the row left the Jobs tab. */
export type OtherMovedBy = 'auto' | 'manual'

export interface OtherStep {
  id: string
  kind: OtherStepKind
  label: string
  location: string
  item?: string
  have: number
  need: number
  done: boolean
}

export interface OtherJob {
  id: string
  ref: string
  title: string
  kind: OtherJobKind
  reward: number
  status: OtherJobStatus
  steps: OtherStep[]
  createdAt: number
  missionId?: string
  generator?: string
  contractName?: string
  source?: 'log' | 'manual'
  /** Set on EDIT / COMPLETE / ABANDON. Log objectives will not replace user steps. */
  objectivesLocked?: boolean
}

export interface OtherHistoryEntry {
  id: string
  ref: string
  title: string
  kind: OtherJobKind
  reward: number
  outcome: OtherOutcome
  movedBy: OtherMovedBy
  steps: OtherStep[]
  archivedAt: number
  createdAt: number
  missionId?: string
  generator?: string
  contractName?: string
  source?: 'log' | 'manual'
}

export interface OtherJobsDoc {
  jobs: OtherJob[]
  history: OtherHistoryEntry[]
}

export const EMPTY_OTHER_JOBS: OtherJobsDoc = { jobs: [], history: [] }

export const OTHER_OUTCOME_LABEL: Record<OtherOutcome, string> = {
  completed: 'Completed',
  abandoned: 'Abandoned'
}

export const OTHER_MOVED_LABEL: Record<OtherMovedBy, string> = {
  auto: 'Auto moved',
  manual: 'Manually moved'
}

export const OTHER_KIND_LABEL: Record<OtherJobKind, string> = {
  delivery: 'DELIVERY',
  collection: 'COLLECTION',
  mining: 'MINING PO',
  salvage: 'SALVAGE'
}

export function otherJobRef(index: number): string {
  return 'J' + String(index + 1).padStart(2, '0')
}

export function nextOpenStep(job: OtherJob): OtherStep | null {
  if (job.status !== 'active') return null
  return job.steps.find((s) => !s.done) ?? null
}

export function jobProgress(job: OtherJob): { done: number; total: number } {
  const total = job.steps.length
  const done = job.steps.filter((s) => s.done).length
  return { done, total }
}
