/**
 * Renderer store for Other-mode jobs.
 * Kept out of state/store.ts so haul pack/route merges stay clean.
 * Job rules: src/other/STANDALONE.md. One reducer (applyEvent) for live log events and the start-up scan.
 */
import { create } from 'zustand'
import {
  nextJobRef,
  type OtherHistoryEntry,
  type OtherJob,
  type OtherJobKind,
  type OtherJobsDoc,
  type ListOrder,
  type OtherMarkerZone,
  type OtherStep
} from '@other/otherJob'
import { calibrateZone, resolveMarker, type MarkerPos } from '@other/otherMarkers'
import { findRosterLocation, stepActivePlace } from '@other/otherNext'
import { ACCURACY, type Where, type WhereRunResult, type WhereSource } from '@other/otherWhere'
import { mergeLocations } from './otherPlaces'
import type { OtherLogEvent } from '@other/otherEvents'
import type { OtherAction } from '@other/otherActions'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { trace } from '@renderer/state/trace'
import { otherSetting, resolveWorkMode } from '@other/workMode'
import { useOtherHistory } from './otherHistory'
import { requestAutoOcrIfEnabled } from './otherCapture'
import { findStepByText, kindFromGenerator, stepFromObjectiveText, stepKey } from '@other/otherLog'
import type { AppSettings } from '@shared/types'

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
  /** overlay: shows jobs, never applies log events */
  passive: boolean
  jobs: OtherJob[]
  expandedId: string | null
  startLocation: string
  groupBy: 'location' | 'job'
  listOrder: ListOrder
  jobOrder: string[]
  lastLogEventAt?: string
  /** events applied at exactly lastLogEventAt (doc field) */
  lastLogEventCount: number
  rev: number
  /** game session id (log start time) of the current session */
  sessionAt?: string
  /** marker zone centres per build (doc field) */
  markerZones: Record<string, Record<string, OtherMarkerZone>>
  /** where the player is: newest location clue (tick, objective, inventory, map, display info); doc field */
  where: Where | null
  /** wall-clock ISO time STARTING AT was last typed non-empty (doc field; auto start mode compares it with where.at) */
  startTypedAt?: string
  /** missionId of the active job the game says is tracked (doc field; from r_DisplayInfo "Tracked mission") */
  trackedMissionId?: string
  /** wall-clock ISO time trackedMissionId last changed (doc field) */
  trackedAt?: string
  /** build of the newest log session (doc field) */
  markerBuild?: string
  /** start-up: last game session crashed and active log jobs were kept (rule 6) */
  crashNotice: { kept: number } | null
  dismissCrashNotice: () => void
  init: (opts?: { passive?: boolean }) => Promise<void>
  /** debounced save of the whole doc */
  persist: () => void
  /** reload every doc field from disk (the other window saved) */
  reloadFromDisk: () => Promise<void>
  applyEvent: (e: OtherLogEvent) => void
  applyEvents: (events: OtherLogEvent[], live?: boolean) => void
  setExpanded: (id: string | null) => void
  setStartLocation: (v: string) => void
  setGroupBy: (v: 'location' | 'job') => void
  setListOrder: (v: ListOrder) => void
  moveJob: (id: string, dir: -1 | 1) => void
  placeJob: (id: string, beforeId: string) => void
  addJob: (draft: OtherJobDraft) => void
  applyEdit: (id: string, edit: OtherJobEdit) => void
  abandonJob: (id: string) => void
  restoreJob: (id: string) => void
  completeJob: (id: string) => void
  toggleStep: (jobId: string, stepId: string) => void
  /** WHERE AM I result: main window applies + saves (newest wins); the overlay ignores it. Never moves the log watermark.
   *  With the run result: 'live' reads trace only on a change; info.trackedMission sets trackedMissionId (O2). */
  applyWhere: (w: Where | null | undefined, r?: Pick<WhereRunResult, 'why' | 'info'>) => void
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

const short = (id?: string): string | undefined => id?.slice(0, 8)

/** one 'decide' trace record: what the reducer or a user action did */
function decide(what: string, missionId?: string, data?: Record<string, unknown>): void {
  trace({ area: 'decide', mode: 'other', what, missionId, data })
}

