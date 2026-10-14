// Updates like Gremlin's updater: one check at start-up (settings.autoCheckUpdates) plus Check for Updates by hand.
// Nothing downloads until the user picks Update Now; Install and Restart installs. The zip copy only links to the
// release page. autoUpdater needs app ready, touch only after whenReady.

import electronUpdater, { type AppUpdater, type UpdateInfo } from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AppSettings, ReleaseNote, UpdateState, UpdatedNotice } from '@shared/types'
import { IPC } from '@shared/channels'
import { releasePageUrl } from '@shared/release'
import { logger } from './logger'
import { fetchNotes, isSkipped, releaseNotesText, updatedNoticeFor } from './releaseNotes'

export interface UpdaterDeps {
  getWindow: () => BrowserWindow | null
  getSettings: () => AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
}

/** SC_TEST_UPDATE_FEED: a JSON file the e2e tests write; no network, states sent on timers. */
interface TestFeed {
  version: string
  notes?: ReleaseNote[] | null
  portable?: boolean
  failCheck?: string
  failDownload?: string
  upToDate?: boolean
}

let deps: UpdaterDeps | null = null
let lastState: UpdateState | null = null
let updatedNotice: UpdatedNotice | null = null
/** what's being offered (version + release info), for Update Now / Try Again */
let offered: { version: string; sizeBytes?: number } | null = null
/** check / download running in electron-updater; its 'error' event maps to error or failed */
let phase: 'idle' | 'check' | 'download' = 'idle'
let byHandCheck = false
/** notes per offered version, fetched once per session */
const notesCache = new Map<string, ReleaseNote[] | null>()

// Installed copies (Setup.exe) have "Uninstall <product>.exe" beside the exe and
// update themselves. The Portable.zip copy has none: it only says a new version is
// out and links to its release page (like Gremlin's portable zip).
export function isPortableCopy(): boolean {
  if (process.platform !== 'win32' || !app.isPackaged) return false
  try {
    const dir = path.dirname(process.execPath)
    return !fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f))
  } catch {
    return false
  }
}

function updater(): AppUpdater {
  return electronUpdater.autoUpdater
}

function testFeedPath(): string | null {
  return process.env.SC_TEST_UPDATE_FEED || null
}

function readTestFeed(): TestFeed | null {
  const p = testFeedPath()
  if (!p) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as TestFeed
  } catch (e) {
    logger.warn('net', 'update test feed unreadable', { error: (e as Error)?.message ?? String(e) })
    return null
  }
}

function send(state: UpdateState): void {
  lastState = state
  const win = deps?.getWindow() ?? null
  if (win && !win.isDestroyed()) win.webContents.send(IPC.evtUpdate, state)
}

function errMessage(err: unknown): string {
  if (err == null) return 'unknown'
  return String((err as Error).message || err)
}

async function notesFor(version: string, fallback: string | null): Promise<ReleaseNote[] | null> {
  if (notesCache.has(version)) return notesCache.get(version) ?? null
  const notes = await fetchNotes(app.getVersion(), version, fallback)
  if (!notes) logger.warn('net', 'update release notes unavailable', { version })
  else logger.info('net', 'update release notes', { version, count: notes.length })
  notesCache.set(version, notes)
  return notes
}

function availableState(
  version: string,
  notes: ReleaseNote[] | null,
  portable: boolean,
  byHand: boolean,
  sizeBytes?: number
): UpdateState {
  const skipped = isSkipped(version, deps?.getSettings().skippedUpdateVersion, byHand)
  if (skipped) logger.info('net', 'update skipped by the user, start-up check stays quiet', { version })
  return {
    kind: 'available',
    version,
    notes,
    url: releasePageUrl(version),
    portable,
    ...(skipped ? { skipped: true } : {}),
    ...(sizeBytes != null ? { sizeBytes } : {})
  }
}

export function initUpdater(d: UpdaterDeps): void {
  if (deps) return
  deps = d

  // Updated notice: once, when this run's version is newer than the last run's
  const current = app.getVersion()
  const last = d.getSettings().lastRunVersion
  updatedNotice = updatedNoticeFor(last, current)
  if (updatedNotice) logger.info('net', 'updated since last run', { from: updatedNotice.from, to: updatedNotice.to })
  if (last !== current) d.updateSettings({ lastRunVersion: current })

  if (testFeedPath()) {
    logger.info('net', 'update test feed in use', { path: testFeedPath() })
    return
  }

  const au = updater()
  const portable = isPortableCopy()
  au.autoDownload = false
  au.autoInstallOnAppQuit = false
  if (portable) logger.info('net', 'update mode portable (notify only)')

  au.on('checking-for-update', () => {
    logger.info('net', 'update check start', { byHand: byHandCheck })
    send({ kind: 'checking' })
  })
  au.on('update-available', (info: UpdateInfo) => {
    const sizeBytes = info.files?.[0]?.size
    offered = { version: info.version, sizeBytes }
    logger.info('net', 'update available', { version: info.version, sizeBytes })
    const byHand = byHandCheck
    // notes first, so the window shows them with the offer
    void notesFor(info.version, releaseNotesText(info.releaseNotes, info.version)).then((notes) =>
      send(availableState(info.version, notes, portable, byHand, sizeBytes))
    )
  })
  au.on('update-not-available', (info: UpdateInfo) => {
    logger.info('net', 'update none', { latest: info.version })
    send({ kind: 'upToDate', version: app.getVersion() })
  })
  au.on('download-progress', (p) => {
    logger.debug('net', 'update download', { percent: Math.round(p.percent) })
    send({
      kind: 'downloading',
      version: offered?.version ?? '',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total
    })
  })
  // electron-updater checks the size and sha512 from latest.yml before it sends this
  au.on('update-downloaded', (info: UpdateInfo) => {
    phase = 'idle'
    logger.info('net', 'update downloaded and checked', { version: info.version })
    send({ kind: 'ready', version: info.version, verified: true })
  })
  au.on('error', (err) => {
    const message = errMessage(err)
    logger.warn('net', 'update error', { phase, error: message })
    failCurrent(message)
  })
}

