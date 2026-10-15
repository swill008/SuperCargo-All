/**
 * Match memory (M1-M8), saved in the data folder (other-matches.json).
 * The main process owns the file; both windows read it via IPC and get every change broadcast.
 * Saves are coalesced to at most one per second and flushed on quit.
 */
import * as fs from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { dataPath } from '../../main/paths'
import { IPC } from '@shared/channels'
import {
  CHANGES_MAX,
  MEMORY_MAX,
  deleteEntries,
  emptyMemoryDoc,
  forgetEntry,
  recordProof,
  recordSeen,
  setUserPlace,
  undoChange,
  withoutBlocked,
  type MemoryChange,
  type MemoryDoc,
  type MemoryEntry,
  type MemoryWhere,
  type ProofInput,
  type SeenInput,
  type SetInput
} from '@other/otherMemory'
import { logger } from '../../main/logger'

export type MemorySeenInput = SeenInput
export type MemoryProofInput = ProofInput
export type MemorySetInput = SetInput

const FILE = 'other-matches.json'
const SAVE_GAP_MS = 1000

let doc: MemoryDoc | null = null
let dirty = false
let lastSave = 0
let timer: ReturnType<typeof setTimeout> | null = null

function filePath(): string {
  return dataPath(FILE)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function cleanWhere(v: unknown): MemoryWhere | null {
  if (!isObj(v) || !isStr(v.at)) return null
  return { name: isStr(v.name) ? v.name : null, meters: isNum(v.meters) ? v.meters : null, at: v.at }
}

/** one entry from the file; null when it can't be used */
export function cleanEntry(v: unknown): MemoryEntry | null {
  if (!isObj(v) || !isStr(v.key) || !v.key || !isStr(v.text)) return null
  const origin = v.origin === 'user' ? 'user' : v.origin === 'game' ? 'game' : null
  if (!origin) return null
  const place = isStr(v.place) ? v.place : null
  if (origin === 'user' && !place) return null
  const firstAt = isStr(v.firstAt) ? v.firstAt : isStr(v.lastAt) ? v.lastAt : null
  const lastAt = isStr(v.lastAt) ? v.lastAt : firstAt
  if (!firstAt || !lastAt) return null
  const n = (x: unknown): number => (isNum(x) && x > 0 ? Math.floor(x) : 0)
  const e: MemoryEntry = {
    key: v.key,
    text: v.text,
    place,
    origin,
    confirmed: n(v.confirmed),
    wrong: n(v.wrong),
    seen: Math.max(1, n(v.seen)),
    firstAt,
    lastAt
  }
  if (isStr(v.context)) e.context = v.context
  if (Array.isArray(v.wrongAt)) {
    const w = v.wrongAt.map(cleanWhere).filter((x): x is MemoryWhere => !!x).slice(0, 3)
    if (w.length) e.wrongAt = w
  }
  if (origin === 'user' && e.wrong >= 2) e.disputed = true
  if (isStr(v.lastStatus)) e.lastStatus = v.lastStatus
  if (isNum(v.lastConfidence)) e.lastConfidence = v.lastConfidence
  if (Array.isArray(v.lastEvidence)) e.lastEvidence = v.lastEvidence.filter(isStr).slice(0, 8)
  return e
}

const WHATS = new Set<MemoryChange['what']>(['seen-new', 'confirm', 'set', 'forget', 'proof', 'undo'])

function cleanChange(v: unknown): MemoryChange | null {
  if (!isObj(v) || !isStr(v.at) || !isStr(v.key) || !isStr(v.text)) return null
  if (!WHATS.has(v.what as MemoryChange['what'])) return null
  const by = v.by === 'user' ? 'user' : v.by === 'game' ? 'game' : null
  if (!by) return null
  const before = v.before == null ? null : cleanEntry(v.before)
  const after = v.after == null ? null : cleanEntry(v.after)
  if ((v.before != null && !before) || (v.after != null && !after)) return null
  return { at: v.at, key: v.key, text: v.text, what: v.what as MemoryChange['what'], by, before, after }
}

/** validate a file's doc: bad entries / changes are dropped, duplicate keys keep the newest, caps applied */
export function normalizeMemoryDoc(raw: unknown): MemoryDoc {
  if (!isObj(raw)) return emptyMemoryDoc()
  const byKey = new Map<string, MemoryEntry>()
  for (const v of Array.isArray(raw.entries) ? raw.entries : []) {
    const e = cleanEntry(v)
    if (!e) continue
    const had = byKey.get(e.key)
    if (!had || had.lastAt < e.lastAt) byKey.set(e.key, e)
  }
  let entries = [...byKey.values()]
  if (entries.length > MEMORY_MAX) {
    // drop the oldest lastAt; never drop 'user' entries
    const user = entries.filter((e) => e.origin === 'user')
    const game = entries
      .filter((e) => e.origin !== 'user')
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
      .slice(0, Math.max(0, MEMORY_MAX - user.length))
    entries = [...user, ...game]
  }
  const changes = (Array.isArray(raw.changes) ? raw.changes : [])
    .map(cleanChange)
    .filter((c): c is MemoryChange => !!c)
    .slice(0, CHANGES_MAX)
  return { entries, changes }
}

function load(): MemoryDoc {
  if (doc) return doc
  try {
    doc = normalizeMemoryDoc(JSON.parse(fs.readFileSync(filePath(), 'utf8')))
    logger.info('other', 'match memory loaded', { entries: doc.entries.length, changes: doc.changes.length })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') logger.warn('other', 'match memory file unreadable, starting empty', { error: (e as Error)?.message ?? String(e) })
    doc = emptyMemoryDoc()
  }
  return doc
}

/** write to a temp file, then rename over the old one */
function writeNow(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!dirty || !doc) return
  dirty = false
  lastSave = Date.now()
  const file = filePath()
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...doc }, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) {
    logger.warn('other', 'match memory save failed', { error: (e as Error)?.message ?? String(e) })
  }
}

