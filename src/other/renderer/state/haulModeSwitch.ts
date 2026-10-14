/**
 * HAUL MODE AUTO LOGIC SWITCH
 *
 * In Other mode a hauling contract is an Other job (kind 'hauling'). When its
 * total SCU (sum of turn-in `need`) reaches otherHaulSwitchMinScu and
 * otherHaulSwitchPrompt is on, offer Haul mode once per missionId.
 * Waits ~3 s after the SCU crosses so the rest of the objectives arrive.
 *
 * bindHaulModeSwitch() runs after Other init(), so jobs already present at
 * start-up (including the start-up log replay) never prompt.
 * Stay: dismiss. Switch: workMode haul, Manifest, scanSession() so the
 * contract lands in the haul review queue.
 */
import { create } from 'zustand'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { otherSetting, resolveWorkMode } from '@other/workMode'
import type { OtherJob } from '@other/otherJob'
import { useOtherJobs } from './otherJobs'

export type PendingHaulSwitch = {
  missionId: string
  title: string
  scu: number
}

interface HaulModeSwitchState {
  pending: PendingHaulSwitch[]
  stayInOther: () => void
  switchToHaul: () => void
}

const SETTLE_MS = 3000

let bound = false
/** missionIds already offered, or present when we bound */
const seen = new Set<string>()
const timers = new Map<string, number>()
let boundAt = 0

/** accepted before we bound (start-up log replay arriving late) */
function oldAccept(job: OtherJob): boolean {
  const t = job.acceptedAt ? Date.parse(job.acceptedAt) : NaN
  return Number.isFinite(t) && t < boundAt - 60_000
}

export function haulJobScu(job: OtherJob): number {
  return job.steps.reduce((sum, s) => sum + (s.kind === 'turnin' ? Number(s.need) || 0 : 0), 0)
}

function promptOn(): { on: boolean; min: number } {
  const settings = useStore.getState().settings
  const on = resolveWorkMode(settings.workMode) === 'other' && otherSetting(settings, 'otherHaulSwitchPrompt')
  return { on, min: otherSetting(settings, 'otherHaulSwitchMinScu') }
}

function candidate(job: OtherJob): boolean {
  return job.status === 'active' && job.kind === 'hauling' && !!job.missionId && !seen.has(job.missionId) && !oldAccept(job)
}

export const useHaulModeSwitch = create<HaulModeSwitchState>((set, get) => ({
  pending: [],

  stayInOther: () => {
    dlog.info('other', 'haul switch: stay in other', { ids: get().pending.map((p) => p.missionId.slice(0, 8)) })
    set({ pending: [] })
  },

  switchToHaul: () => {
    dlog.info('other', 'haul switch: switching work mode to haul', { ids: get().pending.map((p) => p.missionId.slice(0, 8)) })
    set({ pending: [] })
    const store = useStore.getState()
    void (async () => {
      // scanSession skips while workMode is other, so wait for the write
      await store.updateSettings({ workMode: 'haul' })
      useStore.getState().setView('manifest')
      const n = await useStore.getState().scanSession()
      dlog.info('haul', 'haul switch: scanSession after switch', { added: n })
    })()
  }
}))

function fire(missionId: string): void {
  timers.delete(missionId)
  const { on, min } = promptOn()
  if (!on || seen.has(missionId)) return
  const job = useOtherJobs.getState().jobs.find((j) => j.missionId === missionId)
  if (!job || !candidate(job)) return
  const scu = haulJobScu(job)
  if (scu < min) return
  seen.add(missionId)
  dlog.info('other', 'haul switch: offer', { id: missionId.slice(0, 8), scu, min })
  useHaulModeSwitch.setState((s) => ({ pending: [...s.pending, { missionId, title: job.title, scu }] }))
}

function scan(jobs: OtherJob[]): void {
  const { on, min } = promptOn()
  if (!on) return
  for (const job of jobs) {
    if (!candidate(job) || timers.has(job.missionId!)) continue
    if (haulJobScu(job) < min) continue
    const id = job.missionId!
    timers.set(id, window.setTimeout(() => fire(id), SETTLE_MS))
  }
}

export function bindHaulModeSwitch(): void {
  if (bound) return
  bound = true
  boundAt = Date.now()
  for (const j of useOtherJobs.getState().jobs) if (j.missionId) seen.add(j.missionId)
  useOtherJobs.subscribe((s, prev) => {
    if (s.jobs !== prev.jobs) scan(s.jobs)
  })
}
