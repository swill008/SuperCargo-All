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
import { calibrateZone, resolveMarker, type BodyRadiusLookup, type CalibrateResult, type MarkerPos } from '@other/otherMarkers'
import { stepActivePlace } from '@other/otherNext'
import { isSurePlace, nearestPlace, placeKey, resolvePlaceText, resolveStartText, resolveStopPlace } from '@other/otherResolve'
import { PROOF_METERS, PROOF_WINDOW_MS, type MemoryWhere } from '@other/otherMemory'
import { memoryLookup, startMemorySeenReporter } from './otherMemoryStore'
import { setBodyRadiusLookup } from '@other/otherGeo'
import { bodyRadiusFromTable } from '@other/otherBodies'
import { bodiesTable } from './otherBodiesStore'
// site-code table for the resolver, in every window that resolves stops (main and overlay)
import './otherGameDataStore'
import { ACCURACY, type Where, type WhereRunResult, type WhereSource } from '@other/otherWhere'
import { loadOtherPlacesFromMain, mergeLocations } from './otherPlaces'
import type { OtherLogEvent } from '@other/otherEvents'
import type { OtherAction } from '@other/otherActions'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { trace } from '@renderer/state/trace'
import { otherSetting, resolveWorkMode } from '@other/workMode'
import { useOtherHistory } from './otherHistory'
import { requestAutoOcrIfEnabled } from './otherCapture'
import { findStepByText, kindFromGenerator, stepFromObjectiveText, stepKey } from '@other/otherLog'
import type { AppSettings, Location } from '@shared/types'

export interface OtherJobDraft {
  title: string
  kind: OtherJobKind
  reward: number
  location: string
  item: string
  need: number
}

/** REFRESH result (batch 5): counts and the line shown on the screen */
export interface RefreshResult {
  /** active jobs refreshed */
  jobs: number
  /** marker lines read back from the logs */
  markers: number
  /** steps that gained a position */
  placed: number
  /** zone outcome, e.g. "2 zones (new 1, body 1)" */
  zones: string
  message: string
}

/** lastRefresh: the result plus when and how it ran (diagnostics, UI) */
export interface RefreshRecord extends RefreshResult {
  at: string
  silent: boolean
  ms: number
  files?: string[]
  error?: string
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
  /** app version+commit the automatic REFRESH last ran for (doc field) */
  refreshedForVersion?: string
  /** a REFRESH is running (UI disables the button) */
  refreshing: boolean
  /** newest REFRESH result this run */
  lastRefresh: RefreshRecord | null
  /** REFRESH: reload places, re-read active jobs' markers from the logs (ignoring the watermark), re-place steps.
   *  Main window only; never moves the watermark, changes status/done flags, or creates/ends jobs. */
  refreshJobs: (opts?: { silent?: boolean }) => Promise<RefreshResult>
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
    repMax: h.repMax,
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
 * Every step with its own objective's marker gets the position (the stop-place resolver weighs it as
 * evidence, even when the text names a UEX place); the by-order link still skips steps whose place
 * has UEX coords, so the pairing of unclaimed markers stays as it was. A step whose marker can't be
 * placed keeps none (or the last one it had). jobId limits the pass to one job.
 */
/** planet table radius (otherBodiesStore), for body-frame markers and surface arcs */
const tableRadius: BodyRadiusLookup = (body) => bodyRadiusFromTable(bodiesTable(), body)
// every travel() (otherNext distances, overlay, diagnostics) measures surface arcs with the table radius
setBodyRadiusLookup(tableRadius)

/** "<name>\n<near>" already sent to main this run (main bumps seen/lastSeen; once per session is enough) */
const learnedSent = new Set<string>()

/**
 * A generic step place placed by a marker near a known place: tell main so the planet table's
 * learned list (diagnostics + label hint) keeps it. Only when the resolver's answer is the marker
 * (no roster place won); a stop that names a known place isn't "learned". Once per (name, near) per run.
 */
