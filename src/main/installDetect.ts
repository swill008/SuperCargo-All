// auto-detect SC installs, windows only

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import type { DetectedInstalls } from '@shared/types'

// all async: Settings calls this on mount, and a sync scan froze main (and the overlay) for seconds
const fsp = fs.promises

const SCAN_MAX_DEPTH = 4
const SCAN_CONCURRENCY = 8
const PS_TIMEOUT_MS = 8000

const SKIP_DIRS = new Set(
  [
    'Windows',
    'Windows.old',
    'WinSxS',
    '$Recycle.Bin',
    '$WinREAgent',
    '$SysReset',
    '$GetCurrent',
    'System Volume Information',
    'Config.Msi',
    'Recovery',
    'Boot',
    'ProgramData',
    'AppData',
    'PerfLogs',
    'OneDriveTemp',
    'node_modules',
    '.git',
    '.svn',
    '.hg'
  ].map((s) => s.toLowerCase())
)

const SC_ROOT_NAMES = new Set(['starcitizen', 'star citizen'])
const KNOWN_CHANNELS = new Set(['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW'])
const CHANNEL_ORDER = ['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW']

const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function readDirs(p: string): Promise<fs.Dirent[] | null> {
  try {
    return await fsp.readdir(p, { withFileTypes: true })
  } catch {
    return null
  }
}

async function isChannelDir(p: string): Promise<boolean> {
  const name = path.basename(p).toUpperCase()
  if (KNOWN_CHANNELS.has(name)) return true
  return exists(path.join(p, 'build_manifest.id'))
}

async function looksLikeScRoot(p: string): Promise<boolean> {
  const entries = await readDirs(p)
  if (!entries) return false
  for (const child of entries) {
    if (child.isDirectory() && (await isChannelDir(path.join(p, child.name)))) return true
  }
  return false
}

// BFS level by level so result order matches the old sync queue; dirs within a level read
// SCAN_CONCURRENCY at a time, yielding to the event loop between batches
async function findScRoots(driveRoot: string): Promise<string[]> {
  const roots: string[] = []
  let level: string[] = [driveRoot]
  for (let depth = 0; level.length && depth < SCAN_MAX_DEPTH; depth++) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += SCAN_CONCURRENCY) {
      const batch = level.slice(i, i + SCAN_CONCURRENCY)
      const listed = await Promise.all(batch.map((d) => readDirs(d)))
      for (let b = 0; b < batch.length; b++) {
        const entries = listed[b]
        if (!entries) continue
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const nameLower = entry.name.toLowerCase()
          if (SKIP_DIRS.has(nameLower)) continue
          const full = path.join(batch[b], entry.name)
          if (SC_ROOT_NAMES.has(nameLower) && (await looksLikeScRoot(full))) {
            roots.push(full)
            continue // don't descend into install
          }
          if (depth + 1 < SCAN_MAX_DEPTH) next.push(full)
        }
      }
      await yieldLoop()
    }
    level = next
  }
  return roots
}

function runPowershell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', command],
      { encoding: 'utf8', timeout: PS_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

async function fixedDrives(): Promise<string[]> {
  try {
    const out = await runPowershell(
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID'
    )
    const drives = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z]:$/.test(s))
      .map((s) => s.toUpperCase() + '\\')
    if (drives.length) return drives
  } catch {
    /* fall through to brute-force */
  }
  // fallback: probe a..z
  const letters: string[] = []
  for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    letters.push(String.fromCharCode(c) + ':\\')
  }
  const ok = await Promise.all(letters.map((root) => exists(root)))
  return letters.filter((_, i) => ok[i])
}

/** channel -> Game.log path */
export async function detectInstalls(): Promise<DetectedInstalls> {
  if (process.platform !== 'win32') return {}
  const found: DetectedInstalls = {}
  for (const drive of await fixedDrives()) {
    for (const scRoot of await findScRoots(drive)) {
      const children = await readDirs(scRoot)
      if (!children) continue
      for (const child of children) {
        if (!child.isDirectory()) continue
        const channelDir = path.join(scRoot, child.name)
        if (!(await isChannelDir(channelDir))) continue
        const channel = child.name.toUpperCase()
        if (found[channel]) continue // first hit wins
        found[channel] = path.join(channelDir, 'Game.log')
      }
    }
  }
  return found
}

/** known channels first, rest alphabetical */
export function orderChannels(channels: string[]): string[] {
  const known = CHANNEL_ORDER.filter((c) => channels.includes(c))
  const rest = channels.filter((c) => !CHANNEL_ORDER.includes(c)).sort()
  return [...known, ...rest]
}

export function channelFromPath(logPath: string): string {
  const parent = path.basename(path.dirname(logPath))
  return parent ? parent.toUpperCase() : 'UNKNOWN'
}
