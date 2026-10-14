// EXPORT DIAGNOSTICS: one readable, cleaned .txt for Claude to review how the app read the game,
// what it decided and how it performed. Sections in a fixed order; see buildDiagnostics.

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import { formatEntry, type DebugInfo } from '@shared/debugLog'
import type { AppSettings } from '@shared/types'
import type { DiagExportOptions, DiagExportResult, TraceArea, TraceRecord } from '@shared/trace'
import { getProblems, getRecent, logger } from './logger'
import { flushTrace, getTraceRing, isTraceOn, traceFiles } from './trace'
import { learnIdentity, makeSanitizer, sanitizeDeep } from './sanitize'

const SNAPSHOT_WAIT_MS = 3000
const DEFAULT_HOURS = 3
const DECISIONS_MAX = 20000
const RAW_MAX = 5000
const DEBUG_LINES = 500
const LOG_HEAD = 40
const EXCERPT_MAX = 8000
const AREAS: TraceArea[] = ['parse', 'unknown', 'decide', 'distance', 'ocr', 'perf', 'usage', 'error']

interface Source {
  info: () => DebugInfo
  settings: () => AppSettings
  mainWindow: () => BrowserWindow | null
}
let source: Source | null = null
const waiting = new Map<string, (snap: unknown) => void>()

export function setDiagSource(s: Source): void {
  source = s
}

// main window answers IPC.diagSnapshotRequest here
export function registerDiagSnapshotReply(): void {
  ipcMain.on(IPC.diagSnapshotReply, (_e, reqId: unknown, snap: unknown) => {
    if (typeof reqId !== 'string') return
    const done = waiting.get(reqId)
    if (done) {
      waiting.delete(reqId)
      done(snap)
    }
  })
}

function requestSnapshot(): Promise<unknown> {
  const win = source?.mainWindow()
  if (!win || win.isDestroyed()) return Promise.resolve({ note: 'no main window' })
  const reqId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(reqId)
      resolve({ note: `main window did not answer within ${SNAPSHOT_WAIT_MS} ms` })
    }, SNAPSHOT_WAIT_MS)
    waiting.set(reqId, (snap) => {
      clearTimeout(timer)
      resolve(snap ?? { note: 'empty snapshot' })
    })
    try {
      win.webContents.send(IPC.diagSnapshotRequest, reqId)
    } catch (e) {
      clearTimeout(timer)
      waiting.delete(reqId)
      resolve({ note: `snapshot request failed: ${(e as Error).message}` })
    }
  })
}

function readTraceFile(): TraceRecord[] {
  flushTrace()
  const out: TraceRecord[] = []
  for (const f of traceFiles()) {
    let text = ''
    try {
      text = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const l of text.split('\n')) {
      if (!l) continue
      try {
        const r = JSON.parse(l) as TraceRecord
        if (r && typeof r.t === 'number' && typeof r.area === 'string') out.push(r)
      } catch {
        // torn line
      }
    }
  }
  // the file is the full record; the ring only matters if the file is gone
  return out.length ? out : getTraceRing()
}

function readGameLog(p: string): string[] {
  if (!p) return []
  try {
    return fs.readFileSync(p, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}

const STAMP = /^<([0-9T:\-.Z]+)>\s*/

function stampMs(line: string): number | null {
  const m = STAMP.exec(line)
  if (!m) return null
  const t = Date.parse(m[1])
  return Number.isFinite(t) ? t : null
}

function sessionStart(gameLog: string[], recs: TraceRecord[]): number | null {
  const first = gameLog.find((l) => l.includes('Log started'))
  const t = first ? stampMs(first) : null
  if (t) return t
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i]
    if (r.what?.toLowerCase().includes('session') || r.line?.includes('Log started')) return r.t
  }
  return null
}

function gameBuild(gameLog: string[]): string {
  const hits: string[] = []
  for (const l of gameLog.slice(0, 400)) {
    if (/\b(FileVersion|ProductVersion|Branch|Changelist|BuildId|Build Id)\b\s*[:=]/i.test(l)) {
      hits.push(l.replace(STAMP, '').trim().slice(0, 120))
      if (hits.length >= 4) break
    }
  }
  return hits.length ? hits.join(' | ') : 'unknown'
}

