// main-process debug log: memory ring + log file. API is the contract; internals owned by the core agent.

import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatEntry, type LogCategory, type LogEntry, type LogLevel, type LogSource } from '@shared/debugLog'

type Fields = Record<string, unknown>

const RING_MAX = 2000
const FLUSH_MS = 500
const ROTATE_BYTES = 5 * 1024 * 1024
const KEEP = 3 // supercargo.1.log .. supercargo.3.log

const listeners = new Set<(e: LogEntry) => void>()
const ring: LogEntry[] = []
const problems: LogEntry[] = [] // warn/error this run, outlives the ring
const PROBLEMS_MAX = 1000
let pending: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let fileBytes = -1 // -1 = not stat'd yet
let verbose = false // never persisted, off at each start
let quitHooked = false

export function isVerbose(): boolean {
  return verbose
}

export function setVerbose(on: boolean): void {
  verbose = on
}

export function logDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function logFile(): string {
  return path.join(logDir(), 'supercargo.log')
}

export function getRecent(): LogEntry[] {
  return ring.slice()
}

export function getProblems(): LogEntry[] {
  return problems.slice()
}

function rotate(): void {
  const dir = logDir()
  const name = (i: number): string => path.join(dir, i ? `supercargo.${i}.log` : 'supercargo.log')
  try {
    fs.rmSync(name(KEEP), { force: true })
  } catch {
    // ignore
  }
  for (let i = KEEP - 1; i >= 0; i--) {
    try {
      if (fs.existsSync(name(i))) fs.renameSync(name(i), name(i + 1))
    } catch {
      // ignore
    }
  }
  fileBytes = 0
}

export function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!pending.length) return
  const text = pending.join('\n') + '\n'
  pending = []
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    if (fileBytes < 0) {
      try {
        fileBytes = fs.statSync(logFile()).size
      } catch {
        fileBytes = 0
      }
    }
    if (fileBytes > 0 && fileBytes + text.length > ROTATE_BYTES) rotate()
    fs.appendFileSync(logFile(), text, 'utf8')
    fileBytes += Buffer.byteLength(text)
  } catch {
    // logging never throws
  }
}

function hookQuit(): void {
  if (quitHooked) return
  quitHooked = true
  try {
    app.on('will-quit', flush)
    process.on('exit', flush)
  } catch {
    // ignore
  }
}

// every line goes through here, including batches forwarded from the windows
export function write(e: LogEntry): void {
  if (e.level === 'debug' && !verbose) return
  try {
    ring.push(e)
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
    if (e.level === 'warn' || e.level === 'error') {
      problems.push(e)
      if (problems.length > PROBLEMS_MAX) problems.shift()
    }
    pending.push(formatEntry(e))
    hookQuit()
    if (e.level === 'error') flush()
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
  } catch {
    // ignore
  }
  for (const l of listeners) {
    try {
      l(e)
    } catch {
      // a bad listener must not break logging
    }
  }
}

export function log(level: LogLevel, cat: LogCategory, msg: string, fields?: Fields, src: LogSource = 'proc'): void {
  write({ t: Date.now(), level, cat, src, msg, fields })
}

export const logger = {
  debug: (cat: LogCategory, msg: string, fields?: Fields): void => log('debug', cat, msg, fields),
  info: (cat: LogCategory, msg: string, fields?: Fields): void => log('info', cat, msg, fields),
  warn: (cat: LogCategory, msg: string, fields?: Fields): void => log('warn', cat, msg, fields),
  error: (cat: LogCategory, msg: string, fields?: Fields): void => log('error', cat, msg, fields)
}

export function onEntry(cb: (e: LogEntry) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
