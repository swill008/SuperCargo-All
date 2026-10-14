import { app, BrowserWindow, ipcMain, dialog, shell, session, globalShortcut, screen } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { IPC } from '@shared/channels'
import type { AppSettings, DetectedInstalls, ManifestDoc, HistoryDoc, OcrEditTally, OcrResult, OcrWaitState, BoxSizeReport, CrewSnapshot, CrewMember, CrewMirror } from '@shared/types'
import { setDataFolderOverride, dataPath } from './paths'
import { startupDataCheck } from './dataCheck'
import { loadSettings, saveSettings, loadManifest, saveManifest, loadHistory, saveHistory, loadWindowState, saveWindowState } from './store'
import { detectInstalls, orderChannels, channelFromPath } from './installDetect'
import { LogWatcher } from './logWatcher'
import {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  cancelDownload,
  skipVersion,
  lastUpdateState,
  takeUpdatedNotice,
  quitAndInstall
} from './updater'
import { loadCachedRoster, loadCachedLocations, loadCachedCommodities, loadCachedGridFaces, loadCachedContractOverrides, workingTreeData } from './uex'
import { seedCacheIfNeeded, refreshFromRepo, refDataStatus, checkRefDataNow, setRefDataBroadcast } from './dataSync'
import { registerDataFolderIpc } from './dataFolderIpc'
import { scanSessionLog } from './scanLog'
import { randomUUID } from 'node:crypto'
import { listDisplays } from './capture'
import { engineInfo, capturePreview, runOcr, saveSample } from './ocr'
import { prunePending } from './ocr/samples'
import * as contractData from './contractData'
import * as telemetry from './telemetry'
import * as usageStats from './usageStats'
import { registerOther, routeAccepted, registerOtherWhereHotkey, onOtherSettingsChanged } from '@other/main/register'
import { EventEmitter } from 'node:events'
import * as boxReports from './boxReports'
import * as crew from './crew'
import appIcon from '../../resources/icon.png?asset'
import { installCrashHooks, watchWindow } from './crash'
import { logger, write as writeLog, getRecent, logDir, isVerbose, setVerbose, flush as flushLog } from './logger'
import { openDebugWindow, attachDebugHotkey, buildReport, setReportSource } from './debugWindow'
import { LOG_CATEGORIES, LOG_LEVELS, type DebugInfo, type LogEntry, type LogSource } from '@shared/debugLog'
import type { DiagExportOptions, TraceArea, TraceRecord } from '@shared/trace'
import { trace, writeTrace, setTraceEnabled, isTraceOn, startPerfSampler, flushTrace } from './trace'
import { buildDiagnostics, setDiagSource, registerDiagSnapshotReply, registerDiagCopy } from './diagnostics'
import { resolveWorkMode } from '@other/workMode'

// first, so a throw while loading the rest still gets logged
installCrashHooks()

let mainWindow: BrowserWindow | null = null
let compactWindow: BrowserWindow | null = null
let watcher: LogWatcher | null = null
// stable relay: watchers get replaced, Other keeps one subscription + parser
const otherLines = new EventEmitter()
// boot order: settings.json (always in the default folder) first, then the data folder override,
// then everything that reads or writes data files
let settings: AppSettings = loadSettings()
setDataFolderOverride(settings.dataFolder ?? null)

function isExternalUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && url.startsWith(dev)) return false
  return /^https?:\/\//i.test(url)
}

function applyAlwaysOnTop(value: boolean): void {
  if (!mainWindow) return
  mainWindow.setAlwaysOnTop(value, 'screen-saver')
}

function createWindow(): void {
  const ws = loadWindowState()
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    x: ws.x,
    y: ws.y,
    // below ~960 the contracts/history tables crowd and wrap; compact overlay is the skinny one
    minWidth: 960,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    icon: appIcon,
    alwaysOnTop: settings.alwaysOnTop,
    title: 'SuperCargo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (ws.maximized) mainWindow.maximize()
  watchWindow(mainWindow, 'main')
  attachDebugHotkey(mainWindow.webContents)
  logger.info('app', 'window opened', { window: 'main' })

  // restored bounds even while maximized
  const rememberBounds = (): void => {
    if (!mainWindow) return
    const b = mainWindow.getNormalBounds()
    saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWindow.isMaximized() })
  }
  let saveTimer: NodeJS.Timeout | null = null
  const queueSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(rememberBounds, 400)
  }
  mainWindow.on('resize', queueSave)
  mainWindow.on('move', queueSave)
  mainWindow.on('close', rememberBounds)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (settings.alwaysOnTop) applyAlwaysOnTop(true)
  })

  const sendMaxState = (): void => send(IPC.evtWindowState, { maximized: !!mainWindow?.isMaximized() })
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  // else window-all-closed never fires
  mainWindow.on('closed', () => {
    logger.info('app', 'window closed', { window: 'main' })
    if (compactWindow && !compactWindow.isDestroyed()) compactWindow.destroy()
    compactWindow = null
    mainWindow = null
  })

  // off in dev, vite HMR
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, done) => {
      done({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'"
          ]
        }
      })
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const COMPACT_W = 332
const COMPACT_H = 432
let compactHeight = COMPACT_H

