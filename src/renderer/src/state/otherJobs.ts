/**
 * Renderer store for Other-mode jobs.
 * Kept out of state/store.ts so haul pack/route merges stay clean.
 */
import { create } from 'zustand'
import {
  otherJobRef,
  type OtherJob,
  type OtherJobKind,
  type OtherJobsDoc,
  type OtherStep
} from '@shared/otherJob'
import { useOtherHistory } from './otherHistory'
import {
  isOtherGenerator,
  kindFromGenerator,
  parseOtherObjectiveText,
  stepFromParse,
  stepKey
} from '@shared/otherLog'
import type { ContractAcceptedEvent, ContractEndedEvent, ObjectiveEvent, ScannedContract } from '@shared/types'

export interface OtherJobDraft {
  title: string
  kind: OtherJobKind
  reward: number
  location: string
  item: string
  need: number
}

export interface OtherJobEdit {
  title: string
  kind: OtherJobKind
  reward: number
  steps: { id: string; location: string; item: string; need: number }[]
}

interface OtherJobsState {
  ready: boolean
  jobs: OtherJob[]
  expandedId: string | null
  startLocation: string
  groupBy: 'location' | 'job'
  init: () => Promise<void>
  persist: () => void
  setExpanded: (id: string | null) => void
  setStartLocation: (v: string) => void
  setGroupBy: (v: 'location' | 'job') => void
  addJob: (draft: OtherJobDraft) => void
  applyEdit: (id: string, edit: OtherJobEdit) => void
  abandonJob: (id: string) => void
  completeJob: (id: string) => void
  toggleStep: (jobId: string, stepId: string) => void
  ingestAccepted: (e: ContractAcceptedEvent) => void
  ingestObjective: (e: ObjectiveEvent) => void
  ingestEnded: (e: ContractEndedEvent) => void
  dropLogSession: () => void
}

let seq = 0
function nid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function labelFor(kind: OtherJobKind, location: string, item: string, need: number): string {
  const loc = location.trim()
  const it = item.trim()
  if (!it && loc) return `Go to ${loc}`
  const verb = kind === 'collection' ? 'Bring' : 'Deliver'
  if (it && loc) return `${verb} 0/${need} ${it} to ${loc}`
  if (it) return `${verb} 0/${need} ${it}`
  return loc || 'Objective'
}

function stepsFor(draft: OtherJobDraft): OtherStep[] {
  const loc = draft.location.trim()
  const item = draft.item.trim()
  const need = Math.max(1, Number(draft.need) || 1)
  if (draft.kind === 'delivery') {
    return [
      {
        id: nid('step'),
        kind: 'go',
        label: loc ? `Go to ${loc}` : 'Go to pickup',
        location: loc,
        item: item || undefined,
        have: 0,
        need: 1,
        done: false
      },
      {
        id: nid('step'),
        kind: 'turnin',
        label: item ? `Deliver 0/${need} ${item}` : 'Deliver item',
        location: loc,
        item: item || undefined,
        have: 0,
        need,
        done: false
      }
    ]
  }
  const verb = draft.kind === 'collection' ? 'Bring' : 'Deliver'
  return [
    {
      id: nid('step'),
      kind: 'turnin',
      label: item ? `${verb} 0/${need} ${item}${loc ? ` to ${loc}` : ''}` : `${verb} items`,
      location: loc,
      item: item || undefined,
      have: 0,
      need,
      done: false
    }
  ]
}

function stepFromObjective(e: ObjectiveEvent): OtherStep | null {
  const raw =
    e.destination && !e.commodity
      ? `Go to ${e.destination}`
      : e.commodity && e.destination
        ? `Deliver 0/${e.scuAmount || 1} ${e.commodity} to ${e.destination}`
        : e.destination || e.commodity || ''
  const parsed = parseOtherObjectiveText(raw)
  if (!parsed) return null
  return stepFromParse(nid('step'), parsed)
}

let listenersBound = false