// event latency: log timestamp -> applied, sampled at most once a second
let lastLatencyAt = 0
function sampleLatency(e: OtherLogEvent): void {
  const now = Date.now()
  if (now - lastLatencyAt < 1000) return
  const t = Date.parse(e.at)
  if (!Number.isFinite(t)) return
  lastLatencyAt = now
  trace({ area: 'perf', mode: 'other', what: 'event latency', ms: now - t, data: { kind: e.kind } })
}
const isMain = (): boolean => window.location.hash.replace(/^#\/?/, '') !== 'compact'

function activeJobOrder(s: { jobs: OtherJob[]; jobOrder: string[] }): string[] {
  const active = s.jobs.filter((j) => j.status === 'active').map((j) => j.id)
  const saved = s.jobOrder.filter((x) => active.includes(x))
  return [...saved, ...active.filter((x) => !saved.includes(x))]
}

// settings: the upstream store until it has loaded, then the copy read at init
let bootSettings: AppSettings | null = null
function settingsNow(): AppSettings {
  const st = useStore.getState()
  return st.ready || !bootSettings ? st.settings : bootSettings
}

const undone = (steps: OtherStep[]): OtherStep[] =>
  steps.map((s) => ({ ...s, done: false, have: 0, pickedUp: s.pickupLocation ? false : s.pickedUp }))

function fromHistory(h: OtherHistoryEntry): OtherJob {
  return {
    id: h.id,
    ref: h.ref,
    title: h.title,
    kind: h.kind,
    reward: h.reward,
    status: h.outcome === 'completed' ? 'complete' : 'abandoned',
    steps: h.steps,
    createdAt: h.createdAt,
    missionId: h.missionId,
    generator: h.generator,
    contractName: h.contractName,
    source: h.source,
    rep: h.rep,
    sharedBy: h.sharedBy,
    sessionAt: h.sessionAt,
    acceptedAt: h.acceptedAt,
    endedAt: h.endedAt,
    filledBy: h.filledBy,
    edited: h.edited
  }
}

// ---- reducer ---------------------------------------------------------------

interface Draft {
  jobs: OtherJob[]
  history: OtherHistoryEntry[]
  lastLogEventAt?: string
  lastLogEventCount: number
  sessionAt?: string
  expandedId: string | null
  markerZones: Record<string, Record<string, OtherMarkerZone>>
  markerBuild?: string
  where: Where | null
}

// latest marker per objective, per mission; this run only (markers come before their objectives)
const missionMarkers = new Map<string, Map<string, MarkerPos>>()

/** diagnostics: latest raw marker per mission/objective (this run) */
export function otherMissionMarkers(): ReadonlyMap<string, ReadonlyMap<string, MarkerPos>> {
  return missionMarkers
}

/**
 * Marker -> step: by ObjectiveId. "New Objective" and CreateMarker both carry the objective's id,
 * so a step takes the position of its own objective's latest marker. Steps filled by OCR (or edits)
 * have no objectiveId: those without a UEX place take the mission's markers that no other step's
 * objectiveId uses, in log order (a mission's markers and steps come in the same order), so the
 * n-th such step gets the n-th unused marker; with one unused marker, the first such step gets it.
 * Only steps whose place has no UEX coords get a position; a step whose marker can't be placed
 * keeps none (or the last one it had). jobId limits the pass to one job.
 */
function placeSteps(d: Draft, ctx: Ctx, jobId?: string): void {
  if (!otherSetting(ctx.settings, 'otherMarkerDistance') || !d.markerBuild) return
  const zones = d.markerZones[d.markerBuild] ?? {}
  const locations = useStore.getState().locations ?? []
  const hasUex = (s: OtherStep): boolean => {
    const named = findRosterLocation(s.location, locations)
    return !!named && named.x != null && named.y != null && named.z != null
  }
  d.jobs = d.jobs.map((j) => {
    if ((jobId && j.id !== jobId) || !j.missionId) return j
    const marks = missionMarkers.get(j.missionId)
    if (!marks) return j
    // markers no step claims by objectiveId, in log order (Map keeps first-insert order)
    const claimed = new Set(j.steps.map((s) => s.objectiveId).filter(Boolean))
    const unused = [...marks.entries()].filter(([oid]) => !claimed.has(oid))
    let nextUnused = 0
    let changed = false
    const steps = j.steps.map((s) => {
      let m = s.objectiveId ? marks.get(s.objectiveId) : undefined
      let byOrder: string | undefined
      if (!m && !s.objectiveId) {
        if (hasUex(s)) return s
        const hit = unused[nextUnused++]
        if (!hit) return s
        byOrder = hit[0]
        m = hit[1]
      }
      if (!m) return s
      if (!byOrder && hasUex(s)) return s
      const pos = resolveMarker(zones, m)
      if (!pos || (s.position && s.position.x === pos.x && s.position.y === pos.y && s.position.z === pos.z)) return s
      changed = true
      if (byOrder) {
        decide('marker linked by order', j.missionId, { ref: j.ref, step: stepKey(s), objectiveId: byOrder, unused: unused.length, zone: m.zoneHostId, build: d.markerBuild, pos })
        dlog.debug('other', 'marker linked to step by order', { ref: j.ref, stepKey: stepKey(s), unused: unused.length, zone: m.zoneHostId })
      } else {
        decide('marker placed', j.missionId, { ref: j.ref, step: stepKey(s), objectiveId: s.objectiveId, zone: m.zoneHostId, build: d.markerBuild, pos })
        dlog.debug('other', 'marker position on step', { ref: j.ref, stepKey: stepKey(s), zone: m.zoneHostId, build: d.markerBuild })
      }
      return { ...s, position: pos }
    })
    return changed ? { ...j, steps } : j
  })
}

interface Ctx {
  live: boolean
  settings: AppSettings
  /** job ids accepted live, for auto-OCR after the set */
  accepted: string[]
  toast?: string
}

function setStep(d: Draft, jobId: string, idx: number, patch: Partial<OtherStep>): void {
  d.jobs = d.jobs.map((j) =>
    j.id === jobId ? { ...j, steps: j.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } : j
  )
}

/** job + step index for an Objective Complete / Withdrawn line; missionId may be missing */
function findObjective(d: Draft, missionId: string | undefined, text: string): { job: OtherJob; idx: number } | null {
  const pool = missionId
    ? d.jobs.filter((j) => j.missionId === missionId)
    : d.jobs.filter((j) => j.status === 'active' && j.source !== 'manual')
  for (const job of pool) {
    const idx = findStepByText(job.steps, text)
    if (idx >= 0) return { job, idx }
  }
  return null
}

const whenMs = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN)

/** newest wins: an incoming clue older than the current where is dropped (scan replays carry older times) */
function isNewer(cur: Where | null, next: { at: string }): boolean {
  if (!cur) return true
  const a = whenMs(cur.at)
  const b = whenMs(next.at)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true
  return b >= a
}

/** N1: base accuracy for a log / tick clue */
const CLUE_ACCURACY: Partial<Record<WhereSource, number>> = {
  inventory: ACCURACY.inventory,
  objective: ACCURACY.objective,
  tick: ACCURACY.tick
}

/** O2: first 8 chars of a mission uuid, OCR-tolerant (O->0, I/l->1), lower case; '' when too short */
export function missionKey(id: string | undefined): string {
  if (!id) return ''
  const k = id
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 8)
  return k.length === 8 ? k : ''
}

/** O2: the active job whose missionId starts with the same 8 hex chars as the tracked id */
export function matchTrackedMission(jobs: OtherJob[], trackedId: string | undefined): OtherJob | undefined {
  const k = missionKey(trackedId)
  if (!k) return undefined
  return jobs.find((j) => j.status === 'active' && !!j.missionId && missionKey(j.missionId) === k)
}

