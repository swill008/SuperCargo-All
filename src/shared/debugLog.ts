// debug log contract shared by main, preload and both windows

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'app' | 'crash' | 'ui' | 'watch' | 'haul' | 'other' | 'ocr' | 'net' | 'ipc' | 'crew'
// who wrote the line: the main process or one of the windows
export type LogSource = 'proc' | 'main' | 'overlay' | 'debug'

export interface LogEntry {
  t: number // epoch ms
  level: LogLevel
  cat: LogCategory
  src: LogSource
  msg: string
  fields?: Record<string, unknown>
}

export interface DebugInfo {
  version: string
  commit: string
  branch: string
  electron: string
  os: string
  workMode: string
  verbose: boolean
  logDir: string
  gameLogPath: string
  watcherConnected: boolean
}

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
export const LOG_CATEGORIES: LogCategory[] = ['app', 'crash', 'ui', 'watch', 'haul', 'other', 'ocr', 'net', 'ipc', 'crew']

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function fieldValue(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return /[\s"=]/.test(v) || v === '' ? JSON.stringify(v) : v
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v)
  try {
    const s = JSON.stringify(v)
    return s.length > 300 ? `${s.slice(0, 300)}…` : s
  } catch {
    return String(v)
  }
}

// 09:41:12.345 INFO  other [main] job created ref=J03 mission=7f2a
export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  const fields = e.fields
    ? Object.entries(e.fields)
        .map(([k, v]) => `${k}=${fieldValue(v)}`)
        .join(' ')
    : ''
  return `${time} ${e.level.toUpperCase().padEnd(5)} ${e.cat.padEnd(5)} [${e.src}] ${e.msg}${fields ? ` ${fields}` : ''}`
}
