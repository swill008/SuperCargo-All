// window-side debug log: batches lines to main. API is the contract; internals owned by the ui agent.

import type { LogCategory, LogEntry, LogLevel, LogSource } from '@shared/debugLog'

type Fields = Record<string, unknown>

const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''
const SRC: LogSource = hash === 'compact' ? 'overlay' : hash === 'debug' ? 'debug' : 'main'

let queue: LogEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!queue.length) return
  const batch = queue
  queue = []
  try {
    window.supercargo?.debugLog?.(batch)
  } catch {
    // ipc gone (unload); drop the batch
  }
}

export function log(level: LogLevel, cat: LogCategory, msg: string, fields?: Fields): void {
  queue.push({ t: Date.now(), level, cat, src: SRC, msg, fields })
  if (level === 'error') flush()
  else if (!timer) timer = setTimeout(flush, 250)
}

export const dlog = {
  debug: (cat: LogCategory, msg: string, fields?: Fields): void => log('debug', cat, msg, fields),
  info: (cat: LogCategory, msg: string, fields?: Fields): void => log('info', cat, msg, fields),
  warn: (cat: LogCategory, msg: string, fields?: Fields): void => log('warn', cat, msg, fields),
  error: (cat: LogCategory, msg: string, fields?: Fields): void => log('error', cat, msg, fields)
}

let forwarding = false
let inForward = false

function argText(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.message
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

// window errors and console.error/warn go to the debug log too
export function installErrorForwarding(): void {
  if (forwarding || typeof window === 'undefined') return
  forwarding = true

  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined
    log('error', 'ui', e.message || String(err ?? 'error'), { stack: err?.stack, file: e.filename, line: e.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown
    const err = r instanceof Error ? r : undefined
    log('error', 'ui', `unhandled rejection: ${err ? err.message : argText(r)}`, { stack: err?.stack })
  })
  window.addEventListener('beforeunload', flush)

  const wrap = (level: 'error' | 'warn'): void => {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      orig(...args)
      // a failing send must not loop back through here
      if (inForward) return
      inForward = true
      try {
        const stack = args.find((a): a is Error => a instanceof Error)?.stack
        log(level, 'ui', args.map(argText).join(' ').slice(0, 2000), stack ? { stack } : undefined)
      } catch {
        // ignore
      } finally {
        inForward = false
      }
    }
  }
  wrap('error')
  wrap('warn')
}