function compactHasSavedSize(): boolean {
  return typeof settings.overlayW === 'number' && settings.overlayW > 0
    && typeof settings.overlayH === 'number' && settings.overlayH > 0
}

function persistCompactBounds(): void {
  if (!compactWindow || compactWindow.isDestroyed()) return
  const b = compactWindow.getBounds()
  settings = {
    ...settings,
    overlayX: b.x,
    overlayY: b.y,
    overlayW: b.width,
    overlayH: b.height
  }
  saveSettings(settings)
}

function positionCompact(): void {
  if (!compactWindow) return
  const margin = 10
  const scale = settings.overlayScale || 1
  const savedX = settings.overlayX
  const savedY = settings.overlayY
  const hasSavedPos = typeof savedX === 'number' && typeof savedY === 'number'
  const display = hasSavedPos
    ? screen.getDisplayNearestPoint({ x: savedX, y: savedY })
    : screen.getPrimaryDisplay()
  const { bounds } = display
  const maxW = Math.max(200, bounds.width - margin * 2)
  const maxH = Math.max(120, bounds.height - margin * 2)
  const width = Math.round(
    Math.min(maxW, compactHasSavedSize() ? settings.overlayW! : COMPACT_W * scale)
  )
  const height = Math.round(
    Math.min(maxH, Math.max(120, compactHasSavedSize() ? settings.overlayH! : compactHeight))
  )
  if (hasSavedPos) {
    const x = Math.min(Math.max(bounds.x, savedX), bounds.x + bounds.width - width)
    const y = Math.min(Math.max(bounds.y, savedY), bounds.y + bounds.height - height)
    compactWindow.setBounds({ x, y, width, height })
    return
  }
  const corner = settings.overlayCorner || 'tr'
  const onLeft = corner === 'tl' || corner === 'bl'
  const onTop = corner === 'tl' || corner === 'tr'
  compactWindow.setBounds({
    x: onLeft ? bounds.x + margin : bounds.x + bounds.width - width - margin,
    y: onTop ? bounds.y + margin : bounds.y + bounds.height - height - margin,
    width,
    height
  })
}

// safe to call anytime
function applyOverlay(): void {
  if (!compactWindow || compactWindow.isDestroyed()) return
  compactWindow.setMinimumSize(200, 120)
  compactWindow.setMaximumSize(100000, 100000)
  compactWindow.setIgnoreMouseEvents(!!settings.overlayClickThrough, { forward: true })
  positionCompact()
}

function createCompactWindow(): void {
  compactWindow = new BrowserWindow({
    width: COMPACT_W,
    height: COMPACT_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    minWidth: 200,
    minHeight: 120,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    title: 'SuperCargo · Next Stop',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  compactWindow.setAlwaysOnTop(true, 'screen-saver')
  watchWindow(compactWindow, 'overlay')
  attachDebugHotkey(compactWindow.webContents)
  logger.info('app', 'window opened', { window: 'overlay' })
  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  const onBoundsChanged = (): void => {
    if (!compactWindow || compactWindow.isDestroyed()) return
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => persistCompactBounds(), 200)
  }
  compactWindow.on('moved', onBoundsChanged)
  compactWindow.on('resized', onBoundsChanged)
  compactWindow.on('resize', onBoundsChanged)
  compactWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  compactWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })
  compactWindow.on('closed', () => {
    logger.info('app', 'window closed', { window: 'overlay' })
    compactWindow = null
    broadcast(IPC.evtCompactState, { open: false })
  })
  // compact card via url hash
  if (process.env['ELECTRON_RENDERER_URL']) {
    compactWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#compact`)
  } else {
    compactWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'compact' })
  }
}

function showCompact(): void {
  if (!compactWindow || compactWindow.isDestroyed()) createCompactWindow()
  applyOverlay()
  compactWindow?.showInactive()
  compactWindow?.setAlwaysOnTop(true, 'screen-saver')
  broadcast(IPC.evtCompactState, { open: true })
}

function hideCompact(): void {
  if (compactWindow && !compactWindow.isDestroyed()) compactWindow.hide()
  broadcast(IPC.evtCompactState, { open: false })
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function broadcast(channel: string, payload: unknown, exceptId?: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    if (exceptId !== undefined && w.webContents.id === exceptId) continue
    w.webContents.send(channel, payload)
  }
}

function pushRosters(): void {
  const ships = loadCachedRoster()
  if (ships) send(IPC.evtShips, ships)
  const locations = loadCachedLocations()
  if (locations) send(IPC.evtLocations, locations)
  const commodities = loadCachedCommodities()
  if (commodities) send(IPC.evtCommodities, commodities)
  const gridFaces = loadCachedGridFaces()
  if (gridFaces) send(IPC.evtGridFaces, gridFaces)
}