function reportLearned(step: OtherStep, pos: { x: number; y: number; z: number }, locations: Location[], ref: string): void {
  const name = step.location?.trim()
  if (!name) return
  // the step's own place with this marker (not the pickup of a combined step)
  const match = resolvePlaceText(name, { locations, useMarker: true }, pos)
  if (match.status !== 'marker') return
  const hit = nearestPlace(pos, locations)
  if (!hit) return
  const near = { name: hit.place.name, meters: hit.meters }
  const key = `${name.toLowerCase()}\n${near.name.toLowerCase()}`
  if (learnedSent.has(key)) return
  learnedSent.add(key)
  const body = hit.place.body ?? undefined
  const system = hit.place.system ?? undefined
  window.supercargo?.otherLearnedPlace?.({
    name,
    near: near.name,
    nearMeters: Math.round(near.meters),
    ...(body ? { body } : {}),
    ...(system ? { system } : {}),
    point: { x: pos.x, y: pos.y, z: pos.z }
  })
  dlog.info('other', 'learned place reported', { ref, name, near: near.name, meters: Math.round(near.meters), body })
}

/** Objective Complete lines already used as proof this run (a rescan replays them) */
const proofSent = new Set<string>()
/** where sources that show where you were (M2) */
const PROOF_SOURCES: ReadonlySet<WhereSource> = new Set<WhereSource>(['displayinfo', 'map', 'inventory'])
const PROOF_MIN_ACCURACY = 7

/**
 * M2 proof from the game: the step was just completed, so the latest position read (when it is a real read,
 * accuracy >= 7, within PROOF_WINDOW_MS of the event) shows where its place was. The resolver's chosen place
 * within PROOF_METERS of that point (or a name-only read naming it) -> confirmed; else wrong, with where you were.
 * Main window only (the reducer never runs in the overlay). No read near the event time -> no proof.
 */
function proveStep(prev: Where | null, step: OtherStep, job: OtherJob, at: string, settings: AppSettings): void {
  const mid = job.missionId
  if (!prev || !PROOF_SOURCES.has(prev.source) || (prev.accuracy ?? 0) < PROOF_MIN_ACCURACY) {
    decide('proof: no read', mid, { ref: job.ref, step: stepKey(step), where: prev ? { source: prev.source, accuracy: prev.accuracy, at: prev.at } : null })
    return
  }
  const gap = Math.abs(whenMs(at) - whenMs(prev.at))
  if (!Number.isFinite(gap) || gap > PROOF_WINDOW_MS) {
    decide('proof: read too far from event', mid, { ref: job.ref, step: stepKey(step), gapMs: Number.isFinite(gap) ? gap : null, readAt: prev.at, at })
    return
  }
  const locations = mergeLocations(useStore.getState().locations)
  const m = resolveStopPlace(step, { locations, useMarker: otherSetting(settings, 'otherMarkerDistance'), memory: memoryLookup }, job)
  if (m.status === 'exact' || !m.memoryKey || !m.text.trim()) {
    decide('proof: skipped', mid, { ref: job.ref, step: stepKey(step), status: m.status, text: m.text })
    return
  }
  const place = m.match?.name ?? m.site?.name ?? null
  const hit = prev.point ? nearestPlace(prev.point, locations) : undefined
  const near = hit ? { name: hit.place.name, meters: hit.meters } : undefined
  const actual: MemoryWhere = prev.point
    ? { name: near?.name ?? prev.name ?? null, meters: near ? Math.round(near.meters) : null, at: prev.at }
    : { name: prev.name, meters: null, at: prev.at }
  let ok: boolean
  let meters: number | null = null
  if (prev.point && m.point) {
    meters = Math.round(Math.hypot(prev.point.x - m.point.x, prev.point.y - m.point.y, prev.point.z - m.point.z))
    ok = meters <= PROOF_METERS
  } else if (prev.name && place) {
    // the read's name names the chosen place: same spelling key, or the resolver (no memory: memory is what is being proven) is sure of it
    const read = resolveStartText(prev.name, { locations, useMarker: false })
    ok = placeKey(prev.name) === placeKey(place) || (isSurePlace(read) && read.match?.name === place)
  } else {
    decide('proof: nothing to compare', mid, { ref: job.ref, step: stepKey(step), place, readPoint: !!prev.point, placePoint: !!m.point })
    return
  }
  const once = `${job.id}\n${stepKey(step)}\n${at}`
  if (proofSent.has(once)) return
  proofSent.add(once)
  const context = m.memoryKey.includes('@') ? m.site?.name : undefined
  window.supercargo?.otherMemoryProof?.({ key: m.memoryKey, text: m.text, ...(context ? { context } : {}), place, ok, actual })
  const data = { ref: job.ref, step: stepKey(step), key: m.memoryKey, text: m.text, place, status: m.status, ok, meters, read: { source: prev.source, accuracy: prev.accuracy, at: prev.at, name: prev.name }, actual }
  decide(ok ? 'proof: confirmed' : 'proof: wrong', mid, data)
  dlog.info('other', ok ? 'match proof: confirmed' : 'match proof: wrong', data)
}