/** a Where for a named place; system, body and point from the roster when it knows the place */
function whereFromPlace(name: string, source: WhereSource, at: string): Where {
  const loc = findRosterLocation(name, mergeLocations(useStore.getState().locations))
  const point =
    loc && loc.x != null && loc.y != null && loc.z != null
      ? { x: loc.x, y: loc.y, z: loc.z, system: loc.system ?? null, body: loc.body ?? null }
      : undefined
  const accuracy = CLUE_ACCURACY[source]
  return {
    name,
    label: name,
    system: loc?.system ?? null,
    body: loc?.body ?? null,
    source,
    at,
    ...(point ? { point } : {}),
    ...(accuracy !== undefined ? { accuracy } : {})
  }
}

/** diagnostics: one `where` change (LOCATION HISTORY in the export) */
export interface WhereHistoryEntry {
  at: string
  source: WhereSource | null
  label: string | null
  accuracy: number | null
  outcome: 'applied' | 'older-ignored' | 'cleared'
}
const WHERE_HISTORY_MAX = 30
const whereRing: WhereHistoryEntry[] = []
function recordWhere(w: Where | null, outcome: WhereHistoryEntry['outcome'], src?: WhereSource): void {
  whereRing.push({ at: w?.at ?? new Date().toISOString(), source: w?.source ?? src ?? null, label: w?.label ?? w?.name ?? null, accuracy: w?.accuracy ?? null, outcome })
  if (whereRing.length > WHERE_HISTORY_MAX) whereRing.splice(0, whereRing.length - WHERE_HISTORY_MAX)
}
/** the last 30 `where` changes, oldest first (live re-reads only when something changed) */
export function whereHistory(): readonly WhereHistoryEntry[] {
  return whereRing.map((e) => ({ ...e }))
}

/** set where from a clue when it is not older than the current one; trace either way
 *  (quiet: live re-reads trace only when name / label / source / accuracy change) */
function takeWhere(cur: Where | null, next: Where, why?: Record<string, unknown>, quiet = false): Where | null {
  const from = cur ? { name: cur.name, source: cur.source, at: cur.at, accuracy: cur.accuracy } : null
  const to = { name: next.name, source: next.source, at: next.at, roster: !!next.point, accuracy: next.accuracy }
  const same =
    !!cur && cur.name === next.name && cur.label === next.label && cur.source === next.source && cur.accuracy === next.accuracy
  if (!isNewer(cur, next)) {
    if (quiet) return cur
    decide('where: older clue ignored', undefined, { from, to, ...why })
    dlog.debug('other', 'where: older clue ignored', { from, to })
    recordWhere(next, 'older-ignored')
    return cur
  }
  if (!(quiet && same)) {
    recordWhere(next, 'applied')
    decide(`where: ${next.source}`, undefined, { from, to, ...why })
    dlog.debug('other', 'where set', { from, to })
  }
  return next
}