// watch dir, survives atomic rewrite
let facesWatcher: fs.FSWatcher | null = null
function watchGridFacesDev(): void {
  if (app.isPackaged || facesWatcher) return
  const file = workingTreeData('grid-faces.json')
  if (!file) return
  const name = path.basename(file)
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    facesWatcher = fs.watch(path.dirname(file), (_e, changed) => {
      if (changed && changed !== name) return
      if (timer) clearTimeout(timer)
      // a save fires several events
      timer = setTimeout(() => {
        const faces = loadCachedGridFaces()
        if (faces) {
          send(IPC.evtGridFaces, faces)
          console.info('[dev] grid-faces saved, pushed live')
        }
      }, 150)
    })
    console.info('[dev] watching grid-faces.json for live markup updates')
  } catch (e) {
    console.warn('[dev] grid-faces watch failed:', (e as Error).message)
  }
}

let ocrBusy = false

// is main window actually on the display being captured
function captureDisplayMatches(win: BrowserWindow): boolean {
  const id = settings.ocrDisplayId
  const target = id
    ? screen.getAllDisplays().find((d) => String(d.id) === id) ?? screen.getPrimaryDisplay()
    : screen.getPrimaryDisplay()
  return screen.getDisplayMatching(win.getBounds()).id === target.id
}

// hide own windows for the grab then restore; main only needs it on the captured display
async function withWindowsHidden<T>(fn: () => Promise<T>): Promise<T> {
  const restore: Array<() => void> = []

  if (compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()) {
    compactWindow.hide()
    restore.push(() => {
      if (compactWindow && !compactWindow.isDestroyed()) {
        compactWindow.showInactive()
        compactWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    })
  }

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    captureDisplayMatches(mainWindow)
  ) {
    // if the game had focus (auto-capture), don't yank it back; if the app did, keep it
    const wasFocused = mainWindow.isFocused()
    mainWindow.hide()
    restore.push(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (wasFocused) mainWindow.show()
        else mainWindow.showInactive()
      }
    })
  }

  if (!restore.length) return fn()
  await new Promise((r) => setTimeout(r, 150)) // let the compositor drop the frame
  try {
    return await fn()
  } finally {
    for (const r of restore) r()
  }
}

// remembers the game resolution for the usage snapshot
async function runOcrTracked(): Promise<OcrResult> {
  const result = await runOcr(settings, withWindowsHidden)
  if (result.captureRes && result.captureRes !== settings.ocrGameRes) {
    settings = { ...settings, ocrGameRes: result.captureRes }
    saveSettings(settings)
  }
  return result
}

// pushed back over ipc so the renderer can merge it in
async function runOcrAndPush(targetMissionId?: string): Promise<void> {
  if (ocrBusy) return
  // hotkey mid-wait: screen's up, snap now
  if (!targetMissionId && waitCapture) {
    waitCapture.snapNow()
    return
  }
  ocrBusy = true
  send(IPC.evtOcrStatus, 'recognizing')
  try {
    const result = await runOcrTracked()
    send(IPC.evtOcrResult, { ...result, targetMissionId })
  } catch (e) {
    send(IPC.evtOcrResult, {
      ok: false,
      engine: settings.ocrEngine || 'tesseract',
      ms: 0,
      confidence: 0,
      rawText: '',
      objectives: [],
      error: e instanceof Error ? e.message : String(e),
      targetMissionId
    })
  } finally {
    ocrBusy = false
    send(IPC.evtOcrStatus, 'idle')
  }
}

// shared accept fires before mobiGlas is open
let waitCapture: {
  missionId: string
  timer: ReturnType<typeof setTimeout> | null
  cancelled: boolean
  snapNow: () => void
} | null = null

const WAIT_RETRY_MS = 3000
const WAIT_DEADLINE_MS = 40000 // renderer's capture net gives up at 45s, stay under it

function stopWaitCapture(): void {
  if (!waitCapture) return
  waitCapture.cancelled = true
  if (waitCapture.timer) clearTimeout(waitCapture.timer)
  waitCapture = null
  broadcast(IPC.evtOcrWait, { active: false })
}

