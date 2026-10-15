/**
 * Planet table + learned generic places, saved in the data folder (other-bodies.json).
 * The table is rebuilt from the current roster on every get; the file carries the panel radii,
 * seen counts and learned places across restarts.
 */
import * as fs from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { dataPath } from '../../main/paths'
import { IPC } from '@shared/channels'
import type { WhereRunResult } from '@other/otherWhere'
import {
  bodiesDiag,
  bodyKey,
  buildBodies,
  deleteLearned,
  deletePanelRadius,
  emptyBodiesDoc,
  normalizeBodiesDoc,
  radiusSane,
  recordLearned,
  recordPanelRadius,
  type BodiesDoc,
  type LearnedPlaceReport
} from '@other/otherBodies'
import { currentLocationRoster } from './scanLog'
import { logger } from '../../main/logger'

const FILE = 'other-bodies.json'

let saved: BodiesDoc | null = null

/** blocked-list check, set by main/blocked.ts (kept injected so this module doesn't import it) */
let blockCheck: (kind: 'site' | 'planet', key: string) => boolean = () => false

export function setBodiesBlockCheck(fn: (kind: 'site' | 'planet', key: string) => boolean): void {
  blockCheck = fn
}

function filePath(): string {
  return dataPath(FILE)
}

function load(): BodiesDoc {
  if (saved) return saved
  try {
    saved = normalizeBodiesDoc(JSON.parse(fs.readFileSync(filePath(), 'utf8')))
    logger.info('other', 'bodies loaded', { bodies: Object.keys(saved.bodies).length, learned: saved.learned.length })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') logger.warn('other', 'bodies file unreadable, starting empty', { error: (e as Error)?.message ?? String(e) })
    saved = emptyBodiesDoc()
  }
  return saved
}

/** write to a temp file, then rename over the old one */
function save(doc: BodiesDoc): void {
  saved = doc
  const file = filePath()
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...doc }, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) {
    logger.warn('other', 'bodies save failed', { error: (e as Error)?.message ?? String(e) })
  }
}

function broadcast(doc: BodiesDoc): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherBodies, doc)
}

/** table built from the current roster + the saved file */
export function getBodies(): BodiesDoc {
  const s = load()
  return { bodies: buildBodies(currentLocationRoster(), s), learned: s.learned }
}

/** WHERE AM I hook: record the panel's exact radius for its body (50 km - 10,000 km) */
export function onWhereRead(r: WhereRunResult): void {
  const info = r.info
  if (!info?.body || typeof info.radiusM !== 'number') return
  if (!radiusSane(info.radiusM)) {
    logger.debug('other', 'bodies: panel radius out of range, ignored', { body: info.body, radiusM: info.radiusM })
    return
  }
  const doc = getBodies()
  if (blockCheck('planet', bodyKey(info.body))) {
    logger.debug('other', 'bodies: panel radius for a blocked planet, ignored', { body: info.body })
    return
  }
  const next = recordPanelRadius(doc, info.body, info.system, info.radiusM, new Date().toISOString(), (k) => blockCheck('planet', k))
  if (next === doc) {
    logger.debug('other', 'bodies: panel radius for a body not in the table, ignored', { body: info.body })
    return
  }
  save(next)
  broadcast(next)
  logger.info('other', 'bodies: panel radius recorded', { body: info.body, radiusM: info.radiusM, seen: next.bodies[info.body.trim().toLowerCase()]?.seen })
}

export function recordLearnedPlace(entry: LearnedPlaceReport): boolean {
  const doc = getBodies()
  const next = recordLearned(doc, entry, new Date().toISOString(), (k) => blockCheck('site', k))
  if (next === doc) return false
  save(next)
  broadcast(next)
  logger.info('other', 'bodies: learned place', { name: entry.name, near: entry.near, nearMeters: Math.round(entry.nearMeters), learned: next.learned.length })
  return true
}

/**
 * Delete learned data: 'site' keys are learnedKey(name, near); 'planet' keys are bodyKey(name) and drop the
 * panel radius (the planet falls back to the estimate). Saves and broadcasts when anything went. Returns the count.
 */
export function bodiesDelete(kind: 'site' | 'planet', keys: string[]): number {
  if (!Array.isArray(keys) || !keys.length) return 0
  const doc = getBodies()
  const r = kind === 'site' ? deleteLearned(doc, keys) : deletePanelRadius(doc, keys)
  if (!r.deleted) return 0
  save(r.doc)
  broadcast(r.doc)
  logger.info('other', 'bodies: learned data deleted', { kind, count: r.deleted })
  return r.deleted
}

/** diagnostics 'BODIES' section */
export function getBodiesDiag(): ReturnType<typeof bodiesDiag> {
  return bodiesDiag(getBodies())
}

let bound = false

export function registerOtherBodiesIpc(): void {
  if (bound) return
  bound = true
  ipcMain.handle(IPC.otherBodiesGet, () => getBodies())
  ipcMain.on(IPC.otherLearnedPlace, (e, p: LearnedPlaceReport) => {
    if (!p || typeof p !== 'object' || !recordLearnedPlace(p)) logger.debug('ipc', 'learned place rejected', { sender: e.sender.id })
  })
}