function reduce(d: Draft, e: OtherLogEvent, ctx: Ctx): void {
  const mode = resolveWorkMode(ctx.settings.workMode)
  const mid = 'missionId' in e ? e.missionId : undefined
  switch (e.kind) {
    case 'session':
      d.sessionAt = e.at
      if (e.build) d.markerBuild = e.build
      decide('session', undefined, { at: e.at, build: e.build, live: ctx.live })
      dlog.info('other', 'log session', { at: e.at, build: e.build })
      break

    case 'marker': {
      const m: MarkerPos = { zoneHostId: e.zoneHostId, x: e.x, y: e.y, z: e.z }
      const marks = missionMarkers.get(e.missionId) ?? new Map<string, MarkerPos>()
      marks.set(e.objectiveId, m)
      missionMarkers.set(e.missionId, marks)
      if (!d.markerBuild) {
        decide('marker: no build, not calibrated', mid, { objectiveId: e.objectiveId, zone: e.zoneHostId })
        dlog.debug('other', 'marker: no game build yet, not calibrated', { id: short(e.missionId) })
        break
      }
      const table = d.markerZones[d.markerBuild] ?? {}
      const r = calibrateZone(table, m, useStore.getState().locations ?? [])
      decide(r.zones !== table ? 'marker calibrated' : 'marker stored', mid, {
        objectiveId: e.objectiveId,
        zone: e.zoneHostId,
        build: d.markerBuild,
        change: r.change,
        place: r.place,
        n: r.zones[e.zoneHostId]?.n
      })
      if (r.zones !== table) {
        d.markerZones = { ...d.markerZones, [d.markerBuild]: r.zones }
        dlog.debug('other', 'marker zone calibration', { build: d.markerBuild, zone: e.zoneHostId, change: r.change, place: r.place, n: r.zones[e.zoneHostId]?.n })
      }
      // a newly learned zone can place earlier markers too
      const job = d.jobs.find((j) => j.missionId === e.missionId)
      if (r.change === 'new' || r.change === 'root') placeSteps(d, ctx)
      else if (job) placeSteps(d, ctx, job.id)
      break
    }

    case 'accepted': {
      // rule 1: Haul mode never creates or reactivates Other jobs
      if (mode !== 'other') {
        decide('ignored: haul mode', mid, { title: e.title })
        dlog.debug('other', 'accepted ignored: haul mode', { id: short(e.missionId) })
        break
      }
      const existing = d.jobs.find((j) => j.missionId === e.missionId)
      const archived = existing ? undefined : d.history.find((h) => h.missionId === e.missionId)
      if (existing || archived) {
        // rule 4: re-share reactivates, even from history
        const base = existing ?? fromHistory(archived!)
        const job: OtherJob = {
          ...base,
          status: 'active',
          objectivesLocked: undefined,
          steps: base.status === 'complete' ? undone(base.steps) : base.steps,
          rep: e.rep ?? base.rep,
          sharedBy: e.sharedBy ?? base.sharedBy,
          acceptedAt: e.at,
          endedAt: undefined
        }
        decide(base.status !== 'active' ? 'reactivated (re-share)' : 'accepted again: already active', mid, {
          ref: job.ref,
          from: archived ? `history:${archived.outcome}` : base.status,
          rep: job.rep,
          sharedBy: job.sharedBy
        })
        if (base.status !== 'active') {
          dlog.info('other', 'job status change', {
            ref: job.ref,
            id: short(e.missionId),
            from: archived ? `history:${archived.outcome}` : base.status,
            to: 'active',
            reason: 'accepted again (re-share)'
          })
        }
        if (archived) {
          d.history = d.history.filter((h) => h !== archived)
          d.jobs = [...d.jobs, job]
        } else d.jobs = d.jobs.map((j) => (j.id === base.id ? job : j))
        if (ctx.live && base.status !== 'active') ctx.accepted.push(job.id)
        break
      }
      const kind = kindFromGenerator(e.generator || '', e.title || '', e.contractName || '')
      const job: OtherJob = {
        id: e.missionId,
        ref: nextJobRef(d.jobs, d.history),
        title: e.title || 'Contract',
        kind,
        reward: 0,
        status: 'active',
        steps: [],
        createdAt: Date.now(),
        missionId: e.missionId,
        generator: e.generator || undefined,
        contractName: e.contractName || undefined,
        source: 'log',
        rep: e.rep,
        sharedBy: e.sharedBy,
        sessionAt: d.sessionAt,
        acceptedAt: e.at
      }
      decide(`created ${job.ref}`, mid, {
        ref: job.ref,
        kind,
        title: job.title,
        generator: e.generator,
        contractName: e.contractName,
        rep: e.rep,
        sharedBy: e.sharedBy,
        live: ctx.live
      })
      dlog.info('other', 'job created', {
        ref: job.ref,
        id: short(e.missionId),
        source: 'log',
        kind,
        title: job.title,
        generator: e.generator,
        rep: e.rep,
        shared: !!e.sharedBy,
        live: ctx.live
      })
      d.jobs = [...d.jobs, job]
      if (ctx.live) {
        d.expandedId = job.id
        ctx.accepted.push(job.id)
      }
      break
    }

    case 'objective': {
      const job = d.jobs.find((j) => j.missionId === e.missionId)
      if (!job) {
        decide('objective: no job', mid, { text: e.text })
        dlog.debug('other', 'objective: no job', { id: short(e.missionId) })
        break
      }
      if (job.source === 'manual' || job.objectivesLocked) {
        decide('ignored: locked', mid, { ref: job.ref, source: job.source, locked: !!job.objectivesLocked, text: e.text })
        dlog.info('other', 'objective dropped: job locked/manual', { ref: job.ref, source: job.source, locked: !!job.objectivesLocked })
        break
      }
      if (job.steps.some((s) => s.logText === e.text)) {
        decide('step duplicate', mid, { ref: job.ref, text: e.text })
        dlog.debug('other', 'objective dropped: duplicate step', { ref: job.ref, text: e.text })
        break
      }
      const step: OtherStep = { ...stepFromObjectiveText(e.text, useStore.getState().locations ?? []), logText: e.text }
      if (e.objectiveId) step.objectiveId = e.objectiveId
      decide('step added', mid, {
        ref: job.ref,
        text: e.text,
        objectiveId: e.objectiveId,
        step: { kind: step.kind, label: step.label, location: step.location, item: step.item, need: step.need },
        generic: step.kind === 'go' && !step.item && step.location === e.text.replace(/[\s:.]+$/, '').trim()
      })
      dlog.info('other', 'step added from objective', { ref: job.ref, id: short(e.missionId), stepKey: stepKey(step), steps: job.steps.length + 1 })
      d.jobs = d.jobs.map((j) => (j.id === job.id ? { ...j, steps: [...j.steps, step] } : j))
      if (e.objectiveId) placeSteps(d, ctx, job.id)
      break
    }

    case 'objectiveComplete': {
      if (!otherSetting(ctx.settings, 'otherAutoTickObjectives')) {
        decide('ignored: auto-tick off', mid, { text: e.text })
        break
      }
      const hit = findObjective(d, e.missionId, e.text)
      if (!hit) {
        decide('no step matched', mid, { text: e.text, event: 'objectiveComplete' })
        dlog.debug('other', 'objective complete: no step', { id: short(e.missionId), text: e.text })
        break
      }
      const s = hit.job.steps[hit.idx]
      decide(s.done ? 'objective complete: step already done' : 'ticked by Objective Complete', mid ?? hit.job.missionId, {
        ref: hit.job.ref,
        text: e.text,
        step: stepKey(s)
      })
      if (s.done) break
      dlog.info('other', 'step ticked from log', { ref: hit.job.ref, stepKey: stepKey(s) })
      // B2: the place of the step as it was before the tick
      {
        const place = stepActivePlace(s).trim()
        if (place) d.where = takeWhere(d.where, whereFromPlace(place, 'objective', e.at), { ref: hit.job.ref, step: stepKey(s) })
      }
      setStep(d, hit.job.id, hit.idx, { done: true, have: s.need, pickedUp: s.pickupLocation ? true : s.pickedUp })
      break
    }

    case 'objectiveWithdrawn': {
      const hit = findObjective(d, e.missionId, e.text)
      if (!hit) {
        decide('no step matched', mid, { text: e.text, event: 'objectiveWithdrawn' })
        dlog.debug('other', 'objective withdrawn: no step', { id: short(e.missionId), text: e.text })
        break
      }
      decide('withdrawn', mid ?? hit.job.missionId, { ref: hit.job.ref, text: e.text, step: stepKey(hit.job.steps[hit.idx]) })
      dlog.info('other', 'step withdrawn', { ref: hit.job.ref, stepKey: stepKey(hit.job.steps[hit.idx]) })
      setStep(d, hit.job.id, hit.idx, { withdrawn: true })
      break
    }

    case 'ended': {
      // rules 2-3: two outcomes, latest ending wins (also on archived entries)
      const to = e.outcome === 'complete' ? 'complete' : 'abandoned'
      const job = d.jobs.find((j) => j.missionId === e.missionId)
      if (job) {
        decide(`ended ${to}`, mid, { ref: job.ref, from: job.status, completionType: e.completionType, reason: e.reason })
        dlog.info('other', 'job status change', {
          ref: job.ref,
          id: short(e.missionId),
          from: job.status,
          to,
          reason: `EndMission ${e.completionType}${e.reason ? ` (${e.reason})` : ''}`
        })
        d.jobs = d.jobs.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: to,
                endedAt: e.at,
                steps: to === 'complete' ? j.steps.map((s) => ({ ...s, done: true, have: s.need })) : j.steps
              }
            : j
        )
        break
      }
      const h = d.history.find((x) => x.missionId === e.missionId)
      if (h) {
        const outcome = to === 'complete' ? 'completed' : 'abandoned'
        decide(`ended ${to} (history)`, mid, { ref: h.ref, from: h.outcome, completionType: e.completionType, reason: e.reason })
        dlog.info('other', 'history outcome change', { ref: h.ref, id: short(e.missionId), from: h.outcome, to: outcome, reason: `EndMission ${e.completionType}` })
        d.history = d.history.map((x) => (x === h ? { ...x, outcome, endedAt: e.at } : x))
      } else {
        decide('ended: no job', mid, { completionType: e.completionType })
        dlog.debug('other', 'ended: no job', { id: short(e.missionId), completion: e.completionType })
      }
      break
    }

    case 'disconnect':
    case 'quit': {
      // rule 5: quitting ends every active log job
      const hit = d.jobs.filter((j) => j.status === 'active' && j.source === 'log')
      decide(`${e.kind} abandoned ${hit.length}`, undefined, { refs: hit.map((j) => j.ref), live: ctx.live })
      for (const j of hit) {
        dlog.info('other', 'job status change', { ref: j.ref, id: short(j.missionId), from: 'active', to: 'abandoned', reason: e.kind === 'quit' ? 'game quit' : 'player disconnect' })
      }
      if (hit.length) {
        d.jobs = d.jobs.map((j) =>
          j.status === 'active' && j.source === 'log' ? { ...j, status: 'abandoned' as const, endedAt: e.at } : j
        )
      }
      break
    }

    case 'contractLimit':
      decide('contract limit', undefined, { live: ctx.live, mode })
      dlog.info('other', 'contract limit', { at: e.at, live: ctx.live })
      if (ctx.live && mode === 'other' && otherSetting(ctx.settings, 'otherContractLimitToast')) {
        ctx.toast = 'Contract not accepted: contract limit reached.'
      }
      break

    case 'location':
      // B3: inventory clue; null (left the known place) clears only an inventory where
      if (e.name) d.where = takeWhere(d.where, whereFromPlace(e.name, 'inventory', e.at))
      else if (d.where?.source === 'inventory' && isNewer(d.where, e)) {
        decide('where: cleared (inventory left place)', undefined, { from: { name: d.where.name, source: d.where.source, at: d.where.at }, to: null })
        dlog.debug('other', 'where cleared by inventory', { from: d.where.name })
        recordWhere({ ...d.where, at: e.at }, 'cleared')
        d.where = null
      } else decide('where: inventory left place, kept', undefined, { from: d.where ? { name: d.where.name, source: d.where.source, at: d.where.at } : null })
      break
  }
  // exact watermark: the scan skips the first lastLogEventCount events at lastLogEventAt
  if (e.at === d.lastLogEventAt) d.lastLogEventCount += 1
  else if (!d.lastLogEventAt || e.at > d.lastLogEventAt) {
    d.lastLogEventAt = e.at
    d.lastLogEventCount = 1
  }
}

