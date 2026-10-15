/**
 * Learned-data delete and block (batch 16), saved in the data folder (other-blocked.json).
 * The main process owns the BLOCKED list; delete goes to the list's owner (match memory or bodies),
 * then the blocks are added. Every change is broadcast to all windows.
 */
import * as fs from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { dataPath } from '../../main/paths'
import { IPC } from '@shared/channels'
import {
  blockedDiag,
  cleanUnblockList,
  emptyBlockedDoc,
  isBlockedIn,
  normalizeBlockedDoc,
  removeBlocked,
  runDelete,
  type BlockedDoc,
  type DeleteReply,
  type LearnedKind
} from '@other/otherBlocked'
import { learnedKey } from '@other/otherBodies'
import { getMemory, memoryDelete } from './matchMemory'
import { bodiesDelete, getBodies } from './bodies'
import { logger } from '../../main/logger'

const FILE = 'other-blocked.json'

let doc: BlockedDoc | null = null

function filePath(): string {
  return dataPath(FILE)
}

function load(): BlockedDoc {
  if (doc) return doc
  try {
    doc = normalizeBlockedDoc(JSON.parse(fs.readFileSync(filePath(), 'utf8')))
    logger.info('other', 'blocked list loaded', { items: doc.items.length })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') logger.warn('other', 'blocked list file unreadable, starting empty', { error: (e as Error)?.message ?? String(e) })
    doc = emptyBlockedDoc()
  }
  return doc
}

/** write to a temp file, then rename over the old one */
function save(next: BlockedDoc): void {
  doc = next
  const file = filePath()
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...next }, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) {
    logger.warn('other', 'blocked list save failed', { error: (e as Error)?.message ?? String(e) })
  }
}

function broadcast(d: BlockedDoc): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherBlocked, d)
}

export function getBlocked(): BlockedDoc {
  return load()
}

export function isBlocked(kind: LearnedKind, key: string): boolean {
  return isBlockedIn(load(), kind, key)
}

/** labels read before the delete: the text as read (place), "name (near place)" (site), the body name (planet) */
function labelsFor(kind: LearnedKind, keys: string[]): Map<string, string> {
  const want = new Set(keys)
  const out = new Map<string, string>()
  if (kind === 'place') {
    for (const e of getMemory().entries) if (want.has(e.key)) out.set(e.key, e.text)
  } else if (kind === 'site') {
    for (const l of getBodies().learned) {
      const k = learnedKey(l.name, l.near)
      if (want.has(k)) out.set(k, `${l.name} (near ${l.near})`)
    }
  } else {
    const bodies = getBodies().bodies
    for (const k of keys) if (bodies[k]?.name) out.set(k, bodies[k].name)
  }
  return out
}

function removeLearned(kind: LearnedKind, keys: string[]): number {
  return kind === 'place' ? memoryDelete(keys) : bodiesDelete(kind, keys)
}

export function deleteLearnedData(raw: unknown): DeleteReply {
  const prev = load()
  const { reply, doc: next } = runDelete(prev, raw, { labels: labelsFor, remove: removeLearned }, new Date().toISOString())
  if (!reply.ok) {
    logger.debug('other', 'learned data delete rejected', { error: reply.error })
    return reply
  }
  if (next !== prev) {
    save(next)
    broadcast(next)
  }
  const kind = (raw as { kind: LearnedKind }).kind
  logger.info('other', 'learned data delete', { kind, count: reply.deleted, block: (raw as { block?: unknown }).block === true, blocked: reply.blocked })
  return reply
}

export function unblockLearnedData(raw: unknown): BlockedDoc {
  const list = cleanUnblockList(raw)
  const prev = load()
  const next = removeBlocked(prev, list)
  if (next === prev) {
    logger.debug('other', 'learned data unblock: nothing matched', { asked: list.length })
    return prev
  }
  save(next)
  broadcast(next)
  const removed = prev.items.length - next.items.length
  const kinds = [...new Set(list.map((i) => i.kind))]
  logger.info('other', 'learned data unblock', { kind: kinds.length === 1 ? kinds[0] : kinds, count: removed })
  return next
}

/** diagnostics '## BLOCKED' section */
export function getBlockedDiag(): ReturnType<typeof blockedDiag> {
  return blockedDiag(load())
}

let bound = false

export function registerOtherBlockedIpc(): void {
  if (bound) return
  bound = true
  ipcMain.handle(IPC.otherDataDelete, (_e, r: unknown) => deleteLearnedData(r))
  ipcMain.handle(IPC.otherBlockedGet, () => getBlocked())
  ipcMain.handle(IPC.otherBlockedUnblock, (_e, items: unknown) => unblockLearnedData(items))
}
