// Settings > GENERAL > DATA FOLDER: show, change, reset and open the user data folder.
// The picked folder is used as is. A folder without SuperCargo data gets the current data copied in (never
// overwriting a file); one with data that reads fine is used as is; one with damaged data is not saved: the user
// picks Reset and continue (repairTo: move its SuperCargo files to "Moved for Repair\<date>", then copy) or Cancel.
// settings.dataFolder is saved and takes effect after a restart.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { IPC } from '@shared/channels'
import type { AppSettings, DataFolderChangeResult, DataFolderInfo } from '@shared/types'
import { dataFolder, dataFolderStatus, defaultDataFolder, samePath, writableReason } from './paths'
import { checkDataFolder, holdsData, isDataEntry, moveForRepair } from './dataCheck'
import { logger } from './logger'

export interface DataFolderDeps {
  getSettings: () => AppSettings
  /** merge, save settings.json and tell the windows */
  updateSettings: (patch: Partial<AppSettings>) => void
  getMainWindow: () => BrowserWindow | null
}

let pending: string | undefined
// the folder switchTo last found damaged: the only one repairTo will touch
let repairCandidate: string | undefined

const same = samePath

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function info(): DataFolderInfo {
  const st = dataFolderStatus()
  const out: DataFolderInfo = { folder: st.folder, isDefault: st.isDefault, defaultFolder: defaultDataFolder() }
  if (st.fallback) out.fallback = st.fallback
  if (pending !== undefined && !same(pending, st.folder)) out.pending = pending
  return out
}

function checkWritable(dir: string): string | null {
  const why = writableReason(dir, true)
  return why ? `can't write to that folder (${why})` : null
}

/** copy src's SuperCargo files and folders into dst without overwriting anything (never settings.json or
 * "Moved for Repair"; other files in a folder used as is stay put); returns files copied */
export function copyMissing(src: string, dst: string, top = true): number {
  let n = 0
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && !isDataEntry(ent.name)) continue
    const from = path.join(src, ent.name)
    const to = path.join(dst, ent.name)
    if (ent.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      n += copyMissing(from, to, false)
    } else if (ent.isFile() && !fs.existsSync(to)) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
      n++
    }
  }
  return n
}

/** why target can't become the data folder, or null */
function targetError(target: string, current: string): string | null {
  const err = checkWritable(target)
  if (err) return err
  if (!same(target, current) && isInside(target, current)) return "can't use a folder inside the current data folder"
  return null
}

function remember(target: string, deps: DataFolderDeps): void {
  deps.updateSettings({ dataFolder: same(target, defaultDataFolder()) ? undefined : path.resolve(target) })
  pending = path.resolve(target)
}

/** move this install's data to `target` (copy if it has none) and remember it for the next start */
export function switchTo(target: string, deps: DataFolderDeps): DataFolderChangeResult {
  const current = dataFolder()
  const toDefault = same(target, defaultDataFolder())
  const err = targetError(target, current)
  if (err) return { ok: false, error: err, info: info() }
  repairCandidate = undefined
  let copied = 0
  let usedExisting = false
  if (!same(target, current)) {
    if (holdsData(target)) {
      const check = checkDataFolder(target)
      if (check.problems.length) {
        repairCandidate = path.resolve(target)
        logger.warn('app', "data folder change: chosen folder has data that can't be read", { problems: check.problems })
        return { ok: false, needsRepair: check, info: info() }
      }
      usedExisting = true
    } else {
      try {
        copied = copyMissing(current, target)
      } catch (e) {
        logger.error('app', 'data folder copy failed', { error: String(e) })
        return { ok: false, error: `copy failed: ${String(e)}`, info: info() }
      }
    }
  }
  remember(target, deps)
  logger.info('app', 'data folder changed', { toDefault, copied, usedExisting })
  return { ok: true, copied, usedExisting, info: info() }
}

/** Reset and continue for a folder switchTo found damaged: move its SuperCargo files aside, copy the current data in */
export function repairTo(target: string, deps: DataFolderDeps, when: Date = new Date()): DataFolderChangeResult {
  const current = dataFolder()
  if (!repairCandidate || !same(target, repairCandidate) || same(target, current)) {
    return { ok: false, error: 'that folder was not offered for repair', info: info() }
  }
  const err = targetError(target, current)
  if (err) return { ok: false, error: err, info: info() }
  let movedTo: string
  try {
    movedTo = moveForRepair(target, when)
  } catch (e) {
    logger.error('app', 'data folder repair: move failed', { error: String(e) })
    return { ok: false, error: `couldn't move the old files: ${(e as Error)?.message ?? String(e)}`, info: info() }
  }
  repairCandidate = undefined
  let copied = 0
  try {
    copied = copyMissing(current, target)
  } catch (e) {
    logger.error('app', 'data folder copy failed', { error: String(e) })
    return { ok: false, error: `copy failed: ${String(e)}`, movedTo, info: info() }
  }
  remember(target, deps)
  logger.info('app', 'data folder changed after repair', { copied, movedTo })
  return { ok: true, copied, movedTo, info: info() }
}

export function registerDataFolderIpc(deps: DataFolderDeps): void {
  ipcMain.handle(IPC.dataFolderGet, () => info())
  ipcMain.handle(IPC.dataFolderChoose, async (): Promise<DataFolderChangeResult> => {
    const win = deps.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose the SuperCargo data folder',
      defaultPath: dataFolder(),
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, info: info() }
    return switchTo(path.resolve(r.filePaths[0]), deps)
  })
  ipcMain.handle(IPC.dataFolderReset, () => switchTo(defaultDataFolder(), deps))
  ipcMain.handle(IPC.dataFolderRepair, (_e, target: unknown) =>
    typeof target === 'string' && target
      ? repairTo(target, deps)
      : { ok: false, error: 'no folder given', info: info() }
  )
  ipcMain.handle(IPC.dataFolderOpen, async () => {
    const err = await shell.openPath(dataFolder())
    if (err) logger.warn('app', 'open data folder failed', { error: err })
  })
  ipcMain.handle(IPC.dataFolderRestart, () => {
    logger.info('app', 'restart for data folder')
    app.relaunch()
    app.quit()
  })
}
