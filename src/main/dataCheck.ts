// Damaged-data check for a SuperCargo data folder.
// checkDataFolder: every SuperCargo JSON file in the folder root must parse and have the shape its loader expects.
// moveForRepair: moves ALL SuperCargo files and folders (never settings.json) into "Moved for Repair\<date>".
// startupDataCheck: runs before any window opens; asks Reset and continue / Quit when something can't be read.
import { dialog } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DataFolderCheck, DataFolderProblem } from '@shared/types'
import { dataFolder } from './paths'
import { logger } from './logger'

export const REPAIR_FOLDER = 'Moved for Repair'

// what the app writes in the data folder root (settings.json is never one of them: it stays where it is)
export const DATA_FILES = [
  'manifest.json',
  'history.json',
  'window-state.json',
  'other-jobs.json',
  'other-matches.json',
  'other-bodies.json',
  'other-uex-places.json',
  'reference-data-status.json',
  'upload-queue.json'
]
export const DATA_DIRS = ['game-data', 'logs', 'ocr-samples', 'other-ocr-session', 'outbox', 'exports']
// uex-*.json caches, jobs files copied aside by the jobs loader
const DATA_PATTERNS = [/^uex-.+\.json$/, /^other-jobs\.corrupt-.+\.json$/]

const lc = (s: string): string => s.toLowerCase()
const KNOWN = new Set([...DATA_FILES, ...DATA_DIRS].map(lc))

/** a name in the data folder root that SuperCargo wrote (half-written "<file>.tmp" saves count too) */
export function isDataEntry(name: string): boolean {
  const n = lc(name)
  if (n === 'settings.json' || n === lc(REPAIR_FOLDER)) return false
  const base = n.endsWith('.tmp') ? n.slice(0, -4) : n
  return KNOWN.has(base) || DATA_PATTERNS.some((re) => re.test(base))
}

/** SuperCargo files and folders in dir's root (names as on disk) */
export function dataEntries(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(isDataEntry)
  } catch {
    return []
  }
}

const DIRS = new Set(DATA_DIRS.map(lc))

/** dir already holds SuperCargo data: a SuperCargo file in its root (folders such as logs/ or exports/ have common names, so they don't count) */
export function holdsData(dir: string): boolean {
  return dataEntries(dir).some((n) => !DIRS.has(lc(n)))
}

// shape tests copied from the loaders (store.ts readJson merges onto defaults; the Other loaders need an object;
// the uex caches and other-uex-places need their list); returns the reason or null
type Shape = (j: unknown) => string | null
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const NOT_OBJ = 'not in the expected layout'
const object: Shape = (j) => (isObj(j) ? null : NOT_OBJ)
/** object; these keys, when present, must be lists (the loader walks them) */
const listsIfPresent =
  (...keys: string[]): Shape =>
  (j) => {
    if (!isObj(j)) return NOT_OBJ
    const bad = keys.find((k) => k in j && !Array.isArray(j[k]))
    return bad ? `"${bad}" is not a list` : null
  }
/** object with this list (the loader ignores the file without it) */
const needsList =
  (key: string): Shape =>
  (j) => {
    if (!isObj(j)) return NOT_OBJ
    return Array.isArray(j[key]) ? null : `no "${key}" list`
  }

const SHAPES: Record<string, Shape> = {
  'manifest.json': listsIfPresent('contracts', 'order'), // store.ts loadManifest
  'history.json': listsIfPresent('entries'), // store.ts loadHistory walks entries
  'window-state.json': object, // store.ts loadWindowState
  'other-jobs.json': object, // other/main/jobs.ts parseDoc: 'not an object'
  'other-matches.json': object, // matchMemory.ts normalizeMemoryDoc
  'other-bodies.json': object, // otherBodies.ts normalizeBodiesDoc
  'other-uex-places.json': needsList('places'), // other/main/uex.ts loadOtherPlaces
  'upload-queue.json': listsIfPresent('items'), // telemetry.ts loadQueue
  'reference-data-status.json': listsIfPresent('files'), // dataSync.ts loadRefDataStatus
  'uex-vehicles.json': needsList('ships'), // main/uex.ts loadCachedRoster
  'uex-locations.json': needsList('locations'),
  'uex-commodities.json': needsList('commodities'),
  'uex-grid-faces.json': needsList('gridFaces'),
  'uex-contract-overrides.json': needsList('contractOverrides')
}