export const useOtherJobs = create<OtherJobsState>((set, get) => ({
  ready: false,
  jobs: [],
  expandedId: null,
  startLocation: '',
  groupBy: 'location',

  init: async () => {
    if (!window.supercargo.loadOtherJobs) {
      set({ ready: true, jobs: [] })
      return
    }
    const doc = await window.supercargo.loadOtherJobs()
    set({ ready: true, jobs: doc.jobs ?? [] })
    useOtherHistory.getState().load(doc)

    if (!listenersBound) {
      listenersBound = true
      window.supercargo.onOtherAccepted?.((e) => get().ingestAccepted(e))
      window.supercargo.onOtherSessionDrop?.(() => get().dropLogSession())
      window.supercargo.onObjective((e) => get().ingestObjective(e))
      window.supercargo.onContractEnded((e) => get().ingestEnded(e))
    }

    const logPath = (await window.supercargo.getSettings()).gameLogPath
    if (logPath && window.supercargo.scanOtherJobs) {
      const scanned = await window.supercargo.scanOtherJobs(logPath)
      const contracts: ScannedContract[] = Array.isArray(scanned) ? scanned : scanned.contracts
      const live = new Set(contracts.map((c) => c.accepted.missionId))
      set({
        jobs: get().jobs.map((j) =>
          j.status === 'active' && j.source !== 'manual' && j.missionId && !live.has(j.missionId)
            ? { ...j, status: 'abandoned' as const }
            : j
        )
      })
      for (const c of contracts) {
        get().ingestAccepted(c.accepted)
        for (const o of c.objectives) get().ingestObjective(o)
      }
      get().persist()
    }
  },

  persist: () => {
    const doc: OtherJobsDoc = { jobs: get().jobs, history: useOtherHistory.getState().history }
    void window.supercargo.saveOtherJobs?.(doc)
  },

  setExpanded: (id) => set({ expandedId: id }),
  setStartLocation: (v) => set({ startLocation: v }),
  setGroupBy: (v) => set({ groupBy: v }),

  addJob: (draft) => {
    const jobs = get().jobs
    const job: OtherJob = {
      id: nid('job'),
      ref: otherJobRef(jobs.length),
      title: draft.title.trim() || `${draft.kind} job`,
      kind: draft.kind,
      reward: Math.max(0, Number(draft.reward) || 0),
      status: 'active',
      steps: stepsFor(draft),
      createdAt: Date.now(),
      source: 'manual'
    }
    set({ jobs: [...jobs, job], expandedId: job.id })
    get().persist()
  },

  applyEdit: (id, edit) => {
    set({
      jobs: get().jobs.map((j) => {
        if (j.id !== id) return j
        const prevById = new Map(j.steps.map((s) => [s.id, s]))
        const steps: OtherStep[] = edit.steps.map((row) => {
          const prev = prevById.get(row.id)
          const location = row.location.trim()
          const item = row.item.trim()
          const need = Math.max(1, Number(row.need) || 1)
          const kind = item ? 'turnin' : 'go'
          return {
            id: prev?.id ?? nid('step'),
            kind,
            label: labelFor(edit.kind, location, item, need),
            location,
            item: item || undefined,
            have: prev?.done ? need : 0,
            need,
            done: prev?.done ?? false
          }
        })
        return {
          ...j,
          title: edit.title.trim() || j.title,
          kind: edit.kind,
          reward: Math.max(0, Number(edit.reward) || 0),
          steps,
          status: j.status === 'active' && steps.length > 0 && steps.every((s) => s.done) ? 'complete' : j.status
        }
      })
    })
    get().persist()
  },

  ingestAccepted: (e) => {
    if (e.generator && !isOtherGenerator(e.generator)) return
    if (!e.generator && /haul/i.test(e.title || '')) return
    if (get().jobs.find((j) => j.missionId === e.missionId)) return
    const kind = kindFromGenerator(e.generator || '', e.title || '')
    const jobs = get().jobs
    const job: OtherJob = {
      id: e.missionId,
      ref: otherJobRef(jobs.length),
      title: e.title || 'Contract',
      kind,
      reward: 0,
      status: 'active',
      steps: [],
      createdAt: Date.now(),
      missionId: e.missionId,
      generator: e.generator || undefined,
      source: 'log'
    }
    set({ jobs: [...jobs, job], expandedId: job.id })
    get().persist()
  },

  ingestObjective: (e) => {
    const job = get().jobs.find((j) => j.missionId === e.missionId && j.status === 'active')
    if (!job) return
    const step = stepFromObjective(e)
    if (!step) return
    const key = stepKey(step)
    if (job.steps.some((s) => stepKey(s) === key)) return
    set({
      jobs: get().jobs.map((j) => (j.id === job.id ? { ...j, steps: [...j.steps, step] } : j))
    })
    get().persist()
  },

  dropLogSession: () => {
    set({
      jobs: get().jobs.map((j) =>
        j.status === 'active' && j.source !== 'manual' ? { ...j, status: 'abandoned' as const } : j
      )
    })
    void useOtherHistory.getState().reconcileFromLog()
  },

  ingestEnded: (e) => {
    if (!get().jobs.find((j) => j.missionId === e.missionId && j.status === 'active')) return
    const abandoned = e.completion === 'Abandon' || e.completion === 'Fail'
    set({
      jobs: get().jobs.map((j) =>
        j.missionId === e.missionId
          ? {
              ...j,
              status: abandoned ? 'abandoned' : 'complete',
              steps: abandoned ? j.steps : j.steps.map((s) => ({ ...s, done: true, have: s.need }))
            }
          : j
      )
    })
    get().persist()
  },

  abandonJob: (id) => {
    set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, status: 'abandoned' as const } : j)) })
    get().persist()
  },

  completeJob: (id) => {
    set({
      jobs: get().jobs.map((j) =>
        j.id === id
          ? { ...j, status: 'complete', steps: j.steps.map((s) => ({ ...s, done: true, have: s.need })) }
          : j
      )
    })
    get().persist()
  },

  toggleStep: (jobId, stepId) => {
    set({
      jobs: get().jobs.map((j) => {
        if (j.id !== jobId) return j
        const steps = j.steps.map((s) => {
          if (s.id !== stepId) return s
          const done = !s.done
          return { ...s, done, have: done ? s.need : 0 }
        })
        const allDone = steps.length > 0 && steps.every((s) => s.done)
        return { ...j, steps, status: allDone ? 'complete' : 'active' }
      })
    })
    get().persist()
  }
}))
