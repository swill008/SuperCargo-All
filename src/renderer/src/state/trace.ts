// window-side diagnostics trace: batches records to main. API is the contract; internals owned by trace-core.

import type { TraceRecord } from '@shared/trace'

const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''
const SRC: TraceRecord['src'] = hash === 'compact' ? 'overlay' : hash === 'debug' ? 'debug' : 'main'

let queue: TraceRecord[] = []
// settings.traceInterpretation; undefined counts as on. Kept here (not read from the store) to avoid an
// import cycle and because the #debug window has no store.
let enabled = true

export function setTraceEnabled(on: boolean | undefined): void {
  enabled = on !== false
  if (!enabled) queue = []
}
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!queue.length) return
  const batch = queue
  queue = []
  try {
    window.supercargo?.traceRecords?.(batch)
  } catch {
    // ipc gone
  }
}

export function trace(rec: Omit<TraceRecord, 't' | 'src'>): void {
  if (!enabled) return
  queue.push({ t: Date.now(), src: SRC, ...rec })
  if (!timer) timer = setTimeout(flush, 500)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush)
  // other windows' setting changes arrive as broadcasts; the main window also calls setTraceEnabled
  try {
    window.supercargo
      ?.getSettings?.()
      .then((s) => setTraceEnabled(s?.traceInterpretation))
      .catch(() => undefined)
    window.supercargo?.onSettings?.((s) => setTraceEnabled(s?.traceInterpretation))
  } catch {
    // preload missing (tests)
  }
}