/** coalesced: at most one write per second */
function scheduleSave(): void {
  dirty = true
  if (timer) return
  const wait = Math.max(0, lastSave + SAVE_GAP_MS - Date.now())
  timer = setTimeout(writeNow, wait)
}

function broadcast(d: MemoryDoc): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherMemory, d)
}

/** apply a change; save + broadcast only when the doc changed */
function apply(next: MemoryDoc, what: string, info: Record<string, unknown>): MemoryDoc {
  const prev = load()
  if (next === prev) return prev
  doc = next
  scheduleSave()
  broadcast(next)
  logger.info('other', `match memory: ${what}`, { ...info, entries: next.entries.length })
  return next
}

const now = (): string => new Date().toISOString()

/** blocked place keys (Delete and block): set by blocked.ts so this file doesn't import it */
let blockCheck: (key: string) => boolean = () => false

export function setMemoryBlockCheck(fn: (key: string) => boolean): void {
  blockCheck = fn
}

export function getMemory(): MemoryDoc {
  return load()
}

export function memorySeen(list: MemorySeenInput[]): MemoryDoc {
  let d = load()
  const at = now()
  let n = 0
  const valid = list.filter((s) => isObj(s) && isStr(s.key) && !!s.key && isStr(s.text))
  for (const s of withoutBlocked(valid, blockCheck)) {
    d = recordSeen(d, s, at)
    n++
  }
  return apply(d, 'seen', { stops: n })
}

export function memoryProof(p: MemoryProofInput): MemoryDoc {
  if (!isObj(p) || !isStr(p.key) || !p.key || !isStr(p.text) || typeof p.ok !== 'boolean' || !cleanWhere(p.actual)) {
    logger.debug('other', 'match memory: proof rejected', {})
    return load()
  }
  if (!withoutBlocked([p], blockCheck).length) return load()
  return apply(recordProof(load(), p, now()), 'proof', { key: p.key, place: p.place, ok: p.ok, actual: p.actual.name, meters: p.actual.meters })
}

export function memorySet(p: MemorySetInput): MemoryDoc {
  if (!isObj(p) || !isStr(p.key) || !p.key || !isStr(p.text) || !isStr(p.place) || !p.place) {
    logger.debug('other', 'match memory: set rejected', {})
    return load()
  }
  const input: SetInput = { key: p.key, text: p.text, place: p.place }
  if (isStr(p.context)) input.context = p.context
  if (p.reset === true) input.reset = true
  return apply(setUserPlace(load(), input, now()), 'set', { key: p.key, place: p.place, reset: !!input.reset })
}

export function memoryForget(key: string): MemoryDoc {
  if (!isStr(key) || !key) return load()
  return apply(forgetEntry(load(), key, now()), 'forget', { key })
}

/** DELETE: entries and their changes go for good; returns how many entries were removed */
export function memoryDelete(keys: string[]): number {
  if (!Array.isArray(keys)) return 0
  const { doc: next, deleted } = deleteEntries(load(), keys.filter((k) => isStr(k) && !!k))
  apply(next, 'delete', { count: deleted })
  logger.info('other', 'match memory delete', { count: deleted })
  return deleted
}

export function memoryUndo(index: number): MemoryDoc {
  if (!Number.isInteger(index) || index < 0) return load()
  return apply(undoChange(load(), index, now()), 'undo', { index })
}

/** diagnostics 'MATCH MEMORY' section: entries (disputed, user, game; newest first in each) + changes */
export function getMemoryDiag(): { entries: number; user: number; disputed: number; list: MemoryEntry[]; changes: MemoryChange[] } {
  const d = load()
  const rank = (e: MemoryEntry): number => (e.disputed ? 0 : e.origin === 'user' ? 1 : 2)
  const list = [...d.entries].sort((a, b) => rank(a) - rank(b) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
  return {
    entries: d.entries.length,
    user: d.entries.filter((e) => e.origin === 'user').length,
    disputed: d.entries.filter((e) => e.disputed).length,
    list,
    changes: d.changes
  }
}

/** write any pending change now (will-quit) */
export function flushMemory(): void {
  writeNow()
}

let bound = false

export function registerOtherMemoryIpc(): void {
  if (bound) return
  bound = true
  ipcMain.handle(IPC.otherMemoryGet, () => getMemory())
  ipcMain.on(IPC.otherMemorySeen, (e, list: MemorySeenInput[]) => {
    if (!Array.isArray(list)) {
      logger.debug('ipc', 'match memory seen rejected', { sender: e.sender.id })
      return
    }
    memorySeen(list)
  })
  ipcMain.on(IPC.otherMemoryProof, (_e, p: MemoryProofInput) => {
    memoryProof(p)
  })
  ipcMain.handle(IPC.otherMemorySet, (_e, p: MemorySetInput) => memorySet(p))
  ipcMain.handle(IPC.otherMemoryForget, (_e, key: string) => memoryForget(key))
  ipcMain.handle(IPC.otherMemoryUndo, (_e, index: number) => memoryUndo(index))
}