/** the scan returns events with at >= since; drop the ones already applied at exactly since */
function skipApplied(events: OtherLogEvent[], since: string | undefined, count: number): OtherLogEvent[] {
  if (!since || count <= 0) return events
  let left = count
  const out = events.filter((e) => {
    if (left > 0 && e.at === since) {
      left -= 1
      return false
    }
    return true
  })
  dlog.debug('other', 'scan: skipped events already applied', { since, skipped: count - left })
  decide(`skipped by watermark (${count - left})`, undefined, { since, count, skipped: count - left })
  return out
}

// ---- persistence -----------------------------------------------------------

let saveTimer: number | null = null

/** the one doc builder: every save writes every field */
export function buildOtherDoc(): OtherJobsDoc {
  const s = useOtherJobs.getState()
  return {
    jobs: s.jobs,
    history: useOtherHistory.getState().history,
    startLocation: s.startLocation,
    listOrder: s.listOrder,
    jobOrder: s.jobOrder,
    lastLogEventAt: s.lastLogEventAt,
    lastLogEventCount: s.lastLogEventCount,
    markerZones: s.markerZones,
    markerBuild: s.markerBuild,
    where: s.where,
    startTypedAt: s.startTypedAt,
    trackedMissionId: s.trackedMissionId,
    trackedAt: s.trackedAt,
    rev: s.rev
  }
}

function saveNow(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  // rule 8: the overlay never writes
  if (useOtherJobs.getState().passive) return
  const rev = (useOtherJobs.getState().rev ?? 0) + 1
  useOtherJobs.setState({ rev })
  const doc = buildOtherDoc()
  dlog.debug('other', 'persist', {
    rev,
    jobs: doc.jobs.length,
    active: doc.jobs.filter((j) => j.status === 'active').length,
    history: doc.history.length,
    listOrder: doc.listOrder,
    jobOrder: doc.jobOrder?.length,
    lastLogEventAt: doc.lastLogEventAt,
    lastLogEventCount: doc.lastLogEventCount
  })
  void window.supercargo.saveOtherJobs?.(doc)
}

/** flush a pending debounced save now (main window closing) */
function flushSave(): void {
  if (saveTimer !== null) saveNow()
}

/** overlay: send a job action to the main window, which applies and saves it (rule 8) */
function sendAction(a: OtherAction): void {
  dlog.debug('other', 'overlay action sent to main window', a)
  window.supercargo.otherAction?.(a)
}

let listenersBound = false
/** diagnostics: the newest WHERE AM I read this window received (main window only) */
let lastWhereRun: (WhereRunResult & { receivedAt: string }) | null = null
export function otherLastWhereRun(): (WhereRunResult & { receivedAt: string }) | null {
  return lastWhereRun
}
/** diagnostics: live ('live') reads received this run (main window) */
let liveWhereReads = 0
export function otherLiveWhereReads(): number {
  return liveWhereReads
}
/** init's promise, once per window (see init) */
let initOnce: Promise<void> | null = null
let jobsChangedBound = false
let mainBound = false

