/** Archive store for Other-mode jobs. Kept separate so haul store merges stay clean. */
import { create } from 'zustand'
import {
  type OtherHistoryEntry,
  type OtherJob,
  type OtherMovedBy,
  type OtherJobsDoc
} from '@other/otherJob'
import { useOtherJobs } from './otherJobs'
import type { ScannedContract } from '@shared/types'

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
    source: job.source
  }
}

interface OtherHistoryState {
  history: OtherHistoryEntry[]
  load: (doc: OtherJobsDoc) => void
  persist: () => void
  clearFinished: () => Promise<void>
  clearAll: () => void
  reconcileFromLog: () => Promise<void>
}

export const useOtherHistory = create<OtherHistoryState>((set, get) => ({
  history: [],
  load: (doc) => set({ history: doc.history ?? [] }),
  persist: () => {
    const doc: OtherJobsDoc = { jobs: useOtherJobs.getState().jobs, history: get().history }
    void window.supercargo.saveOtherJobs?.(doc)
  },
  clearFinished: async () => {
    const keep: OtherJob[] = []
    const archived: OtherHistoryEntry[] = []
    for (const j of useOtherJobs.getState().jobs) {
      if (j.status !== 'active') archived.push(toHistory(j, 'manual'))
      else keep.push(j)
    }
    if (!archived.length) return
    useOtherJobs.setState({ jobs: keep })
    set({ history: [...archived, ...get().history] })
    useOtherJobs.getState().persist()
  },
  clearAll: () => {
    set({ history: [] })
    get().persist()
  },
  reconcileFromLog: async () => {
    const logPath = (await window.supercargo.getSettings()).gameLogPath
    if (!logPath || !window.supercargo.scanOtherJobs) return
    const scanned = await window.supercargo.scanOtherJobs(logPath)
    const contracts: ScannedContract[] = Array.isArray(scanned) ? scanned : scanned.contracts
    const live = new Set(contracts.map((c) => c.accepted.missionId))
    const jobs = useOtherJobs.getState().jobs
    const marked = jobs.map((j) =>
      j.status === 'active' && j.source !== 'manual' && j.missionId && !live.has(j.missionId)
        ? { ...j, status: 'abandoned' as const }
        : j
    )
    const keep: OtherJob[] = []
    const archived: OtherHistoryEntry[] = []
    const seen = new Set(get().history.map((h) => h.id))
    for (const j of marked) {
      const gone = j.status !== 'active' && j.source !== 'manual' && (!j.missionId || !live.has(j.missionId))
      if (gone) {
        if (!seen.has(j.id)) archived.push(toHistory(j, 'auto'))
      } else keep.push(j)
    }
    useOtherJobs.setState({ jobs: keep })
    if (archived.length) set({ history: [...archived, ...get().history] })
    get().persist()
  }
}))