// groups unknown lines that differ only in numbers, ids and timestamps
function pattern(line: string): string {
  return line
    .replace(STAMP, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d[\d,.]*/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

const iso = (t: number): string => new Date(t).toISOString()
const fileStamp = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function jsonl(recs: TraceRecord[], max: number): string {
  if (!recs.length) return '(none)'
  const cut = recs.length > max ? recs.slice(-max) : recs
  const head = recs.length > max ? `(oldest ${recs.length - max} of ${recs.length} left out)\n` : ''
  return head + cut.map((r) => JSON.stringify(r)).join('\n')
}

function perfLines(recs: TraceRecord[]): string[] {
  const out: string[] = []
  const timed = recs.filter((r) => typeof r.ms === 'number').sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
  for (const r of timed.slice(0, 8)) out.push(`  ${r.ms} ms  ${r.what}${r.mode ? ` [${r.mode}]` : ''} (${iso(r.t)})`)
  const samples = recs.filter((r) => r.what === 'sample' && r.data)
  const max = (k: string): number => Math.max(0, ...samples.map((r) => Number(r.data?.[k]) || 0))
  if (samples.length) {
    out.push(
      `  samples: ${samples.length}, peak CPU ${max('cpuPct')}%, peak memory ${max('memMB')} MB, peak main heap ${max('mainHeapMB')} MB, worst event-loop lag ${max('lagMaxMs')} ms, max windows ${max('windows')}`
    )
  }
  return out.length ? out : ['  (none)']
}

export async function buildDiagnostics(opts: DiagExportOptions = {}, savePath?: string): Promise<DiagExportResult> {
  try {
    const settings = source?.settings()
    const info = source?.info()
    const now = Date.now()
    const snapshotP = requestSnapshot()

    const all = readTraceFile()
    const gameLog = readGameLog(settings?.gameLogPath ?? '')
    const hours = typeof opts.hours === 'number' && opts.hours > 0 ? opts.hours : undefined
    const start = sessionStart(gameLog, all)
    const since = hours ? now - hours * 3600_000 : (start ?? now - DEFAULT_HOURS * 3600_000)
    const periodWhy = hours ? `last ${hours} h` : start ? 'this game session' : `last ${DEFAULT_HOURS} h (no session start found)`
    const recs = all.filter((r) => r.t >= since).sort((a, b) => a.t - b.t)
    const by = (areas: TraceArea[]): TraceRecord[] => recs.filter((r) => areas.includes(r.area))

    // learn who the player is from everything that may name them, then clean the whole file with it
    const recent = getRecent()
    const ident = learnIdentity(gameLog)
    learnIdentity(
      recs.map((r) => r.line ?? ''),
      ident
    )
    learnIdentity(
      recent.map((e) => formatEntry(e)),
      ident
    )
    const clean = makeSanitizer(ident)
    const snapshot = await snapshotP

    // summary numbers
    const counts = AREAS.map((a) => {
      const rs = recs.filter((r) => r.area === a)
      const modes = ['haul', 'other', 'both'].map((m) => [m, rs.filter((r) => r.mode === m).length] as const).filter(([, n]) => n)
      return `  ${a}: ${rs.length}${modes.length ? ` (${modes.map(([m, n]) => `${m} ${n}`).join(', ')})` : ''}`
    })
    const unknown = new Map<string, { n: number; first: number; last: number; example: string }>()
    for (const r of by(['unknown'])) {
      const key = pattern(r.line ?? r.what)
      const u = unknown.get(key)
      if (u) {
        u.n++
        u.last = r.t
      } else unknown.set(key, { n: 1, first: r.t, last: r.t, example: r.line ?? r.what })
    }
    const unknownSorted = [...unknown.entries()].sort((a, b) => b[1].n - a[1].n)
    const errorRecs = by(['error'])
    const problems = getProblems().filter((e) => e.t >= since)
    const errorCount = errorRecs.length + problems.filter((e) => e.level === 'error').length
    const perf = by(['perf'])
    const usage = by(['usage'])
    const usageCounts = new Map<string, number>()
    for (const r of usage) usageCounts.set(r.what, (usageCounts.get(r.what) ?? 0) + 1)

    let settingsJson = '{}'
    if (settings) {
      const s = { ...settings } as Record<string, unknown>
      delete s['telemetryClientId']
      settingsJson = JSON.stringify(sanitizeDeep(s, clean), null, 2)
    }

    // the Game.log lines the app actually used, plus the head of the log, in log order
    let excerpt = '(left out by request)'
    if (opts.includeLogExcerpt !== false) {
      if (!gameLog.length) excerpt = '(Game.log not readable)'
      else {
        const used = new Set(recs.map((r) => r.line?.trim()).filter((l): l is string => !!l))
        const keep: string[] = []
        gameLog.forEach((l, i) => {
          if (i < LOG_HEAD || (l && used.has(l.trim()))) keep.push(l)
        })
        const cut = keep.length > EXCERPT_MAX ? [...keep.slice(0, LOG_HEAD), `... (${keep.length - EXCERPT_MAX} lines left out) ...`, ...keep.slice(-(EXCERPT_MAX - LOG_HEAD))] : keep
        excerpt = `(${keep.length} of ${gameLog.length} lines: first ${LOG_HEAD} + every line a trace record refers to)\n` + cut.join('\n')
      }
    }

    const text = [
      '# SuperCargo diagnostics',
      'Read by Claude to review how the app reads the game, what it decides and how it performs. Personal data removed: player handle -> PLAYER, own ids -> 1, other players -> OWNER-n, OS user -> %USERNAME%.',
      '',
      '## SUMMARY',
      `version: ${info?.version ?? app.getVersion()}`,
      `commit: ${info?.commit ?? 'unknown'}  branch: ${info?.branch ?? 'unknown'}`,
      `electron: ${info?.electron ?? process.versions.electron}  os: ${info?.os ?? process.platform}`,
      `game build: ${gameBuild(gameLog)}`,
      `work mode: ${info?.workMode ?? 'unknown'}`,
      `game log: ${settings?.gameLogPath || '(none)'}  watcher connected: ${info?.watcherConnected ? 'yes' : 'no'}`,
      `trace recording: ${isTraceOn() ? 'on' : 'off'}`,
      `period: ${iso(since)} .. ${iso(now)} (${periodWhy})`,
      `generated: ${iso(now)}`,
      `trace records in period: ${recs.length}`,
      ...counts,
      `top unknown-line patterns (${unknown.size}):`,
      ...(unknownSorted.length ? unknownSorted.slice(0, 10).map(([k, u]) => `  ${u.n}x  ${k}`) : ['  (none)']),
      'slowest perf:',
      ...perfLines(perf),
      `errors: ${errorCount} (trace ${errorRecs.length}, log errors ${problems.filter((e) => e.level === 'error').length}, log warnings ${problems.filter((e) => e.level === 'warn').length})`,
      '',
      '## SETTINGS',
      settingsJson,
      '',
      '## SNAPSHOT',
      JSON.stringify(sanitizeDeep(snapshot, clean), null, 2),
      '',
      '## UNKNOWN LINES',
      unknownSorted.length
        ? unknownSorted.map(([k, u]) => `${u.n}x  first ${iso(u.first)} last ${iso(u.last)}\n  pattern: ${k}\n  example: ${u.example}`).join('\n')
        : '(none)',
      '',
      '## DECISIONS',
      jsonl(by(['parse', 'decide', 'distance', 'ocr']), DECISIONS_MAX),
      '',
      '## PERF',
      jsonl(perf, RAW_MAX),
      '',
      '## USAGE',
      usageCounts.size ? [...usageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n}x  ${w}`).join('\n') : '(none)',
      '',
      jsonl(usage, RAW_MAX),
      '',
      '## ERRORS',
      jsonl(errorRecs, RAW_MAX),
      '',
      `log warnings/errors this run (${problems.length}):`,
      problems.length ? problems.map(formatEntry).join('\n') : '(none)',
      '',
      '## DEBUG LOG',
      recent.length ? recent.slice(-DEBUG_LINES).map(formatEntry).join('\n') : '(none)',
      '',
      '## LOG EXCERPT',
      excerpt,
      ''
    ].join('\n')
    // every section, cleaned in one pass
    const out = text
      .split('\n')
      .map((l) => clean(l))
      .join('\n')

    let dest = savePath
    if (!dest) {
      const win = source?.mainWindow()
      const opt = {
        title: 'Export diagnostics',
        defaultPath: path.join(app.getPath('documents'), `SuperCargo-diagnostics-${fileStamp()}.txt`),
        filters: [{ name: 'Text', extensions: ['txt'] }]
      }
      const picked = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, opt) : await dialog.showSaveDialog(opt)
      if (picked.canceled || !picked.filePath) return { ok: false, error: 'cancelled' }
      dest = picked.filePath
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out, 'utf8')
    const bytes = Buffer.byteLength(out)
    logger.info('app', 'diagnostics exported', { path: dest, bytes, records: recs.length })
    return { ok: true, path: dest, bytes }
  } catch (e) {
    logger.error('app', 'diagnostics export failed', { error: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  }
}
