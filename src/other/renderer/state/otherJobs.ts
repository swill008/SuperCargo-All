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
} from '@other/otherJob'
import { useStore } from '@renderer/state/store'
import { resolveWorkMode } from '@other/workMode'
import { useOtherHistory } from './otherHistory'
import { requestAutoOcrIfEnabled } from './otherCapture'
import {
  kindFromGenerator,
  parseOtherObjectiveText,
  stepFromParse,
  stepKey
} from '@other/otherLog'
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
  steps: { id: string; location: string; item: string; need: number; label?: string }[]
}

interface OtherJobsState {
  ready: boolean
  jobs: OtherJob[]
  expandedId: string | null
  startLocation: string
  groupBy: 'location' | 'job'
  listOrder: 'distance' | 'manual'
  jobOrder: string[]
  init: () => Promise<void>
  persist: () => void
  setExpanded: (id: string | null) => void
  setStartLocation: (v: string) => void
  setGroupBy: (v: 'location' | 'job') => void
  setListOrder: (v: 'distance' | 'manual') => void
  moveJob: (id: string, dir: -1 | 1) => void
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
  const locations = useStore.getState().locations ?? []
  return stepFromParse(nid('step'), parsed, locations)
}

let listenersBound = false

export const useOtherJobs = create<OtherJobsState>((set, get) => ({
  ready: false,
  jobs: [],
  expandedId: null,
  startLocation: '',
  groupBy: 'location',
  listOrder: 'distance',
  jobOrder: [],

  init: async () => {
    if (!window.supercargo.loadOtherJobs) {
      set({ ready: true, jobs: [] })
      return
    }
    const doc = await window.supercargo.loadOtherJobs()
    set({
      ready: true,
      jobs: doc.jobs ?? [],
      startLocation: doc.startLocation ?? '',
      listOrder: doc.listOrder === 'manual' ? 'manual' : 'distance',
      jobOrder: Array.isArray(doc.jobOrder) ? doc.jobOrder : []
    })
    useOtherHistory.getState().load(doc)

    if (!listenersBound) {
      listenersBound = true
      window.supercargo.onOtherAccepted?.((e) => {
        get().ingestAccepted(e)
        const job = get().jobs.find((j) => j.missionId === e.missionId || j.id === e.missionId)
        if (job) requestAutoOcrIfEnabled(job.id)
      })
      window.supercargo.onOtherSessionDrop?.(() => get().dropLogSession())
      window.supercargo.onObjective((e) => get().ingestObjective(e))
      window.supercargo.onContractEnded((e) => get().ingestEnded(e))
    }

    const saved = await window.supercargo.getSettings()
    const logPath = saved.gameLogPath
    if (resolveWorkMode(saved.workMode) === 'other' && logPath && window.supercargo.scanOtherJobs) {
      const scanned = await window.supercargo.scanOtherJobs(logPath)
      const contracts: ScannedContract[] = Array.isArray(scanned) ? scanned : scanned.contracts
      const live = new Set(contracts.map((c) => c.accepted.missionId))
      const byMission = Array.isArray(scanned) ? {} : (scanned.objectivesByMission ?? {})
      for (const c of contracts) {
        get().ingestAccepted(c.accepted)
        for (const o of c.objectives) get().ingestObjective(o)
      }
      for (const j of get().jobs) {
        if (j.source === 'manual' || j.objectivesLocked) continue
        if (!j.missionId || j.steps.length > 0) continue
        for (const o of byMission[j.missionId] ?? []) get().ingestObjective(o)
      }
      set({
        jobs: get().jobs.map((j) =>
          j.status === 'active' && j.source !== 'manual' && j.missionId && !live.has(j.missionId)
            ? { ...j, status: 'abandoned' as const }
            : j
        )
      })
      get().persist()
    }
  },

  persist: () => {
    const doc: OtherJobsDoc = {
      jobs: get().jobs,
      history: useOtherHistory.getState().history,
      startLocation: get().startLocation,
      listOrder: get().listOrder,
      jobOrder: get().jobOrder
    }
    void window.supercargo.saveOtherJobs?.(doc)
  },

  setExpanded: (id) => set({ expandedId: id }),
  setStartLocation: (v) => {
    set({ startLocation: v })
    get().persist()
  },
  setGroupBy: (v) => set({ groupBy: v }),
  setListOrder: (v) => {
    set({ listOrder: v, groupBy: v === 'manual' ? 'job' : get().groupBy })
    get().persist()
  },
  moveJob: (id, dir) => {
    const active = get().jobs.filter((j) => j.status === 'active').map((j) => j.id)
    const saved = get().jobOrder.filter((x) => active.includes(x))
    const order = [...saved, ...active.filter((x) => !saved.includes(x))]
    const i = order.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    set({ jobOrder: next, listOrder: 'manual', groupBy: 'job' })
    get().persist()
  },

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
            label: (row.label || '').trim() || labelFor(edit.kind, location, item, need),
            location,
            pickupLocation: prev?.pickupLocation,
            pickupLocationRaw: prev?.pickupLocationRaw,
            pickupLocationSnapped: prev?.pickupLocationSnapped,
            pickedUp: prev?.pickedUp,
            item: item || undefined,
            have: prev?.done ? need : 0,
            need,
            done: prev?.done ?? false
          }
        })
        const before = j.steps.map((s) => `${s.label}|${s.location}|${s.item || ''}|${s.need}`).join('\n')
        const after = steps.map((s) => `${s.label}|${s.location}|${s.item || ''}|${s.need}`).join('\n')
        return {
          ...j,
          title: edit.title.trim() || j.title,
          kind: edit.kind,
          reward: Math.max(0, Number(edit.reward) || 0),
          steps,
          status: j.status === 'active' && steps.length > 0 && steps.every((s) => s.done) ? 'complete' : j.status,
          objectivesLocked: true,
          edited: j.edited || before !== after
        }
      })
    })
    get().persist()
  },

  ingestAccepted: (e) => {
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
      contractName: e.contractName || undefined,
      source: 'log'
    }
    set({ jobs: [...jobs, job], expandedId: job.id })
    get().persist()
  },

  ingestObjective: (e) => {
    const job = get().jobs.find((j) => j.missionId === e.missionId && j.status === 'active')
    if (!job) return
    if (job.source === 'manual' || job.objectivesLocked) return
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
    set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, status: 'abandoned' as const, objectivesLocked: true } : j)) })
    get().persist()
  },

  completeJob: (id) => {
    set({
      jobs: get().jobs.map((j) =>
        j.id === id
          ? { ...j, status: 'complete', objectivesLocked: true, steps: j.steps.map((s) => ({ ...s, done: true, have: s.need })) }
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
          if (s.pickupLocation && !s.pickedUp && !s.done) {
            return { ...s, pickedUp: true }
          }
          const done = !s.done
          return { ...s, done, pickedUp: done ? true : s.pickupLocation ? false : s.pickedUp, have: done ? s.need : 0 }
        })
        const allDone = steps.length > 0 && steps.every((s) => s.done)
        return { ...j, steps, status: allDone ? 'complete' : 'active' }
      })
    })
    get().persist()
  }
}))