/** reason this file can't be read by its loader, or null when it reads fine */
export function fileProblem(file: string, name: string): string | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return `can't be opened (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`
  }
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return raw.trim() ? 'not valid JSON' : 'empty'
  }
  const shape = SHAPES[lc(name)]
  return shape ? shape(j) : null
}

/** checks every SuperCargo JSON file in dir's root */
export function checkDataFolder(dir: string): DataFolderCheck {
  const names = dataEntries(dir)
  const problems: DataFolderProblem[] = []
  for (const name of names) {
    const n = lc(name)
    if (!n.endsWith('.json')) continue
    const file = path.join(dir, name)
    try {
      if (!fs.statSync(file).isFile()) continue
    } catch {
      continue
    }
    const reason = fileProblem(file, name)
    if (reason) problems.push({ file: name, reason })
  }
  return { folder: dir, hasData: names.length > 0, problems }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "YYYY-MM-DD HH-MM" in local time (no ':' so it works as a Windows folder name) */
export function repairStamp(when: Date): string {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}-${pad(when.getMinutes())}`
}

function moveOne(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch {
    // e.g. another volume or a busy file on Windows: copy, then remove
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

/** moves all SuperCargo files and folders in dir into "<dir>\Moved for Repair\<date>[ (n)]"; returns that folder */
export function moveForRepair(dir: string, when: Date = new Date()): string {
  const parent = path.join(dir, REPAIR_FOLDER)
  const stamp = repairStamp(when)
  let dest = path.join(parent, stamp)
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(parent, `${stamp} (${i})`)
  fs.mkdirSync(dest, { recursive: true })
  const moved: string[] = []
  const failed: string[] = []
  for (const name of dataEntries(dir)) {
    try {
      moveOne(path.join(dir, name), path.join(dest, name))
      moved.push(name)
    } catch (e) {
      failed.push(name)
      logger.error('app', 'move for repair failed', { file: name, error: (e as Error)?.message ?? String(e) })
    }
  }
  logger.info('app', 'data moved for repair', { folder: dest, moved })
  if (failed.length) throw new Error(`couldn't move ${failed.join(', ')} into ${dest}`)
  return dest
}

/** run after app ready, before any window: 'quit' means the caller quits the app */
export async function startupDataCheck(): Promise<'ok' | 'reset' | 'quit'> {
  const dir = dataFolder()
  const check = checkDataFolder(dir)
  if (!check.problems.length) return 'ok'
  logger.warn('app', "data can't be read", { folder: dir, problems: check.problems })
  const list = check.problems.map((p) => `• ${p.file}: ${p.reason}`).join('\n')
  const r = await dialog.showMessageBox({
    type: 'warning',
    title: "SuperCargo data can't be read",
    message: `These SuperCargo files can't be read:\n${list}`,
    detail:
      `Reset moves all SuperCargo files in ${dir} into "${REPAIR_FOLDER}\\<date>" so you can look at them. ` +
      'Your settings are kept. The app then starts with empty data.',
    buttons: ['Reset and continue', 'Quit'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (r.response !== 0) {
    logger.info('app', 'damaged data: quit chosen')
    return 'quit'
  }
  try {
    moveForRepair(dir)
    return 'reset'
  } catch (e) {
    // starting on half-moved damaged data would hide the problem: tell the user and quit
    dialog.showErrorBox("SuperCargo data can't be moved", (e as Error)?.message ?? String(e))
    return 'quit'
  }
}