function placeSteps(d: Draft, ctx: Ctx, jobId?: string): void {
  if (!otherSetting(ctx.settings, 'otherMarkerDistance') || !d.markerBuild) return
  const zones = d.markerZones[d.markerBuild] ?? {}
  // merged roster (haul + other places), the same list calibrateZone uses
  const locations = mergeLocations(useStore.getState().locations)
  // a step the resolver is sure names a roster place with coords doesn't need a marker (text as read, with match memory)
  const hasUex = (s: OtherStep): boolean => {
    const m = resolveStartText(s.locationRaw ?? s.location ?? '', { locations, useMarker: false, memory: memoryLookup })
    const named = m.match
    return isSurePlace(m) && !!named && named.x != null && named.y != null && named.z != null
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
      reportLearned(s, pos, locations, j.ref)
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
  // the one resolver (with match memory); a place it isn't sure of gives no point
  const m = resolveStartText(name, { locations: mergeLocations(useStore.getState().locations), useMarker: false, memory: memoryLookup })
  const loc = isSurePlace(m) ? m.match : undefined
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

/**
 * Zone ids change per server, so a new session or a disconnect/quit drops the current build's
 * zone table; later markers calibrate fresh. Step positions already placed (system frame) stay.
 */
function resetZones(d: Draft, why: 'session' | 'disconnect' | 'quit' | 'refresh'): void {
  const build = d.markerBuild
  if (!build) return
  const n = Object.keys(d.markerZones[build] ?? {}).length
  if (!n) return
  const rest = { ...d.markerZones }
  delete rest[build]
  d.markerZones = rest
  decide(`marker zones reset: ${why}`, undefined, { build, zones: n })
  dlog.debug('other', 'marker zones reset', { why, build, zones: n })
}

/**
 * One marker line: remember it for its mission/objective, calibrate the build's zone table
 * (incl. the body-frame path) and place steps. Shared by the reducer and REFRESH; never touches
 * the watermark. Returns the calibration result (null when there is no build yet).
 */
function applyMarker(d: Draft, e: Extract<OtherLogEvent, { kind: 'marker' }>, ctx: Ctx): CalibrateResult | null {
  const mid = e.missionId
  const m: MarkerPos = { zoneHostId: e.zoneHostId, x: e.x, y: e.y, z: e.z }
  const marks = missionMarkers.get(e.missionId) ?? new Map<string, MarkerPos>()
  marks.set(e.objectiveId, m)
  missionMarkers.set(e.missionId, marks)
  if (!d.markerBuild) {
    decide('marker: no build, not calibrated', mid, { objectiveId: e.objectiveId, zone: e.zoneHostId })
    dlog.debug('other', 'marker: no game build yet, not calibrated', { id: short(e.missionId) })
    return null
  }
  const table = d.markerZones[d.markerBuild] ?? {}
  const r = calibrateZone(table, m, mergeLocations(useStore.getState().locations), tableRadius)
  decide(r.zones !== table ? 'marker calibrated' : 'marker stored', mid, {
    objectiveId: e.objectiveId,
    zone: e.zoneHostId,
    build: d.markerBuild,
    change: r.change,
    place: r.place,
    n: r.zones[e.zoneHostId]?.n,
    ...(r.bodyWhy ? { body: r.body, bodyWhy: r.bodyWhy, meters: r.meters } : {})
  })
  if (r.zones !== table) {
    d.markerZones = { ...d.markerZones, [d.markerBuild]: r.zones }
    dlog.debug('other', 'marker zone calibration', { build: d.markerBuild, zone: e.zoneHostId, change: r.change, place: r.place, body: r.body, meters: r.meters, n: r.zones[e.zoneHostId]?.n })
  }
  // a newly learned zone can place earlier markers too
  const job = d.jobs.find((j) => j.missionId === e.missionId)
  if (r.change === 'new' || r.change === 'root' || r.change === 'body') placeSteps(d, ctx)
  else if (job) placeSteps(d, ctx, job.id)
  return r
}

function reduce(d: Draft, e: OtherLogEvent, ctx: Ctx): void {
  const mode = resolveWorkMode(ctx.settings.workMode)
  const mid = 'missionId' in e ? e.missionId : undefined
  switch (e.kind) {
    case 'session':
      d.sessionAt = e.at
      if (e.build) d.markerBuild = e.build
      decide('session', undefined, { at: e.at, build: e.build, live: ctx.live })
      resetZones(d, 'session')
      dlog.info('other', 'log session', { at: e.at, build: e.build })
      break

    case 'marker':
      applyMarker(d, e, ctx)
      break

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
          repMax: e.rep != null ? e.repMax : base.repMax,
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
        repMax: e.repMax,
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
      const step: OtherStep = { ...stepFromObjectiveText(e.text, mergeLocations(useStore.getState().locations), { memory: memoryLookup }), logText: e.text }
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
      // M2: the read before this event's own clue shows where the step's place was
      proveStep(d.where, s, hit.job, e.at, ctx.settings)
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
      resetZones(d, e.kind)
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
    refreshedForVersion: s.refreshedForVersion,
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

/** REFRESH preload calls (refresh-main adds them; absent = older build) */
type RefreshBridge = {
  refreshOtherPlaces?: () => Promise<unknown>
  refreshScanOther?: (missionIds: string[]) => Promise<{ events: OtherLogEvent[]; files: string[]; ms: number }>
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
      refreshedForVersion: typeof doc.refreshedForVersion === 'string' ? doc.refreshedForVersion : undefined,
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
      // M1: only the main window reports non-exact stops to the match memory
      startMemorySeenReporter()
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
    // batch 5: first start after an update re-reads active jobs' markers once (silent)
    await autoRefreshOnUpdate()
  }

  const autoRefreshOnUpdate = async (): Promise<void> => {
    let version: string
    try {
      const info = await window.supercargo.debugInfo?.()
      if (!info) return
      version = `${info.version}+${info.commit}`
    } catch (err) {
      dlog.warn('other', 'auto refresh: no version', { error: (err as Error)?.message ?? String(err) })
      return
    }
    const was = get().refreshedForVersion
    if (was === version) return
    decide('auto refresh: new version', undefined, { from: was ?? null, to: version })
    dlog.info('other', 'auto refresh after update', { from: was ?? null, to: version })
    try {
      await get().refreshJobs({ silent: true })
    } catch (err) {
      dlog.warn('other', 'auto refresh failed', { error: (err as Error)?.message ?? String(err) })
    }
    // once per version, whatever the result
    set({ refreshedForVersion: version })
    get().persist()
  }

  let refreshRun: Promise<RefreshResult> | null = null
  const runRefresh = async (silent: boolean): Promise<RefreshResult> => {
    const t0 = Date.now()
    const bridge = window.supercargo as unknown as RefreshBridge
    set({ refreshing: true })
    const done = (r: RefreshResult, extra?: { files?: string[]; error?: string }): RefreshResult => {
      const rec: RefreshRecord = { ...r, at: new Date().toISOString(), silent, ms: Date.now() - t0, ...extra }
      set({ refreshing: false, lastRefresh: rec })
      decide('refresh', undefined, { ...rec })
      dlog.info('other', 'refresh result', { ...rec })
      return r
    }
    try {
      // 1. places: main re-reads its roster, the window reloads it (place list version bumps)
      try {
        await bridge.refreshOtherPlaces?.()
      } catch (err) {
        dlog.warn('other', 'refresh: places refresh failed', { error: (err as Error)?.message ?? String(err) })
      }
      await loadOtherPlacesFromMain()

      // 2. active jobs' marker lines, ignoring the watermark
      const active = get().jobs.filter((j) => j.status === 'active' && !!j.missionId)
      const ids = [...new Set(active.map((j) => j.missionId as string))]
      let events: OtherLogEvent[] = []
      let files: string[] | undefined
      if (ids.length) {
        if (!bridge.refreshScanOther) {
          return done({ jobs: active.length, markers: 0, placed: 0, zones: '', message: 'Refresh failed: log re-scan not available' }, { error: 'no refreshScanOther bridge' })
        }
        const res = await bridge.refreshScanOther(ids)
        const want = new Set(ids)
        events = (res?.events ?? []).filter((e) => e.kind === 'session' || (e.kind === 'marker' && want.has(e.missionId)))
        files = res?.files
      }

      // 3. refresh-only apply: zones afresh, markers recalibrate, steps re-placed; no watermark, status or done changes
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
      const ctx: Ctx = { live: false, settings: settingsNow(), accepted: [] }
      const before = new Map<string, boolean>()
      for (const j of d.jobs) for (const st of j.steps) before.set(`${j.id}\n${st.id}`, !!st.position)
      resetZones(d, 'refresh')
      const changes: Record<string, number> = {}
      let markers = 0
      for (const e of events) {
        if (e.kind === 'session') {
          // build context only: a new server means new zone ids
          if (e.build) d.markerBuild = e.build
          resetZones(d, 'session')
          continue
        }
        if (e.kind !== 'marker') continue
        markers += 1
        const r = applyMarker(d, e, ctx)
        const c = r?.change ?? 'no build'
        changes[c] = (changes[c] ?? 0) + 1
      }
      placeSteps(d, ctx)

      const locations = mergeLocations(useStore.getState().locations)
      const found: string[] = []
      let placed = 0
      for (const j of d.jobs) {
        for (const st of j.steps) {
          if (!st.position || before.get(`${j.id}\n${st.id}`) !== false) continue
          // a step that names a known place got its marker as evidence only: not a place "found"
          if (resolvePlaceText(st.location ?? '', { locations, useMarker: true }, st.position).match) continue
          placed += 1
          const near = nearestPlace(st.position, locations)
          found.push(near ? `${st.location || st.label} near ${near.place.name}` : st.location || st.label)
        }
      }
      const zoneCount = Object.keys((d.markerBuild && d.markerZones[d.markerBuild]) || {}).length
      const tally = Object.entries(changes)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')
      const zones = `${zoneCount} zone${zoneCount === 1 ? '' : 's'}${tally ? ` (${tally})` : ''}`

      // only jobs (positions), zone table and build change; watermark, session and history stay
      set({ jobs: d.jobs, markerZones: d.markerZones, markerBuild: d.markerBuild })
      get().persist()

      const list = found.length > 2 ? `${found.slice(0, 2).join(', ')} +${found.length - 2} more` : found.join(', ')
      const message = placed
        ? `Refreshed · ${active.length} job${active.length === 1 ? '' : 's'} · ${placed} place${placed === 1 ? '' : 's'} found (${list})`
        : 'Refreshed · nothing new'
      return done({ jobs: active.length, markers, placed, zones, message }, { files })
    } catch (err) {
      const error = (err as Error)?.message ?? String(err)
      return done({ jobs: 0, markers: 0, placed: 0, zones: '', message: `Refresh failed: ${error}` }, { error })
    }
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
    refreshedForVersion: undefined,
    refreshing: false,
    lastRefresh: null,
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

    refreshJobs: (opts) => {
      // rule 8: the overlay never applies log events or writes the doc
      if (get().passive) {
        dlog.debug('other', 'refresh: not available in the overlay')
        return Promise.resolve({ jobs: 0, markers: 0, placed: 0, zones: '', message: 'Refresh is not available in the overlay' })
      }
      // one at a time: a second press while running gets the running one
      refreshRun =
        refreshRun ??
        runRefresh(!!opts?.silent).finally(() => {
          refreshRun = null
        })
      return refreshRun
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