function startWaitCapture(missionId: string, info: Omit<OcrWaitState, 'active' | 'missionId'>): void {
  stopWaitCapture()
  const state: NonNullable<typeof waitCapture> = {
    missionId,
    timer: null,
    cancelled: false,
    snapNow: () => {}
  }
  waitCapture = state
  broadcast(IPC.evtOcrWait, { ...info, active: true, missionId })
  send(IPC.evtOcrStatus, 'recognizing')
  const deadline = Date.now() + WAIT_DEADLINE_MS
  const attempt = async (force = false): Promise<void> => {
    if (state.cancelled) return
    if (ocrBusy) {
      state.timer = setTimeout(() => void attempt(force), 1000)
      return
    }
    ocrBusy = true
    let result: OcrResult | null = null
    try {
      result = await runOcrTracked()
    } catch {
      // stays null
    } finally {
      ocrBusy = false
    }
    if (state.cancelled) return
    const onScreen = !!result?.ok && result.objectives.length > 0
    if (onScreen || force || Date.now() >= deadline) {
      stopWaitCapture()
      send(IPC.evtOcrResult, {
        ...(result ?? {
          ok: false,
          engine: settings.ocrEngine || 'tesseract',
          ms: 0,
          confidence: 0,
          rawText: '',
          objectives: [],
          error: 'screen capture failed'
        }),
        targetMissionId: missionId
      })
      send(IPC.evtOcrStatus, 'idle')
      return
    }
    state.timer = setTimeout(() => void attempt(), WAIT_RETRY_MS)
  }
  state.snapNow = () => {
    if (state.timer) clearTimeout(state.timer)
    void attempt(true)
  }
  state.timer = setTimeout(() => void attempt(), WAIT_RETRY_MS)
}

// let contract panel render first
function scheduleAutoCapture(targetMissionId?: string): void {
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, settings.ocrCaptureDelay) * 1000
  setTimeout(() => void runOcrAndPush(targetMissionId), delayMs)
}

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  registerOtherWhereHotkey(() => settings)
  const hotkey = settings.ocrHotkey
  if (!hotkey) return
  try {
    const ok = globalShortcut.register(hotkey, () => void runOcrAndPush())
    if (!ok) console.warn('[ocr] failed to register hotkey:', hotkey)
  } catch (e) {
    console.warn('[ocr] invalid hotkey:', hotkey, e)
  }
}

function startWatcher(): void {
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  const logPath = settings.gameLogPath
  if (!logPath) {
    send(IPC.evtWatcherStatus, {
      connected: false,
      path: null,
      pollIntervalMs: 200,
      channel: settings.gameChannel,
      error: 'No Game.log path configured'
    })
    return
  }

  const channel = channelFromPath(logPath)
  watcher = new LogWatcher(logPath, channel)
  watcher.on('status', (s) => send(IPC.evtWatcherStatus, s))
  watcher.on('line', (l) => otherLines.emit('line', l))
  watcher.on('accepted', (e, isHauling) => {
    const dest = routeAccepted(e, isHauling, settings)
    logger.info('app', 'contract accepted, routed', {
      dest,
      hauling: isHauling,
      mode: resolveWorkMode(settings.workMode),
      mission: e.missionId?.slice(0, 8)
    })
    if (dest === 'other') return
    if (dest === 'haul') send(IPC.evtContractAccepted, contractData.enrichAccepted(e))
    if (!isHauling && settings.contributeTrainingData) {
      scheduleAutoCapture(undefined)
    }
  })
  watcher.on('objective', (e) => send(IPC.evtObjective, e))
  watcher.on('ended', (e) => send(IPC.evtContractEnded, e))
  watcher.on('paid', (e) => send(IPC.evtContractPaid, e))
  watcher.on('share', (e) => send(IPC.evtContractShare, e))
  watcher.start()
}

// install scan is async (it walks every fixed drive); cached briefly and shared while in flight so
// repeated Settings opens don't rescan. Preload's detectInstalls() passes no args, so RE-SCAN can't
// force a fresh scan; the TTL is kept short so a RE-SCAN a few seconds later still rescans.
const INSTALLS_TTL_MS = 60_000
let installsCache: { at: number; installs: DetectedInstalls } | null = null
let installsInFlight: Promise<DetectedInstalls> | null = null

function detectInstallsCached(force = false): Promise<DetectedInstalls> {
  if (!force && installsCache && Date.now() - installsCache.at < INSTALLS_TTL_MS) {
    return Promise.resolve(installsCache.installs)
  }
  if (installsInFlight) return installsInFlight
  const started = Date.now()
  installsInFlight = detectInstalls()
    .catch(() => ({}) as DetectedInstalls)
    .then((installs) => {
      const ms = Date.now() - started
      installsCache = { at: Date.now(), installs }
      trace({ area: 'perf', what: 'install detect', ms, data: { found: Object.keys(installs).length } })
      return installs
    })
    .finally(() => {
      installsInFlight = null
    })
  return installsInFlight
}

// start-up: never blocks the window; applies the result when ready, only if still no path set
function autoDetectLogPath(): void {
  if (settings.gameLogPath) return
  void detectInstallsCached().then((installs) => {
    if (settings.gameLogPath) return // user picked one meanwhile
    const channels = orderChannels(Object.keys(installs))
    if (channels.length === 0) return
    const preferred = channels.find((c) => c === settings.gameChannel) ?? channels[0]
    settings = { ...settings, gameLogPath: installs[preferred], gameChannel: preferred }
    saveSettings(settings)
    broadcast(IPC.evtSettings, settings)
    startWatcher()
    try {
      contractData.rebuild(settings)
    } catch (e) {
      console.warn('[contractData] index build failed:', e)
    }
  })
}

