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
  load: (doc) => {
    dlog.debug('other', 'history load', { history: doc.history?.length ?? 0 })
    set({ history: doc.history ?? [] })
  },
  persist: () => {
    const doc: OtherJobsDoc = { jobs: useOtherJobs.getState().jobs, history: get().history }
    // note: this doc has no startLocation / listOrder / jobOrder
    dlog.debug('other', 'persist', {
      by: 'otherHistory',
      jobs: doc.jobs.length,
      history: doc.history.length,
      startLocation: false,
      listOrder: false,
      jobOrder: false
    })
    void window.supercargo.saveOtherJobs?.(doc)
  },
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
  },
  reconcileFromLog: async () => {
    const logPath = (await window.supercargo.getSettings()).gameLogPath
    if (!logPath || !window.supercargo.scanOtherJobs) {
      dlog.info('other', 'reconcile skipped', { hasLogPath: !!logPath, hasBridge: !!window.supercargo.scanOtherJobs })
    }
    if (!logPath || !window.supercargo.scanOtherJobs) return
    const scanned = await window.supercargo.scanOtherJobs(logPath)
    const contracts: ScannedContract[] = Array.isArray(scanned) ? scanned : scanned.contracts
    const live = new Set(contracts.map((c) => c.accepted.missionId))
    const jobs = useOtherJobs.getState().jobs
    for (const j of jobs) {
      if (j.status === 'active' && j.source !== 'manual' && j.missionId && !live.has(j.missionId)) {
        dlog.info('other', 'job status change', {
          ref: j.ref,
          id: j.missionId.slice(0, 8),
          from: 'active',
          to: 'abandoned',
          reason: 'reconcile: not live in Game.log'
        })
      }
    }
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
    dlog.info('other', 'reconcile result', {
      live: [...live].map((id) => id.slice(0, 8)),
      jobs: jobs.length,
      kept: keep.length,
      archived: archived.map((h) => h.ref),
      alreadyInHistory: marked.length - keep.length - archived.length
    })
    useOtherJobs.setState({ jobs: keep })
    if (archived.length) set({ history: [...archived, ...get().history] })
    get().persist()
  }
}))
