// debug window + the copy-paste bug report

import { app, BrowserWindow, screen, shell, type WebContents } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { IPC } from '@shared/channels'
import { formatEntry, type DebugInfo, type LogEntry } from '@shared/debugLog'
import type { AppSettings } from '@shared/types'
import { getProblems, getRecent, logger, onEntry } from './logger'
import { loadManifest } from './store'
import { watchWindow } from './crash'
import appIcon from '../../resources/icon.png?asset'

let debugWindow: BrowserWindow | null = null

// index.ts owns settings + watcher; it hands us getters
let source: { info: () => DebugInfo; settings: () => AppSettings } | null = null
export function setReportSource(s: { info: () => DebugInfo; settings: () => AppSettings }): void {
  source = s
}

const PUSH_MS = 200

export function openDebugWindow(): void {
  if (debugWindow && !debugWindow.isDestroyed()) {
    if (debugWindow.isMinimized()) debugWindow.restore()
    debugWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1000,
    height: 640,
    minWidth: 600,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true, // native frame: a debug tool needs to move, resize and close like any window
    backgroundColor: '#000000',
    icon: appIcon,
    title: 'SuperCargo · Debug',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  debugWindow = win
  watchWindow(win, 'debug')
  attachDebugHotkey(win.webContents)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('ready-to-show', () => win.show())

  // batch live entries so a log burst doesn't flood ipc
  let queue: LogEntry[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const push = (): void => {
    timer = null
    if (!queue.length || win.isDestroyed()) return
    win.webContents.send(IPC.evtDebugEntries, queue)
    queue = []
  }
  const off = onEntry((e) => {
    queue.push(e)
    if (!timer) timer = setTimeout(push, PUSH_MS)
  })
  win.on('closed', () => {
    off()
    if (timer) clearTimeout(timer)
    debugWindow = null
    logger.info('app', 'window closed', { window: 'debug' })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#debug`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'debug' })
  }
  logger.info('app', 'window opened', { window: 'debug' })
}

// Ctrl+Shift+D while an app window has focus; not global so the game keeps its keys
export function attachDebugHotkey(wc: WebContents): void {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control || !input.shift || input.alt || input.meta) return
    if (input.key.toLowerCase() !== 'd') return
    e.preventDefault()
    openDebugWindow()
  })
}

function scrubber(): (s: string) => string {
  let user = ''
  try {
    user = os.userInfo().username
  } catch {
    // ignore
  }
  if (!user) return (s) => s
  const re = new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return (s) => s.replace(re, '%USERNAME%')
}

function scrubDeep(v: unknown, scrub: (s: string) => string): unknown {
  if (typeof v === 'string') return scrub(v)
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, scrub))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, scrub)]))
  }
  return v
}

function haulSummary(): string {
  try {
    const m = loadManifest()
    return `- contracts: ${m.contracts.length}\n- stops: ${m.order.length}\n- load locked: ${m.layout ? 'yes' : 'no'}`
  } catch (e) {
    return `- manifest unreadable: ${(e as Error).message}`
  }
}

interface JobLite {
  ref?: string
  status?: string
  source?: string
  missionId?: string
  title?: string
  steps?: Array<{ done?: boolean }>
}

function otherSummary(): string {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'other-jobs.json'), 'utf8')
    const doc = JSON.parse(raw) as { jobs?: JobLite[]; history?: unknown[] }
    const jobs = Array.isArray(doc.jobs) ? doc.jobs : []
    const lines = [`- jobs: ${jobs.length}, history: ${Array.isArray(doc.history) ? doc.history.length : 0}`]
    for (const j of jobs) {
      const steps = Array.isArray(j.steps) ? j.steps : []
      const done = steps.filter((s) => s?.done).length
      lines.push(
        `- ${j.ref ?? '?'} ${j.status ?? '?'} src=${j.source ?? '?'} steps=${done}/${steps.length} mission=${(j.missionId ?? '').slice(0, 8) || '-'} ${JSON.stringify(j.title ?? '')}`
      )
    }
    return lines.join('\n')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    return err.code === 'ENOENT' ? '- no other-jobs.json' : `- other-jobs.json unreadable: ${err.message}`
  }
}

export function buildReport(): string {
  const scrub = scrubber()
  const info = source?.info()
  const displays = (() => {
    try {
      return screen
        .getAllDisplays()
        .map((d) => `${d.size.width}x${d.size.height}@${d.scaleFactor}`)
        .join(', ')
    } catch {
      return 'unknown'
    }
  })()
  let settingsJson = '{}'
  try {
    const s = { ...(source?.settings() ?? {}) } as Record<string, unknown>
    delete s['telemetryClientId']
    settingsJson = JSON.stringify(scrubDeep(s, scrub), null, 2)
  } catch (e) {
    settingsJson = `settings unreadable: ${(e as Error).message}`
  }
  const recent = getRecent()
  const problems = getProblems()
  const fence = (lines: string[]): string => '```\n' + (lines.length ? scrub(lines.join('\n')) : '(none)') + '\n```'

  return [
    '# SuperCargo debug report',
    '',
    `- version: ${info?.version ?? app.getVersion()}`,
    `- commit: ${info?.commit ?? 'unknown'} (${info?.branch ?? 'unknown'})`,
    `- electron: ${process.versions.electron}`,
    `- os: ${info?.os ?? `${os.platform()} ${os.release()}`}`,
    `- work mode: ${info?.workMode ?? 'unknown'}`,
    `- displays: ${displays}`,
    `- generated: ${new Date().toISOString()}`,
    '',
    '## Settings',
    '```json',
    settingsJson,
    '```',
    '',
    '## Haul',
    haulSummary(),
    '',
    '## Other jobs',
    scrub(otherSummary()),
    '',
    `## Warnings and errors this run (${problems.length})`,
    fence(problems.map(formatEntry)),
    '',
    '## Last 300 lines',
    fence(recent.slice(-300).map(formatEntry)),
    ''
  ].join('\n')
}