function debugInfo(): DebugInfo {
  return {
    version: app.getVersion(),
    commit: __APP_COMMIT__,
    branch: __APP_BRANCH__,
    electron: process.versions.electron ?? 'unknown',
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    workMode: resolveWorkMode(settings.workMode),
    verbose: isVerbose(),
    logDir: logDir(),
    gameLogPath: settings.gameLogPath || '',
    watcherConnected: !!watcher?.status().connected
  }
}

const WINDOW_SOURCES: LogSource[] = ['main', 'overlay', 'debug']
const MSG_MAX = 2000

// windows are trusted for shape only
function cleanEntry(raw: unknown, senderId: number): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const level = LOG_LEVELS.find((l) => l === r['level'])
  const cat = LOG_CATEGORIES.find((c) => c === r['cat'])
  const src = WINDOW_SOURCES.find((s) => s === r['src'])
  if (!level || !cat || !src || typeof r['msg'] !== 'string') {
    logger.warn('ipc', 'dropped malformed log entry', { sender: senderId })
    return null
  }
  const f = r['fields']
  return {
    t: typeof r['t'] === 'number' && Number.isFinite(r['t']) ? r['t'] : Date.now(),
    level,
    cat,
    src,
    msg: r['msg'].length > MSG_MAX ? `${r['msg'].slice(0, MSG_MAX)}…` : r['msg'],
    fields: f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, unknown>) : undefined
  }
}

const TRACE_AREAS: TraceArea[] = ['parse', 'unknown', 'decide', 'distance', 'ocr', 'perf', 'usage', 'error']
const TRACE_MODES = ['haul', 'other', 'both'] as const
const LINE_MAX = 4000

// windows are trusted for shape only
function cleanTrace(raw: unknown): TraceRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const area = TRACE_AREAS.find((a) => a === r['area'])
  const src = WINDOW_SOURCES.find((s) => s === r['src'])
  if (!area || !src || typeof r['what'] !== 'string') return null
  const d = r['data']
  const rec: TraceRecord = {
    t: typeof r['t'] === 'number' && Number.isFinite(r['t']) ? r['t'] : Date.now(),
    area,
    src,
    what: r['what'].slice(0, MSG_MAX)
  }
  const mode = TRACE_MODES.find((m) => m === r['mode'])
  if (mode) rec.mode = mode
  if (typeof r['line'] === 'string') rec.line = r['line'].slice(0, LINE_MAX)
  if (typeof r['missionId'] === 'string') rec.missionId = r['missionId'].slice(0, 64)
  if (typeof r['ms'] === 'number' && Number.isFinite(r['ms'])) rec.ms = r['ms']
  if (d && typeof d === 'object' && !Array.isArray(d)) rec.data = d as Record<string, unknown>
  return rec
}

// --export-diagnostics <file> | --export-diagnostics=<file>: write the export without a dialog (tests)
function exportDiagnosticsArg(): string | null {
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--export-diagnostics') return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
    if (a.startsWith('--export-diagnostics=')) return a.slice('--export-diagnostics='.length) || null
  }
  return null
}

function scheduleCliDiagnostics(): void {
  const dest = exportDiagnosticsArg()
  if (!dest || !mainWindow) return
  const target = path.resolve(dest)
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void buildDiagnostics({}, target).then((r) => {
        if (r.ok) logger.info('app', 'cli diagnostics written', { path: r.path, bytes: r.bytes })
        else logger.error('app', 'cli diagnostics failed', { error: r.error })
        console.log(`[diagnostics] ${r.ok ? `wrote ${r.path} (${r.bytes} bytes)` : `failed: ${r.error}`}`)
      })
    }, 6000)
  })
}