// one place turns an electron-updater error (event or rejected promise) into a state, once
function failCurrent(message: string): void {
  if (phase === 'download') {
    phase = 'idle'
    send({ kind: 'failed', version: offered?.version ?? '', message })
  } else if (phase === 'check') {
    phase = 'idle'
    send({ kind: 'error', message })
  }
}

const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function testCheck(byHand: boolean): Promise<void> {
  const feed = readTestFeed()
  send({ kind: 'checking' })
  await later(150)
  if (!feed) return send({ kind: 'error', message: 'test feed unreadable' })
  if (feed.failCheck) return send({ kind: 'error', message: feed.failCheck })
  if (feed.upToDate) return send({ kind: 'upToDate', version: app.getVersion() })
  offered = { version: feed.version, sizeBytes: 85_000_000 }
  logger.info('net', 'update available (test)', { version: feed.version, byHand })
  send(availableState(feed.version, feed.notes ?? null, !!feed.portable, byHand, offered.sizeBytes))
}

async function testDownload(): Promise<void> {
  const feed = readTestFeed()
  const version = offered?.version ?? feed?.version ?? ''
  const total = offered?.sizeBytes ?? 85_000_000
  for (const step of [1, 2, 3]) {
    if (step === 3 && feed?.failDownload) {
      logger.warn('net', 'update download failed (test)', { error: feed.failDownload })
      return send({ kind: 'failed', version, message: feed.failDownload })
    }
    await later(150)
    const transferred = Math.round((total * step) / 3)
    send({ kind: 'downloading', version, percent: Math.round((100 * step) / 3), transferred, total })
  }
  logger.info('net', 'update downloaded and checked (test)', { version })
  send({ kind: 'ready', version, verified: true })
}

/** Start-up check (byHand false) or Check for Updates (byHand true). */
export async function checkForUpdates(byHand: boolean): Promise<void> {
  // a download under way or done: show where it is instead of checking again
  if (lastState && (lastState.kind === 'downloading' || lastState.kind === 'ready')) {
    send(lastState)
    return
  }
  if (testFeedPath()) return testCheck(byHand)
  const version = app.getVersion()
  // prerelease builds don't follow the public feed
  if (version.includes('-')) {
    logger.info('net', 'update check skipped (prerelease)', { version })
    send({ kind: 'error', message: `R1 ${version} is a test build; it doesn't check for updates.` })
    return
  }
  if (!app.isPackaged) {
    logger.info('net', 'update check skipped (not packaged)', { version })
    send({ kind: 'error', message: "This copy isn't installed from a release; it doesn't check for updates." })
    return
  }
  if (phase !== 'idle') return
  byHandCheck = byHand
  phase = 'check'
  try {
    await updater().checkForUpdates()
    if (phase === 'check') phase = 'idle'
  } catch (e) {
    logger.warn('net', 'update check failed', { error: errMessage(e) })
    failCurrent(errMessage(e))
  }
}

/** Update Now, and Try Again after a failed download. Installed copy only. */
export async function downloadUpdate(): Promise<void> {
  if (testFeedPath()) {
    if (readTestFeed()?.portable) return
    return testDownload()
  }
  if (isPortableCopy()) {
    logger.info('net', 'update download ignored (portable copy)')
    return
  }
  if (!offered) {
    logger.warn('net', 'update download asked with nothing offered')
    return
  }
  if (phase === 'download') return
  phase = 'download'
  logger.info('net', 'update download start', { version: offered.version })
  send({ kind: 'downloading', version: offered.version, percent: 0, total: offered.sizeBytes })
  try {
    await updater().downloadUpdate()
  } catch (e) {
    logger.warn('net', 'update download failed', { error: errMessage(e) })
    failCurrent(errMessage(e))
  }
}

/** Skip This Version: the start-up check stays quiet about this version from now on. */
export function skipVersion(version: string): void {
  if (typeof version !== 'string' || !version) return
  logger.info('net', 'update version skipped', { version })
  deps?.updateSettings({ skippedUpdateVersion: version })
}

export function lastUpdateState(): UpdateState | null {
  return lastState
}

/** The "Updated — now R1 x" notice: returned once, then null. */
export function takeUpdatedNotice(): UpdatedNotice | null {
  const n = updatedNotice
  updatedNotice = null
  return n
}

export function quitAndInstall(): void {
  if (testFeedPath()) {
    logger.info('net', 'update install (test)')
    return
  }
  if (isPortableCopy()) return
  if (lastState?.kind !== 'ready') {
    logger.warn('net', 'update install asked before a download was ready')
    return
  }
  logger.info('net', 'quit and install')
  updater().quitAndInstall()
}
