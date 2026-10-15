// One OCR reader (batch 15): a single tesseract.js worker shared by the contract reader and WHERE AM I zones 1/2.
// Contract jobs go before waiting zone jobs (FIFO within a kind); a contract job arriving trashes a running zone job
// (worker terminated, a fresh one starts). A job running past the time limit is stopped the same way. At most one
// worker alive; it stays loaded until quit. A failed load fails that job only: the next job tries to load again.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../main/logger'
import { cachePath } from '../../main/paths'
import { zoneParams } from './ocrPrep'

export type ReaderJob = 'contract' | 'zone1' | 'zone2'

/** full parameter set per job; applied whenever the job's profile differs from the last one applied (never partial) */
export const READER_PROFILES: Record<ReaderJob, Record<string, string>> = {
  contract: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', thresholding_method: '0' },
  zone1: zoneParams(1),
  zone2: zoneParams(2)
}

/** OCR time limit setting: missing/invalid -> 10, clamped to 5-30 seconds */
export const TIME_LIMIT_DEFAULT_SEC = 10
export const TIME_LIMIT_MIN_SEC = 5
export const TIME_LIMIT_MAX_SEC = 30
export function normalizeTimeLimitSec(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return TIME_LIMIT_DEFAULT_SEC
  return Math.min(TIME_LIMIT_MAX_SEC, Math.max(TIME_LIMIT_MIN_SEC, v))
}

