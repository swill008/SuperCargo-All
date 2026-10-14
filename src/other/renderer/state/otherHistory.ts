/** Archive store for Other-mode jobs. Kept separate so haul store merges stay clean. */
import { create } from 'zustand'
import {
  type OtherHistoryEntry,
  type OtherJob,
  type OtherMovedBy,
  type OtherJobsDoc
} from '@other/otherJob'
import { useOtherJobs } from './otherJobs'
import { dlog } from '@renderer/state/log'

function toHistory(job: OtherJob, movedBy: OtherMovedBy): OtherHistoryEntry {
  return {
    id: job.id,
    ref: job.ref,
    title: job.title,
    kind: job.kind,
    reward: job.reward,
    outcome: job.status === 'complete' ? 'completed' : 'abandoned',
    movedBy,
    steps: job.steps,
    archivedAt: Date.now(),
    createdAt: job.createdAt,
    missionId: job.missionId,
    generator: job.generator,
    contractName: job.contractName,
    source: job.source,
    rep: job.rep,
    sharedBy: job.sharedBy,
    sessionAt: job.sessionAt,
    acceptedAt: job.acceptedAt,
    endedAt: job.endedAt,
    filledBy: job.filledBy,
    edited: job.edited
  }
}

interface OtherHistoryState {
  history: OtherHistoryEntry[]
  load: (doc: OtherJobsDoc) => void
  persist: () => void
  clearFinished: () => Promise<void>
  clearAll: () => void
}

export const useOtherHistory = create<OtherHistoryState>((set, get) => ({
  history: [],
  load: (doc) => {
    dlog.debug('other', 'history load', { history: doc.history?.length ?? 0 })
    set({ history: doc.history ?? [] })
  },
  // one doc builder (otherJobs buildOtherDoc) writes every field
  persist: () => useOtherJobs.getState().persist(),
  clearFinished: async () => {
    const keep: OtherJob[] = []
    const archived: OtherHistoryEntry[] = []
    for (const j of useOtherJobs.getState().jobs) {
      if (j.status !== 'active') archived.push(toHistory(j, 'manual'))
      else keep.push(j)
    }
    dlog.info('other', 'clearFinished', {
      archived: archived.length,
      kept: keep.length,
      refs: archived.map((h) => h.ref)
    })
    if (!archived.length) return
    useOtherJobs.setState({ jobs: keep })
    set({ history: [...archived, ...get().history] })
    useOtherJobs.getState().persist()
  },
  clearAll: () => {
    dlog.info('other', 'clearAll history', { removed: get().history.length })
    set({ history: [] })
    get().persist()
  }
}))