export const useOtherJobs = create<OtherJobsState>((set, get) => {
  /** one set + one save for a batch of events */
  const commit = (events: OtherLogEvent[], live: boolean): void => {
    if (!events.length) return
    const s = get()
    const d: Draft = {
      jobs: s.jobs,
      history: useOtherHistory.getState().history,
      lastLogEventAt: s.lastLogEventAt,
      lastLogEventCount: s.lastLogEventCount,
      sessionAt: s.sessionAt,
      expandedId: s.expandedId,
      markerZones: s.markerZones,
      markerBuild: s.markerBuild,
      where: s.where
    }
    const ctx: Ctx = { live, settings: settingsNow(), accepted: [] }
    for (const e of events) reduce(d, e, ctx)
    if (live) for (const e of events) sampleLatency(e)
    set({
      where: d.where,
      jobs: d.jobs,
      lastLogEventAt: d.lastLogEventAt,
      lastLogEventCount: d.lastLogEventCount,
      sessionAt: d.sessionAt,
      expandedId: d.expandedId,
      markerZones: d.markerZones,
      markerBuild: d.markerBuild
    })
    if (d.history !== useOtherHistory.getState().history) useOtherHistory.setState({ history: d.history })
    get().persist()
    if (ctx.toast) useStore.setState({ notice: ctx.toast })
    for (const id of ctx.accepted) requestAutoOcrIfEnabled(id)
  }

  const loadDoc = (doc: OtherJobsDoc): void => {
    set({
      jobs: doc.jobs ?? [],
      startLocation: typeof doc.startLocation === 'string' ? doc.startLocation : '',
      listOrder: doc.listOrder === 'manual' || doc.listOrder === 'route' ? doc.listOrder : 'distance',
      jobOrder: Array.isArray(doc.jobOrder) ? doc.jobOrder : [],
      lastLogEventAt: doc.lastLogEventAt,
      lastLogEventCount: typeof doc.lastLogEventCount === 'number' ? doc.lastLogEventCount : 0,
      markerZones: doc.markerZones && typeof doc.markerZones === 'object' ? doc.markerZones : {},
      markerBuild: typeof doc.markerBuild === 'string' ? doc.markerBuild : undefined,
      where: doc.where && typeof doc.where === 'object' ? doc.where : null,
      startTypedAt: typeof doc.startTypedAt === 'string' ? doc.startTypedAt : undefined,
      trackedMissionId: typeof doc.trackedMissionId === 'string' ? doc.trackedMissionId : undefined,
      trackedAt: typeof doc.trackedAt === 'string' ? doc.trackedAt : undefined,
      rev: doc.rev ?? 0
    })
    useOtherHistory.getState().load(doc)
  }

  const runInit = async (opts?: { passive?: boolean }): Promise<void> => {
    // rule 8: only the main window applies log events
    const passive = !!opts?.passive || !isMain()
    set({ passive })
    // rule 8: the main window is the only writer, so only the overlay reloads on a save.
    // The main window never reloads: its memory is the newest state, and a reload could drop
    // a pending debounced save (an external edit of the file while the app runs is not supported).
    if (passive && !jobsChangedBound) {
      jobsChangedBound = true
      window.supercargo.onOtherJobsChanged?.((p) => {
        dlog.debug('other', 'jobs saved by main window; reloading', { rev: p?.rev })
        void get().reloadFromDisk()
      })
    }
    if (!passive && !mainBound) {
      mainBound = true
      window.supercargo.onOtherAction?.((a) => {
        dlog.info('other', 'overlay action', a)
        if (a.type === 'toggleStep') get().toggleStep(a.jobId, a.stepId)
        else if (a.type === 'complete') get().completeJob(a.jobId)
        else if (a.type === 'abandon') get().abandonJob(a.jobId)
      })
      window.addEventListener('beforeunload', flushSave)
      // WHERE AM I (hotkey or overlay button): main process broadcasts each read to every window
      window.supercargo.onOtherWhere?.((r) => {
        lastWhereRun = { ...r, receivedAt: new Date().toISOString() }
        if (r.why === 'live') liveWhereReads += 1
        if (r.why === 'live') dlog.debug('other', 'where am i live result', { ok: r.ok, zone: r.zone, error: r.error, ms: r.ms, label: r.where?.label })
        else dlog.info('other', 'where am i result', { ok: r.ok, zone: r.zone, error: r.error, ms: r.ms, label: r.where?.label })
        get().applyWhere(r.ok ? r.where : undefined, r)
      })
      // steps filled outside the reducer (OCR, edit) have no objectiveId: link this run's markers by order
      let placing = false
      useOtherJobs.subscribe((st, prev) => {
        if (placing || st.jobs === prev.jobs || !st.markerBuild) return
        const d: Draft = {
          jobs: st.jobs,
          history: useOtherHistory.getState().history,
          lastLogEventAt: st.lastLogEventAt,
          lastLogEventCount: st.lastLogEventCount,
          sessionAt: st.sessionAt,
          expandedId: st.expandedId,
          markerZones: st.markerZones,
          markerBuild: st.markerBuild,
          where: st.where
        }
        placeSteps(d, { live: false, settings: settingsNow(), accepted: [] })
        if (d.jobs.every((j, i) => j === st.jobs[i])) return
        placing = true
        try {
          set({ jobs: d.jobs })
        } finally {
          placing = false
        }
        get().persist()
      })
      // job rule 1: contracts accepted while in Haul mode stay ignored after switching to Other
      useStore.subscribe((st, prev) => {
        if (!st.ready || !prev.ready || !get().ready) return
        if (resolveWorkMode(st.settings.workMode) !== 'other' || resolveWorkMode(prev.settings.workMode) === 'other') return
        const at = new Date().toISOString()
        decide('watermark moved: haul -> other', undefined, { from: get().lastLogEventAt, to: at })
        dlog.info('other', 'work mode haul -> other: watermark moved to now', { from: get().lastLogEventAt, to: at })
        set({ lastLogEventAt: at, lastLogEventCount: 0 })
        saveNow()
      })
    }
    if (!window.supercargo.loadOtherJobs) {
      dlog.warn('other', 'init: no loadOtherJobs bridge')
      set({ ready: true, jobs: [] })
      return
    }
    const doc = await window.supercargo.loadOtherJobs()
    dlog.info('other', 'init loaded', {
      passive,
      jobs: doc.jobs?.length ?? 0,
      active: (doc.jobs ?? []).filter((j) => j.status === 'active').length,
      history: doc.history?.length ?? 0,
      listOrder: doc.listOrder,
      jobOrder: doc.jobOrder?.length,
      lastLogEventAt: doc.lastLogEventAt,
      rev: doc.rev
    })
    loadDoc(doc)
    // current session until a session event says otherwise: newest one on record
    const sessions = [...(doc.jobs ?? []), ...(doc.history ?? [])].map((j) => j.sessionAt ?? '').sort()
    set({ sessionAt: sessions[sessions.length - 1] || undefined })
    if (passive) {
      set({ ready: true })
      return
    }

    bootSettings = await window.supercargo.getSettings()

    // live events that arrive during the scan wait here, then skip any the scan already had
    let buffer: OtherLogEvent[] | null = []
    if (!listenersBound) {
      listenersBound = true
      dlog.info('other', 'binding log events')
      window.supercargo.onOtherLogEvent?.((e) => {
        if (buffer) buffer.push(e)
        else get().applyEvent(e)
      })
    }

    // rule 7: replay only events newer than the watermark, in one batch
    let scanned: OtherLogEvent[] = []
    if (window.supercargo.scanOtherEvents) {
      try {
        const res = await window.supercargo.scanOtherEvents(doc.lastLogEventAt)
        scanned = skipApplied(res.events ?? [], doc.lastLogEventAt, doc.lastLogEventCount ?? 0)
        // the session/build line sits above the watermark when the app starts mid-session
        if (res.currentSession) {
          const d0 = get()
          if (d0.sessionAt !== res.currentSession.at || (res.currentSession.build && d0.markerBuild !== res.currentSession.build)) {
            set({ sessionAt: res.currentSession.at, ...(res.currentSession.build ? { markerBuild: res.currentSession.build } : {}) })
          }
        }
        dlog.info('other', 'startup scan result', {
          since: doc.lastLogEventAt,
          events: scanned.length,
          files: res.files,
          previousEnd: res.previousEnd,
          jobsBefore: get().jobs.length
        })
        get().applyEvents(scanned, false)
        // rule 6: a crash keeps jobs; say so once
        const kept = get().jobs.filter((j) => j.status === 'active' && j.source === 'log').length
        if (res.previousEnd === 'crash' && kept > 0 && otherSetting(settingsNow(), 'otherCrashNotice')) {
          decide('crash: jobs kept', undefined, { kept })
          dlog.info('other', 'crash notice', { kept })
          set({ crashNotice: { kept } })
        }
      } catch (err) {
        dlog.warn('other', 'startup scan failed', { error: (err as Error)?.message ?? String(err) })
      }
    } else dlog.warn('other', 'startup scan skipped: no scanOtherEvents bridge')

    const seen = new Set(scanned.map((e) => JSON.stringify(e)))
    const late = (buffer ?? []).filter((e) => !seen.has(JSON.stringify(e)))
    buffer = null
    if (late.length) get().applyEvents(late, true)
    set({ ready: true })
  }

  return {
    ready: false,
    passive: false,
    jobs: [],
    expandedId: null,
    startLocation: '',
    groupBy: 'location',
    listOrder: 'distance',
    jobOrder: [],
    lastLogEventAt: undefined,
    lastLogEventCount: 0,
    rev: 0,
    sessionAt: undefined,
    markerZones: {},
    markerBuild: undefined,
    where: null,
    startTypedAt: undefined,
    trackedMissionId: undefined,
    trackedAt: undefined,
    crashNotice: null,
    dismissCrashNotice: () => set({ crashNotice: null }),

    // once per window: React StrictMode runs mount effects twice in dev; a second call
    // (any opts) gets the first call's promise, so there is one load and one start-up scan
    init: (opts) => (initOnce = initOnce ?? runInit(opts)),

    persist: () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(saveNow, 150)
    },

    reloadFromDisk: async () => {
      const doc = await window.supercargo.loadOtherJobs?.()
      if (!doc) return
      // loads can finish out of order; never step back to an older save
      if ((doc.rev ?? 0) < get().rev) return
      dlog.debug('other', 'reload from disk', { rev: doc.rev, jobs: doc.jobs?.length ?? 0 })
      loadDoc(doc)
    },

    applyEvent: (e) => {
      if (get().passive) return
      commit([e], true)
    },
    applyEvents: (events, live = false) => {
      if (get().passive) return
      commit(events, live)
    },

    setExpanded: (id) => set({ expandedId: id }),
    setStartLocation: (v) => {
      const typedAt = v.trim() ? new Date().toISOString() : get().startTypedAt
      decide('user start location', undefined, { from: get().startLocation, to: v, typedAt })
      set({ startLocation: v, startTypedAt: typedAt })
      get().persist()
    },
    setGroupBy: (v) => set({ groupBy: v }),
    setListOrder: (v) => {
      decide('user list order', undefined, { from: get().listOrder, to: v })
      set({ listOrder: v, groupBy: v === 'manual' ? 'job' : get().groupBy })
      get().persist()
    },
    moveJob: (id, dir) => {
      const order = activeJobOrder(get())
      const i = order.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= order.length) return
      const next = [...order]
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      decide('user job order', undefined, { id, order: next.length })
      set({ jobOrder: next, listOrder: 'manual', groupBy: 'job' })
      get().persist()
    },
    placeJob: (id, beforeId) => {
      if (id === beforeId) return
      const order = activeJobOrder(get())
      const from = order.indexOf(id)
      const to = order.indexOf(beforeId)
      if (from < 0 || to < 0) return
      const next = order.filter((x) => x !== id)
      const insertAt = next.indexOf(beforeId)
      if (insertAt < 0) return
      next.splice(insertAt, 0, id)
      decide('user job order', undefined, { id, order: next.length })
      set({ jobOrder: next, listOrder: 'manual', groupBy: 'job' })
      get().persist()
    },

    addJob: (draft) => {
      const jobs = get().jobs
      const job: OtherJob = {
        id: nid('job'),
        ref: nextJobRef(jobs, useOtherHistory.getState().history),
        title: draft.title.trim() || `${draft.kind} job`,
        kind: draft.kind,
        reward: Math.max(0, Number(draft.reward) || 0),
        status: 'active',
        steps: stepsFor(draft),
        createdAt: Date.now(),
        source: 'manual',
        sessionAt: get().sessionAt
      }
      decide(`created ${job.ref} (manual)`, undefined, { ref: job.ref, kind: job.kind, title: job.title, steps: job.steps.length })
      dlog.info('other', 'job created', { ref: job.ref, source: 'manual', kind: job.kind, title: job.title, steps: job.steps.length })
      set({ jobs: [...jobs, job], expandedId: job.id })
      get().persist()
    },

    applyEdit: (id, edit) => {
      {
        const j = get().jobs.find((x) => x.id === id)
        decide('user edit: steps replaced, objectives locked', j?.missionId, { ref: j?.ref, found: !!j, steps: edit.steps.length, kind: edit.kind, reward: edit.reward })
        dlog.info('other', 'job edited by user', {
          ref: j?.ref,
          id: short(j?.missionId),
          steps: edit.steps.length,
          found: !!j,
          willComplete: !!j && j.status === 'active' && edit.steps.length > 0 && edit.steps.every((r) => j.steps.find((s) => s.id === r.id)?.done)
        })
      }
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
              done: prev?.done ?? false,
              withdrawn: prev?.withdrawn,
              logText: prev?.logText,
              objectiveId: prev?.objectiveId,
              // a marker position belongs to the place it was set for
              position: prev && prev.location === location ? prev.position : undefined
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

    abandonJob: (id) => {
      if (get().passive) return sendAction({ type: 'abandon', jobId: id })
      {
        const j = get().jobs.find((x) => x.id === id)
        decide('user abandon', j?.missionId, { ref: j?.ref, from: j?.status })
        dlog.info('other', 'job status change', { ref: j?.ref, id: short(j?.missionId), from: j?.status, to: 'abandoned', reason: 'user abandon' })
      }
      set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, status: 'abandoned' as const, objectivesLocked: true } : j)) })
      get().persist()
    },
    // #8: abandoned -> active (log may fill steps again); complete -> active with steps un-done
    restoreJob: (id) => {
      {
        const j = get().jobs.find((x) => x.id === id)
        decide('user restore', j?.missionId, { ref: j?.ref, from: j?.status })
        dlog.info('other', 'job status change', { ref: j?.ref, id: short(j?.missionId), from: j?.status, to: 'active', reason: 'user restore' })
      }
      set({
        jobs: get().jobs.map((j) => {
          if (j.id !== id || j.status === 'active') return j
          if (j.status === 'complete') return { ...j, status: 'active' as const, endedAt: undefined, steps: undone(j.steps) }
          return { ...j, status: 'active' as const, endedAt: undefined, objectivesLocked: undefined }
        })
      })
      get().persist()
    },

    completeJob: (id) => {
      if (get().passive) return sendAction({ type: 'complete', jobId: id })
      {
        const j = get().jobs.find((x) => x.id === id)
        decide('user complete', j?.missionId, { ref: j?.ref, from: j?.status })
        dlog.info('other', 'job status change', { ref: j?.ref, id: short(j?.missionId), from: j?.status, to: 'complete', reason: 'user complete' })
      }
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
      if (get().passive) return sendAction({ type: 'toggleStep', jobId, stepId })
      // B1: ticking DONE / GO HERE / TURN IN (not UNDO) puts you at the step's place before the tick
      // (overlay presses arrive here too, via onOtherAction)
      const before = get().jobs.find((j) => j.id === jobId)?.steps.find((s) => s.id === stepId)
      if (before && !before.done) {
        const place = stepActivePlace(before).trim()
        if (place) {
          const w = takeWhere(get().where, whereFromPlace(place, 'tick', new Date().toISOString()), { step: stepKey(before) })
          if (w !== get().where) set({ where: w })
        }
      }
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
          const allDone = steps.length > 0 && steps.every((s) => s.done || s.withdrawn)
          const s0 = j.steps.find((s) => s.id === stepId)
          const s1 = steps.find((s) => s.id === stepId)
          decide(allDone && j.status === 'active' ? 'user toggle: job complete' : 'user toggle', j.missionId, {
            ref: j.ref,
            step: s1 ? stepKey(s1) : stepId,
            pickedUp: s1?.pickedUp,
            done: s1?.done
          })
          dlog.info('other', 'step toggled by user', {
            ref: j.ref,
            stepKey: s1 ? stepKey(s1) : stepId,
            pickedUp: s1?.pickedUp,
            done: s1?.done,
            wasDone: s0?.done
          })
          // #8: a finished job stays finished; only an active one can complete here
          if (j.status !== 'active') return { ...j, steps }
          if (allDone) {
            dlog.info('other', 'job status change', { ref: j.ref, id: short(j.missionId), from: j.status, to: 'complete', reason: 'step toggle' })
            return { ...j, steps, status: 'complete' as const }
          }
          return { ...j, steps }
        })
      })
      get().persist()
    },

    applyWhere: (w, r) => {
      if (get().passive) return
      const live = r?.why === 'live'
      let changed = false
      if (w) {
        const cur = get().where
        const next = takeWhere(cur, w, { label: w.label, why: r?.why }, live)
        if (next !== cur) {
          set({ where: next })
          changed = true
        }
      }
      // O2: the panel's tracked mission names an active job -> mark it (no match = ignore)
      const tracked = r?.info?.trackedMission
      if (tracked?.id) {
        const job = matchTrackedMission(get().jobs, tracked.id)
        if (job?.missionId && job.missionId !== get().trackedMissionId) {
          decide('tracked mission', job.missionId, { ref: job.ref, from: short(get().trackedMissionId), read: tracked.id, name: tracked.name })
          set({ trackedMissionId: job.missionId, trackedAt: new Date().toISOString() })
          changed = true
        } else if (!job && !live) dlog.debug('other', 'tracked mission: no active job matches', { read: tracked.id, name: tracked.name })
      }
      if (changed) get().persist()
    }
  }
})