function registerIpc(): void {
  // Settings → GENERAL → DATA FOLDER; saved through this file's in-memory settings so a later save keeps it
  registerDataFolderIpc({
    getSettings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, ...patch }
      saveSettings(settings)
      broadcast(IPC.evtSettings, settings)
    },
    getMainWindow: () => mainWindow
  })
  ipcMain.on(IPC.traceRecords, (_e, recs: unknown) => {
    if (!Array.isArray(recs) || !isTraceOn()) return
    for (const raw of recs.slice(0, 500)) {
      const rec = cleanTrace(raw)
      if (rec) writeTrace(rec)
    }
  })
  ipcMain.handle(IPC.diagExport, (_e, opts: unknown) => {
    const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {}
    const clean: DiagExportOptions = {}
    if (typeof o['hours'] === 'number' && Number.isFinite(o['hours']) && o['hours'] > 0) clean.hours = o['hours']
    if (o['includeLogExcerpt'] === false) clean.includeLogExcerpt = false
    if (typeof o['note'] === 'string' && o['note'].trim()) clean.note = o['note'].slice(0, 4000)
    if (o['includeImages'] === true) clean.includeImages = true
    return buildDiagnostics({ ...clean, copyToClipboard: true })
  })
  registerDiagSnapshotReply()
  registerDiagCopy()

  ipcMain.handle(IPC.settingsGet, () => settings)

  ipcMain.handle(IPC.settingsSet, (e, patch: Partial<AppSettings>) => {
    const prev = settings
    settings = { ...settings, ...patch }
    saveSettings(settings)
    // keys only, values can hold paths
    const changed = Object.keys(patch).filter(
      (k) => patch[k as keyof AppSettings] !== prev[k as keyof AppSettings]
    )
    if (changed.length) logger.info('app', 'settings changed', { keys: changed.join(',') })
    if (patch.workMode !== undefined && resolveWorkMode(patch.workMode) !== resolveWorkMode(prev.workMode)) {
      logger.info('app', 'work mode switched', {
        from: resolveWorkMode(prev.workMode),
        to: resolveWorkMode(patch.workMode)
      })
    }

    if (patch.alwaysOnTop !== undefined && mainWindow) {
      applyAlwaysOnTop(!!patch.alwaysOnTop)
    }
    if (patch.overlayCorner !== undefined) {
      settings = { ...settings, overlayX: undefined, overlayY: undefined }
      saveSettings(settings)
    }
    if (
      patch.overlayScale !== undefined ||
      patch.overlayCorner !== undefined ||
      patch.overlayClickThrough !== undefined
    ) {
      applyOverlay()
    }
    // every other window (the overlay) gets every change: it reads the work mode and many Other-mode settings,
    // and a hand-kept list of keys missed the work mode (overlay stayed on the Haul card after switching to Other)
    broadcast(IPC.evtSettings, settings, e.sender.id)
    if (
      patch.gameLogPath !== undefined &&
      patch.gameLogPath !== prev.gameLogPath
    ) {
      startWatcher()
    }
    if (
      (patch.ocrHotkey !== undefined && patch.ocrHotkey !== prev.ocrHotkey) ||
      (patch.otherWhereHotkey !== undefined && patch.otherWhereHotkey !== prev.otherWhereHotkey)
    ) {
      registerHotkey()
    }
    if (
      (patch.gameLogPath !== undefined && patch.gameLogPath !== prev.gameLogPath) ||
      (patch.contractsDataPath !== undefined && patch.contractsDataPath !== prev.contractsDataPath)
    ) {
      contractData.rebuild(settings)
    }
    onOtherSettingsChanged(patch)
    return settings
  })

  ipcMain.handle(IPC.detectInstalls, async (_e, opts?: { force?: boolean }) => {
    const installs = await detectInstallsCached(opts?.force === true)
    return { installs, ordered: orderChannels(Object.keys(installs)) }
  })

  ipcMain.handle(IPC.pickLogFile, async () => {
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Game.log',
      properties: ['openFile'],
      filters: [{ name: 'Game log', extensions: ['log'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return picked.filePaths[0]
  })

  ipcMain.handle(IPC.exportRunFile, async (_e, payload: { defaultName: string; json: string }) => {
    if (!mainWindow) return null
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Export run',
      defaultPath: dataPath('exports', path.basename(payload.defaultName)),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return null
    fs.writeFileSync(picked.filePath, payload.json, 'utf8')
    return picked.filePath
  })

  ipcMain.handle(IPC.manifestLoad, () => loadManifest())
  ipcMain.handle(IPC.manifestSave, (e, doc: ManifestDoc) => {
    saveManifest(doc)
    // sync without looping save back
    broadcast(IPC.evtManifestChanged, doc, e.sender.id)
    return true
  })

  const crewHandlers = {
    status: (up: boolean, error?: string) => send(IPC.evtCrewStatus, { up, error }),
    members: (m: CrewMember[]) => send(IPC.evtCrewMembers, m)
  }
  ipcMain.handle(IPC.crewStart, (_e, name: string) => crew.startCrew(name, crewHandlers))
  ipcMain.handle(IPC.crewJoin, (_e, p: { code: string; name: string }) =>
    crew.joinCrew(p.code, p.name, {
      ...crewHandlers,
      snapshot: (snap: CrewSnapshot) => send(IPC.evtCrewSnapshot, snap)
    })
  )
  ipcMain.handle(IPC.crewLeave, () => crew.leaveCrew())
  ipcMain.handle(IPC.crewEnd, () => crew.endCrew())
  ipcMain.handle(IPC.crewPublish, (_e, snap: Omit<CrewSnapshot, 'rev'>) => crew.publish(snap))

  ipcMain.handle(IPC.compactShow, () => showCompact())
  ipcMain.handle(IPC.compactHide, () => hideCompact())
  ipcMain.handle(IPC.compactIsOpen, () =>
    !!(compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible())
  )
  ipcMain.handle(IPC.compactResize, (_e, height: number) => {
    if (compactHasSavedSize()) return
    compactHeight = Math.round(height)
    positionCompact()
  })
  // mirror loading walkthrough to overlay
  ipcMain.on(IPC.crewMirror, (e, m: CrewMirror) => broadcast(IPC.evtCrewMirror, m, e.sender.id))
  ipcMain.on(IPC.crewMirrorAsk, (e) => broadcast(IPC.evtCrewMirrorAsk, null, e.sender.id))
  ipcMain.on(IPC.loadingStateSet, (e, s: { active: boolean; idx: number }) => {
    broadcast(IPC.evtLoadingState, s, e.sender.id)
  })

  ipcMain.handle(IPC.historyLoad, () => loadHistory())
  ipcMain.handle(IPC.historySave, (_e, doc: HistoryDoc) => {
    saveHistory(doc)
    return true
  })

  ipcMain.handle(IPC.uexGetShips, () => loadCachedRoster())
  ipcMain.handle(IPC.uexGetLocations, () => loadCachedLocations())
  ipcMain.handle(IPC.uexGetCommodities, () => loadCachedCommodities())
  ipcMain.handle(IPC.uexGetGridFaces, () => loadCachedGridFaces())

  ipcMain.handle(IPC.scanSession, () => {
    if (!settings.gameLogPath) return { contracts: [], shares: [] }
    const { contracts, shares } = scanSessionLog(settings.gameLogPath)
    return {
      contracts: contracts.map((c) => ({ ...c, accepted: contractData.enrichAccepted(c.accepted) })),
      shares
    }
  })

  ipcMain.handle(IPC.contractDataStatus, () => contractData.status())
  ipcMain.handle(IPC.contractDataRescan, () => contractData.rebuild(settings))

  ipcMain.handle(IPC.dataRefresh, async () => {
    seedCacheIfNeeded()
    const res = await refreshFromRepo()
    contractData.setOverrides(loadCachedContractOverrides())
    pushRosters()
    return res
  })

  ipcMain.handle(IPC.refDataGet, () => refDataStatus())
  ipcMain.handle(IPC.refDataCheck, async () => {
    const s = await checkRefDataNow()
    contractData.setOverrides(loadCachedContractOverrides())
    pushRosters()
    return s
  })

  ipcMain.handle(IPC.telemetryStatus, () => telemetry.status())

  ipcMain.on(IPC.telemetryBoxReport, (_e, r: BoxSizeReport) => {
    boxReports.report(settings, app.getVersion(), r)
  })

  ipcMain.handle(IPC.watcherStatus, () =>
    watcher ? watcher.status() : {
      connected: false,
      path: settings.gameLogPath || null,
      pollIntervalMs: 200,
      channel: settings.gameChannel,
      error: settings.gameLogPath ? undefined : 'No Game.log path configured'
    }
  )
  ipcMain.handle(IPC.watcherRestart, () => {
    startWatcher()
    return true
  })

  ipcMain.handle(IPC.windowControl, (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'maximize')
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    else if (action === 'close') mainWindow.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, () => !!mainWindow?.isMaximized())

  ipcMain.handle(IPC.setAlwaysOnTop, (_e, value: boolean) => {
    settings = { ...settings, alwaysOnTop: value }
    saveSettings(settings)
    applyAlwaysOnTop(value)
    return value
  })

  ipcMain.handle(IPC.ocrListDisplays, () => listDisplays())
  ipcMain.handle(IPC.ocrEngineInfo, () => engineInfo(settings))
  ipcMain.handle(IPC.ocrPreview, () => capturePreview(settings))
  ipcMain.handle(IPC.ocrRun, () => runOcrTracked())
  // only for genuinely-new hauling contracts
  ipcMain.on(IPC.ocrRequestCapture, (_e, missionId: unknown, wait: unknown) => {
    const id = typeof missionId === 'string' ? missionId : undefined
    // recapture cancels the wait
    stopWaitCapture()
    if (id && wait && typeof wait === 'object') {
      startWaitCapture(id, wait as Omit<OcrWaitState, 'active' | 'missionId'>)
    } else {
      scheduleAutoCapture(id)
    }
  })
  ipcMain.handle(
    IPC.ocrSaveSample,
    (_e, payload: { sampleId: string; text: string; fields?: Record<string, unknown> }) =>
      saveSample(settings, payload.sampleId, { text: payload.text, fields: payload.fields })
  )

  ipcMain.on(
    IPC.ocrReportAccuracy,
    (_e, p: { attempted: number; edited: number; byField: OcrEditTally }) => {
      if (!p.attempted) return
      const edits = { ...settings.ocrEdits }
      for (const [k, v] of Object.entries(p.byField)) {
        edits[k as keyof OcrEditTally] = (edits[k as keyof OcrEditTally] ?? 0) + v
      }
      settings = {
        ...settings,
        ocrFieldsTotal: (settings.ocrFieldsTotal ?? 0) + p.attempted,
        ocrFieldsEdited: (settings.ocrFieldsEdited ?? 0) + p.edited,
        ocrEdits: edits
      }
      saveSettings(settings)
    }
  )

  ipcMain.handle(IPC.appVersion, () => app.getVersion())

  ipcMain.on(IPC.debugLog, (e, entries: unknown) => {
    if (!Array.isArray(entries)) return
    for (const raw of entries.slice(0, 500)) {
      const entry = cleanEntry(raw, e.sender.id)
      if (entry) writeLog(entry)
    }
  })
  ipcMain.handle(IPC.debugRecent, () => getRecent())
  ipcMain.handle(IPC.debugInfo, () => debugInfo())
  ipcMain.handle(IPC.debugReport, () => buildReport())
  ipcMain.handle(IPC.debugOpen, () => openDebugWindow())
  ipcMain.handle(IPC.debugOpenFolder, async () => {
    const err = await shell.openPath(logDir())
    if (err) logger.warn('app', 'open log folder failed', { error: err })
  })
  ipcMain.handle(IPC.debugSetVerbose, (_e, on: unknown) => {
    setVerbose(!!on)
    logger.info('app', 'verbose logging', { on: !!on })
  })
  ipcMain.handle(IPC.updaterCheck, async () => {
    await checkForUpdates(true)
    return true
  })
  ipcMain.handle(IPC.updaterDownload, async () => {
    await downloadUpdate()
    return true
  })
  ipcMain.handle(IPC.updaterCancel, () => {
    cancelDownload()
    return true
  })
  ipcMain.handle(IPC.updaterSkip, (_e, version: unknown) => {
    if (typeof version !== 'string') return false
    skipVersion(version)
    return true
  })
  ipcMain.handle(IPC.updaterState, () => lastUpdateState())
  ipcMain.handle(IPC.updaterUpdatedNotice, () => takeUpdatedNotice())
  ipcMain.handle(IPC.updaterQuitAndInstall, () => {
    quitAndInstall()
    return true
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // damaged SuperCargo data: Reset and continue (moved to "Moved for Repair") or Quit, before anything reads it
    const dc = await startupDataCheck()
    if (dc === 'quit') {
      app.quit()
      return
    }
    registerIpc()
    registerOther({ watcher: otherLines, getSettings: () => settings, getMainWindow: () => mainWindow, reregisterHotkeys: registerHotkey })
    autoDetectLogPath()
    setReportSource({ info: debugInfo, settings: () => settings })
    setTraceEnabled(() => settings.traceInterpretation !== false)
    setDiagSource({ info: debugInfo, settings: () => settings, mainWindow: () => mainWindow, overlayWindow: () => compactWindow })
    startPerfSampler()
    {
      const i = debugInfo()
      logger.info('app', 'start', {
        version: i.version,
        commit: i.commit,
        branch: i.branch,
        electron: i.electron,
        os: i.os,
        workMode: i.workMode,
        gameLogPath: i.gameLogPath
      })
    }
    createWindow()
    scheduleCliDiagnostics()
    if (process.argv.includes('--debug-window')) openDebugWindow()
    if (settings.overlayStartWithApp !== false) showCompact()
    startWatcher()
    registerHotkey()
    prunePending()

    // stable id, groups uploads by client
    if (!settings.telemetryClientId) {
      settings = { ...settings, telemetryClientId: randomUUID() }
      saveSettings(settings)
    }
    telemetry.init()
    const ships = usageStats.completedShips(loadHistory().entries)
    void usageStats.maybePing(settings, app.getVersion(), ships).then((sentAt) => {
      if (sentAt) {
        settings = { ...settings, lastUsagePingAt: sentAt }
        saveSettings(settings)
      }
    })
    try {
      const data = contractData.rebuild(settings)
      if (data.active) console.log(`[contractData] ${data.titles} contracts, ${data.blueprintContracts} with blueprints`)
    } catch (e) {
      console.warn('[contractData] index build failed:', e)
    }

    // seed bundled, refresh in background (status saved + sent to the windows after every check)
    setRefDataBroadcast((s) => broadcast(IPC.evtRefData, s))
    seedCacheIfNeeded()
    contractData.setOverrides(loadCachedContractOverrides())
    pushRosters()
    watchGridFacesDev()
    void refreshFromRepo().then((res) => {
      if (res.changed) {
        contractData.setOverrides(loadCachedContractOverrides())
        pushRosters()
      }
    })

    initUpdater({
      getWindow: () => mainWindow,
      getSettings: () => settings,
      updateSettings: (patch) => {
        settings = { ...settings, ...patch }
        saveSettings(settings)
        broadcast(IPC.evtSettings, settings)
      }
    })
    // one check at start-up, like Gremlin (no hourly recheck); checkForUpdates skips unpackaged/prerelease builds
    if (settings.autoCheckUpdates) setTimeout(() => void checkForUpdates(false), 4000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => logger.info('app', 'quit'))
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    flushLog()
    flushTrace()
  })

  app.on('window-all-closed', () => {
    watcher?.stop()
    if (process.platform !== 'darwin') app.quit()
  })
}
