/** Match memory in the renderer (M1-M8): loaded from main on start, kept current by evt:other:memory. */
import { useSyncExternalStore } from 'react'
import { emptyMemoryDoc, type MemoryDoc, type MemoryEntry, type recordSeen } from '@other/otherMemory'
import { listOpenStops, resolveOrigin, type MemoryLookup } from '@other/otherNext'
import { otherSetting } from '@other/workMode'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { mergeLocations, otherPlacesVersion } from './otherPlaces'
import { useOtherJobs } from './otherJobs'

type SeenInput = Parameters<typeof recordSeen>[1]

let doc: MemoryDoc = emptyMemoryDoc()
let byKey = new Map<string, MemoryEntry>()
let lookup: MemoryLookup = (key) => byKey.get(key)
let started = false
const listeners = new Set<() => void>()

function set(next: MemoryDoc | null | undefined): void {
  if (!next || typeof next !== 'object' || !Array.isArray(next.entries)) return
  doc = { entries: next.entries, changes: Array.isArray(next.changes) ? next.changes : [] }
  const map = new Map<string, MemoryEntry>()
  for (const e of doc.entries) if (e && typeof e.key === 'string') map.set(e.key, e)
  byKey = map
  // new identity per doc: memoised stop lists re-resolve
  lookup = (key) => map.get(key)
  for (const l of listeners) l()
}

/** load once and subscribe; safe to call more than once (also runs on first use) */
export function startOtherMemory(): void {
  if (started || typeof window === 'undefined' || !window.supercargo?.otherMemoryGet) return
  started = true
  window.supercargo.onOtherMemory?.((d) => set(d))
  window.supercargo
    .otherMemoryGet()
    .then((d) => {
      set(d)
      dlog.debug('other', 'match memory loaded from main', { entries: d?.entries?.length ?? 0, changes: d?.changes?.length ?? 0 })
    })
    .catch((e: unknown) => dlog.warn('other', 'match memory load failed', { error: (e as Error)?.message ?? String(e) }))
}

function subscribe(cb: () => void): () => void {
  startOtherMemory()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function memoryDoc(): MemoryDoc {
  startOtherMemory()
  return doc
}

/** entry for a memoryKey (non-React code) */
export function memoryLookup(key: string): MemoryEntry | undefined {
  startOtherMemory()
  return byKey.get(key)
}

/** current lookup function; its identity changes when the doc changes */
export function currentMemoryLookup(): MemoryLookup {
  startOtherMemory()
  return lookup
}

export function useMemory(): MemoryDoc {
  return useSyncExternalStore(subscribe, () => doc)
}

/** stable lookup for listOpenStops / resolveStopPlace ctx; a new function after each doc change */
export function useMemoryLookup(): MemoryLookup {
  return useSyncExternalStore(subscribe, () => lookup)
}

/** counts for diagnostics (SNAPSHOT) */
export function memoryCounts(): { entries: number; user: number; learned: number; disputed: number; changes: number } {
  const d = memoryDoc()
  let user = 0
  let learned = 0
  let disputed = 0
  for (const e of d.entries) {
    if (e.origin === 'user') user++
    else if (e.confirmed >= 2 && e.confirmed > e.wrong) learned++
    if (e.disputed) disputed++
  }
  return { entries: d.entries.length, user, learned, disputed, changes: d.changes.length }
}

// ---- M1: "seen" reporter (main window only) ----

const SEEN_DEBOUNCE_MS = 5_000
/** key|status|place already sent this run (main bumps seen/lastAt; once per app run is enough) */
const seenSent = new Set<string>()
let reporterStarted = false
let seenTimer: ReturnType<typeof setTimeout> | null = null

/** every open stop that isn't an exact name match, as recordSeen inputs (deduped by key|status|place) */
export function collectSeen(): SeenInput[] {
  const s = useOtherJobs.getState()
  const settings = useStore.getState().settings
  const locations = mergeLocations(useStore.getState().locations)
  const startMode = otherSetting(settings, 'otherStartMode')
  const origin = resolveOrigin({ typed: s.startLocation, typedAt: s.startTypedAt, where: s.where, mode: startMode, locations, memory: memoryLookup })
  const live = s.jobs.map((j) => (j.steps.some((x) => x.withdrawn) ? { ...j, steps: j.steps.filter((x) => !x.withdrawn) } : j))
  // every open step (manual order: no sorting needed)
  const rows = listOpenStops(live, origin.name ?? '', locations, {
    showAll: true,
    hideCompleted: true,
    listOrder: 'manual',
    jobOrder: s.jobOrder,
    markerDistance: otherSetting(settings, 'otherMarkerDistance'),
    withdrawnSteps: 'hide',
    origin: origin.point,
    originIsRead: origin.kind != null && origin.kind !== 'typed',
    memory: currentMemoryLookup()
  })
  const out: SeenInput[] = []
  const thisPass = new Set<string>()
  for (const r of rows) {
    const m = r.match
    if (m.status === 'exact' || !m.text.trim() || !m.memoryKey) continue
    const place = m.match?.name ?? m.site?.name ?? null
    const tuple = `${m.memoryKey}|${m.status}|${place ?? ''}`
    if (thisPass.has(tuple) || seenSent.has(tuple)) continue
    thisPass.add(tuple)
    // generic site key carries its parent place: memoryKey(text, site parent)
    const context = m.memoryKey.includes('@') ? m.site?.name : undefined
    out.push({
      key: m.memoryKey,
      text: m.text,
      ...(context ? { context } : {}),
      place,
      status: m.status,
      confidence: m.confidence,
      evidence: m.evidence.map((e) => e.text).slice(0, 8)
    })
  }
  return out
}

function runSeen(): void {
  seenTimer = null
  try {
    if (!useOtherJobs.getState().ready) return
    const list = collectSeen()
    if (list.length === 0) return
    for (const x of list) seenSent.add(`${x.key}|${x.status}|${x.place ?? ''}`)
    window.supercargo?.otherMemorySeen?.(list)
    dlog.debug('other', 'match memory: seen sent', { stops: list.length, keys: list.map((x) => x.key) })
  } catch (e) {
    dlog.warn('other', 'match memory: seen failed', { error: (e as Error)?.message ?? String(e) })
  }
}

function scheduleSeen(): void {
  if (seenTimer) clearTimeout(seenTimer)
  seenTimer = setTimeout(runSeen, SEEN_DEBOUNCE_MS)
}

/** main window only (otherJobs init, not passive): reports non-exact open stops 5 s after jobs/where/roster/memory change */
export function startMemorySeenReporter(): void {
  if (reporterStarted || typeof window === 'undefined' || !window.supercargo?.otherMemorySeen) return
  reporterStarted = true
  startOtherMemory()
  useOtherJobs.subscribe((st, prev) => {
    if (st.jobs !== prev.jobs || st.where !== prev.where || st.startLocation !== prev.startLocation || st.ready !== prev.ready) scheduleSeen()
  })
  let placesVersion = otherPlacesVersion()
  useStore.subscribe((st, prev) => {
    const v = otherPlacesVersion()
    if (st.locations !== prev.locations || v !== placesVersion) {
      placesVersion = v
      scheduleSeen()
    }
  })
  listeners.add(scheduleSeen)
  scheduleSeen()
}

startOtherMemory()