// keep tesseract types local so the dep stays optional
export type TessWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
export type TessBlock = { paragraphs: { lines: { words: TessWord[] }[] }[] }
type TessData = { text: string; confidence: number; blocks?: TessBlock[] | null }
export type TessWorkerLike = {
  recognize: (
    img: Buffer,
    opts?: Record<string, unknown>,
    output?: Record<string, unknown>
  ) => Promise<{ data: TessData }>
  setParameters: (p: Record<string, unknown>) => Promise<unknown>
  terminate: () => Promise<unknown>
}
type CreateWorker = (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorkerLike>
type TessModule = { createWorker?: CreateWorker; default?: { createWorker?: CreateWorker } }

export interface ReaderData {
  text: string
  confidence: number
  /** only for 'contract' (recognize output { blocks: true }); zones use the default output */
  blocks?: TessBlock[] | null
}

/** thrown to a running zone job that was trashed for a contract read */
export class ReaderTrashedError extends Error {
  constructor(message = 'ocr reader trashed for contract') {
    super(message)
    this.name = 'ReaderTrashedError'
  }
}

/** thrown to a job that ran longer than the OCR time limit */
export class ReaderTimeoutError extends Error {
  constructor(message = 'ocr reader time limit hit') {
    super(message)
    this.name = 'ReaderTimeoutError'
  }
}

export interface ReaderStats {
  /** workers created */
  started: number
  /** workers alive now (0 or 1) */
  alive: number
  /** workers actually terminated to make room for a contract read */
  restarts: number
  /** running zone jobs rejected with ReaderTrashedError */
  trashed: number
  /** jobs stopped by the time limit */
  timeouts: number
  /** setParameters calls */
  switches: number
  lastSwitchMs?: number
}

/** cancel function for a timer */
type Cancel = () => void
export interface ReaderCoreDeps {
  createWorker: () => Promise<TessWorkerLike>
  log?: (msg: string, data?: object) => void
  /** read when each job starts on a loaded worker; default 10 s */
  timeLimitMs?: () => number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => Cancel
}

type Pending = {
  png: Buffer
  job: ReaderJob
  resolve: (d: ReaderData) => void
  reject: (e: unknown) => void
}
/** done: the job was settled from outside its run (trashed, timed out, disposed) */
type Running = { p: Pending; done: boolean; cancelTimer: Cancel | null }

const isZone = (j: ReaderJob): boolean => j !== 'contract'

const defaultSetTimer = (fn: () => void, ms: number): Cancel => {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

/** test seam: the same core with an injected worker factory and timer (no tesseract.js, no electron) */
export function createReaderCore(deps: ReaderCoreDeps): {
  recognize: (png: Buffer, job: ReaderJob) => Promise<ReaderData>
  contractPending: () => boolean
  busy: () => boolean
  available: () => Promise<boolean>
  dispose: () => Promise<void>
  stats: () => ReaderStats
} {
  const log = deps.log ?? ((): void => undefined)
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? defaultSetTimer
  const timeLimitMs = deps.timeLimitMs ?? ((): number => TIME_LIMIT_DEFAULT_SEC * 1000)
  let worker: TessWorkerLike | null = null
  let creating: Promise<TessWorkerLike> | null = null
  let terminating: Promise<void> = Promise.resolve()
  let applied: string | null = null // JSON of the last profile applied to the live worker
  let disposed = false
  const queue: Pending[] = []
  let running: Running | null = null
  const stats: ReaderStats = { started: 0, alive: 0, restarts: 0, trashed: 0, timeouts: 0, switches: 0 }

  /** terminate the live worker; false when none was alive (e.g. the first one still loading) */
  function killWorker(): boolean {
    const w = worker
    worker = null
    applied = null
    if (!w) return false
    stats.alive = 0
    const prev = terminating
    terminating = prev.then(async () => {
      try {
        await w.terminate()
      } catch {
        /* ignore */
      }
    })
    return true
  }

  /** one load at a time; a failed load is not remembered, the next job tries again */
  async function getWorker(): Promise<TessWorkerLike> {
    if (worker) return worker
    if (creating) return creating
    creating = (async () => {
      await terminating // terminate first, then create: never two alive
      const t0 = now()
      try {
        const w = await deps.createWorker() // the app wrapper logs a load failure at error level
        stats.started++
        if (disposed) {
          await w.terminate().catch(() => undefined)
          throw new Error('ocr reader disposed')
        }
        worker = w
        applied = null
        stats.alive = 1
        log('ocr reader ready', { ms: now() - t0 })
        return w
      } finally {
        creating = null
      }
    })()
    return creating
  }

  /** settle a running job from outside its run; its run's later result is ignored */
  function settleRunning(r: Running, e: Error): void {
    r.done = true
    r.cancelTimer?.()
    r.cancelTimer = null
    if (running === r) running = null
    r.p.reject(e)
  }

  /** a contract job arrived: the running zone job is trashed and its worker terminated */
  function trashRunningZone(): void {
    const r = running
    if (!r || !isZone(r.p.job) || r.done) return
    stats.trashed++
    settleRunning(r, new ReaderTrashedError())
    log('ocr reader trashed for contract', { job: r.p.job })
    if (killWorker()) stats.restarts++
  }

  function onTimeLimit(r: Running, limit: number, t0: number): void {
    if (r.done || running !== r) return
    stats.timeouts++
    settleRunning(r, new ReaderTimeoutError())
    log('ocr reader time limit hit', { job: r.p.job, ms: now() - t0, limitMs: limit })
    killWorker() // the next job gets a fresh worker
    pump()
  }

  function next(): Pending | undefined {
    const ci = queue.findIndex((p) => p.job === 'contract')
    if (ci >= 0) return queue.splice(ci, 1)[0]
    return queue.shift()
  }

  function pump(): void {
    if (running || disposed) return
    const p = next()
    if (!p) return
    const r: Running = { p, done: false, cancelTimer: null }
    running = r
    void run(r)
  }

  async function run(r: Running): Promise<void> {
    const { p } = r
    try {
      const w = await getWorker()
      if (r.done) return
      // the time limit counts from here: the load (maybe a first-run tessdata download) is excluded
      const limit = timeLimitMs()
      const t0 = now()
      r.cancelTimer = setTimer(() => onTimeLimit(r, limit, t0), limit)
      const profile = READER_PROFILES[p.job]
      const key = JSON.stringify(profile)
      if (applied !== key) {
        const s0 = now()
        await w.setParameters(profile)
        if (r.done) return
        applied = key
        stats.switches++
        stats.lastSwitchMs = now() - s0
        log('ocr reader settings switch', { job: p.job, ms: stats.lastSwitchMs })
      }
      const { data } =
        p.job === 'contract' ? await w.recognize(p.png, {}, { blocks: true }) : await w.recognize(p.png)
      if (r.done) return
      const out: ReaderData = { text: data.text ?? '', confidence: data.confidence ?? 0 }
      if (p.job === 'contract') out.blocks = data.blocks ?? null
      r.done = true
      r.cancelTimer?.()
      p.resolve(out)
    } catch (e) {
      if (!r.done) {
        r.done = true
        r.cancelTimer?.()
        p.reject(e)
      }
    } finally {
      if (running === r) running = null
      pump()
    }
  }

  function recognize(png: Buffer, job: ReaderJob): Promise<ReaderData> {
    if (disposed) return Promise.reject(new Error('ocr reader disposed'))
    return new Promise<ReaderData>((resolve, reject) => {
      queue.push({ png, job, resolve, reject })
      if (job === 'contract') trashRunningZone()
      pump()
    })
  }

  function contractPending(): boolean {
    return queue.some((p) => p.job === 'contract') || (running !== null && running.p.job === 'contract')
  }

  function busy(): boolean {
    return running !== null || queue.length > 0
  }

  async function available(): Promise<boolean> {
    if (disposed) return false
    try {
      await getWorker()
      return true
    } catch {
      return false
    }
  }

  async function dispose(): Promise<void> {
    disposed = true
    if (running) settleRunning(running, new Error('ocr reader disposed'))
    for (const p of queue.splice(0)) p.reject(new Error('ocr reader disposed'))
    if (creating) await creating.catch(() => undefined)
    killWorker()
    await terminating
  }

  return { recognize, contractPending, busy, available, dispose, stats: () => ({ ...stats }) }
}

// ---- the app's one reader ----

const tessdataDir = (): string => cachePath('tessdata')

let getLimitSec: () => unknown = () => undefined
let core: ReturnType<typeof createReaderCore> | null = null
function appCore(): ReturnType<typeof createReaderCore> {
  if (!core)
    core = createReaderCore({
      createWorker: async () => {
        const dir = tessdataDir()
        try {
          fs.mkdirSync(dir, { recursive: true })
          logger.info('ocr', 'ocr reader loading', { hasData: fs.existsSync(path.join(dir, 'eng.traineddata')) })
          const tesseract = (await import('tesseract.js')) as unknown as TessModule
          const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker
          if (!createWorker) throw new Error('tesseract.js missing createWorker')
          return await createWorker('eng', 1, { cachePath: dir, gzip: true })
        } catch (e) {
          // as 1.0.1: console + error-level log
          console.error('[ocr] tesseract.js failed to load:', e)
          logger.error('ocr', 'tesseract load failed', { error: (e as Error)?.message ?? String(e) })
          throw e
        }
      },
      log: (msg, data) => logger.info('ocr', msg, data as Record<string, unknown> | undefined),
      timeLimitMs: () => {
        let v: unknown
        try {
          v = getLimitSec()
        } catch {
          v = undefined
        }
        return normalizeTimeLimitSec(v) * 1000
      }
    })
  return core
}

/** one OCR job on the one reader; contract jobs go before waiting zone jobs; FIFO within a kind */
export function readerRecognize(png: Buffer, job: ReaderJob): Promise<ReaderData> {
  return appCore().recognize(png, job)
}

/** true while a contract job is running or queued */
export function contractPending(): boolean {
  return appCore().contractPending()
}

/** true while any job is running or queued */
export function readerBusy(): boolean {
  return appCore().busy()
}

/** loads the worker if needed (retries a failed load) */
export function readerAvailable(): Promise<boolean> {
  return appCore().available()
}

/** eng.traineddata in cachePath('tessdata') */
export async function readerAssetsReady(): Promise<boolean> {
  try {
    return fs.existsSync(path.join(tessdataDir(), 'eng.traineddata'))
  } catch {
    return false
  }
}

/** the OCR time limit in seconds, read when each job starts (settings ocrTimeLimitSec) */
export function setReaderTimeLimit(getSec: () => unknown): void {
  getLimitSec = getSec
}

/** app quit: terminate, no restart */
export async function disposeReader(): Promise<void> {
  if (core) await core.dispose()
}

export function readerStats(): ReaderStats {
  return appCore().stats()
}
