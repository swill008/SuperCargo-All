// main-process diagnostics trace: memory ring + userData/logs/trace.jsonl (rotated at 20 MB to trace.1.jsonl)
// plus a 30 s perf sampler. trace()/writeTrace() are the contract other modules call.

import { app, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TraceRecord } from '@shared/trace'

const RING_MAX = 5000
const FLUSH_MS = 1000
const ROTATE_BYTES = 20 * 1024 * 1024
const PERF_MS = 30_000

const ring: TraceRecord[] = []
let pending: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let fileBytes = -1
let quitHooked = false
let enabled: () => boolean = () => true

// index.ts hands us the setting; undefined counts as on
export function setTraceEnabled(fn: () => boolean): void {
  enabled = fn
}

export function isTraceOn(): boolean {
  try {
    return enabled()
  } catch {
    return true
  }
}

export function traceDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

// oldest first: [trace.1.jsonl, trace.jsonl]
export function traceFiles(): string[] {
  return [path.join(traceDir(), 'trace.1.jsonl'), path.join(traceDir(), 'trace.jsonl')]
}

export function getTraceRing(): TraceRecord[] {
  return ring.slice()
}

export function flushTrace(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!pending.length) return
  const text = pending.join('\n') + '\n'
  pending = []
  try {
    const [old, cur] = traceFiles()
    fs.mkdirSync(traceDir(), { recursive: true })
    if (fileBytes < 0) {
      try {
        fileBytes = fs.statSync(cur).size
      } catch {
        fileBytes = 0
      }
    }
    if (fileBytes > 0 && fileBytes + text.length > ROTATE_BYTES) {
      try {
        fs.rmSync(old, { force: true })
        fs.renameSync(cur, old)
      } catch {
        // ignore
      }
      fileBytes = 0
    }
    fs.appendFileSync(cur, text, 'utf8')
    fileBytes += Buffer.byteLength(text)
  } catch {
    // tracing never throws
  }
}

function hookQuit(): void {
  if (quitHooked) return
  quitHooked = true
  try {
    app.on('will-quit', flushTrace)
    process.on('exit', flushTrace)
  } catch {
    // ignore
  }
}

export function writeTrace(rec: TraceRecord): void {
  if (!isTraceOn()) return
  try {
    ring.push(rec)
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
    pending.push(JSON.stringify(rec))
    hookQuit()
    if (rec.area === 'error') flushTrace()
    else if (!flushTimer) flushTimer = setTimeout(flushTrace, FLUSH_MS)
  } catch {
    // ignore
  }
}

export function trace(rec: Omit<TraceRecord, 't' | 'src'>): void {
  writeTrace({ t: Date.now(), src: 'proc', ...rec })
}

// --- perf sampler ---

let perfTimer: ReturnType<typeof setInterval> | null = null
let lagMax = 0
let lagSum = 0
let lagN = 0

function probeLag(): void {
  const LAG_MS = 500
  const start = Date.now()
  setTimeout(() => {
    const lag = Math.max(0, Date.now() - start - LAG_MS)
    lagMax = Math.max(lagMax, lag)
    lagSum += lag
    lagN++
    if (perfTimer) probeLag()
  }, LAG_MS).unref?.()
}

function samplePerf(): void {
  if (!isTraceOn()) return
  try {
    const byType: Record<string, { n: number; cpu: number; memMB: number }> = {}
    let cpu = 0
    let memMB = 0
    for (const m of app.getAppMetrics()) {
      const t = (byType[m.type] ??= { n: 0, cpu: 0, memMB: 0 })
      const mb = (m.memory?.workingSetSize ?? 0) / 1024 // KB -> MB
      t.n++
      t.cpu = +(t.cpu + (m.cpu?.percentCPUUsage ?? 0)).toFixed(1)
      t.memMB = +(t.memMB + mb).toFixed(1)
      cpu += m.cpu?.percentCPUUsage ?? 0
      memMB += mb
    }
    const heapMB = +(process.memoryUsage().heapUsed / 1048576).toFixed(1)
    trace({
      area: 'perf',
      what: 'sample',
      data: {
        cpuPct: +cpu.toFixed(1),
        memMB: +memMB.toFixed(1),
        mainHeapMB: heapMB,
        lagAvgMs: lagN ? Math.round(lagSum / lagN) : 0,
        lagMaxMs: lagMax,
        windows: BrowserWindow.getAllWindows().length,
        byType
      }
    })
  } catch {
    // ignore
  }
  lagMax = 0
  lagSum = 0
  lagN = 0
}

export function startPerfSampler(): void {
  if (perfTimer) return
  perfTimer = setInterval(samplePerf, PERF_MS)
  perfTimer.unref?.()
  probeLag()
}

export function stopPerfSampler(): void {
  if (perfTimer) clearInterval(perfTimer)
  perfTimer = null
}
