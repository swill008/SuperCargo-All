// Where SuperCargo keeps its files.
// Data folder: %USERPROFILE%\SuperCargo-OtherModes by default, movable via settings.dataFolder (a picked folder is used as is).
// settings.json always lives in the default folder so the override can be found.
// Big re-downloadable caches (tessdata, ocr-model) stay in Electron's userData.
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

export const DATA_FOLDER_NAME = 'SuperCargo-OtherModes'

let override: string | null = null
let cached: string | null = null
let fallbackReason: string | undefined

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function defaultDataFolder(): string {
  return path.join(os.homedir(), DATA_FOLDER_NAME)
}

/** same folder (case-insensitive on Windows) */
export function samePath(a: string, b: string): boolean {
  const n = (p: string): string => {
    const r = path.resolve(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return n(a) === n(b)
}

/** why files can't be written in dir (probe file: W_OK alone misses folder permissions on Windows); create: make it if missing */
export function writableReason(dir: string, create: boolean): string | undefined {
  try {
    if (create) ensureDir(dir)
    else if (!fs.statSync(dir).isDirectory()) return 'not a folder'
    const probe = path.join(dir, `.supercargo-write-test-${process.pid}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return undefined
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (!create && code === 'ENOENT') return 'folder not found'
    return code ?? ((e as Error).message || String(e))
  }
}

export function dataFolder(): string {
  if (cached) return cached
  const def = defaultDataFolder()
  fallbackReason = undefined
  if (override && !samePath(override, def)) {
    // the chosen folder must already exist: a missing one (drive unplugged, folder deleted) is never recreated empty
    const why = writableReason(override, false)
    if (!why) {
      cached = override
      return cached
    }
    fallbackReason = `${override} could not be used (${why}); using the default folder`
  }
  try {
    ensureDir(def)
  } catch {
    // reported by the callers that write
  }
  cached = def
  return cached
}

export function dataPath(...parts: string[]): string {
  const p = path.join(dataFolder(), ...parts)
  try {
    ensureDir(path.dirname(p))
  } catch {
    // write will report it
  }
  return p
}

export function settingsFile(): string {
  const def = defaultDataFolder()
  try {
    ensureDir(def)
  } catch {
    // write will report it
  }
  return path.join(def, 'settings.json')
}

export function cachePath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

export function setDataFolderOverride(p: string | null): void {
  override = p && p.trim() ? p.trim() : null
  cached = null
}

export function dataFolderStatus(): { folder: string; isDefault: boolean; fallback?: string } {
  const folder = dataFolder()
  const isDefault = samePath(folder, defaultDataFolder())
  return fallbackReason ? { folder, isDefault, fallback: fallbackReason } : { folder, isDefault }
}
