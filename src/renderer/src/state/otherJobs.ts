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

export interface OtherJobDraft {
  title: string
  kind: OtherJobKind
  reward: number
  location: string
  item: string
  need: number
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
  abandonJob: (id: string) => void
  completeJob: (id: string) => void
  toggleStep: (jobId: string, stepId: string) => void
}

let seq = 0
function nid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
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
  },

  persist: () => {
    const doc: OtherJobsDoc = { jobs: get().jobs }
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
      createdAt: Date.now()
    }
    set({ jobs: [...jobs, job], expandedId: job.id })
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
        const allDone = steps.every((s) => s.done)
        return { ...j, steps, status: allDone ? 'complete' : 'active' }
      })
    })
    get().persist()
  }
}))
