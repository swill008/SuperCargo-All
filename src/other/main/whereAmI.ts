/**
 * WHERE AM I (main process): one screenshot of the map screen, two zones read with OCR.
 * Zone 2 (r_DisplayInfo text, upper right) first when otherWhereUseZone2, then zone 1 (map bottom line).
 * Test seam: env SC_WHERE_TEXT_FILE = JSON {"zone1"?: string, "zone2"?: string} replaces capture + OCR.
 * Live position (otherWhereLive): zone 2 only, every otherWhereLiveSec (30-120 s); every result broadcast with why 'live'
 * (the overlay stays quiet until 3 live failures in a row).
 * Hotkeys: pauseOtherHotkeys() unregisters every app global shortcut while the recorder listens.
 */
import * as fs from 'node:fs'
import { BrowserWindow, globalShortcut, ipcMain, type NativeImage } from 'electron'
import { IPC } from '@shared/channels'
import type { AppSettings, CropRect } from '@shared/types'
import {
  type DisplayInfo,
  parseDisplayInfo,
  parseMapLine,
  resolveDisplayInfo,
  resolveMapLine,
  type Where,
  type WhereRunResult
} from '@other/otherWhere'
import { otherSetting, resolveWorkMode } from '../workMode'
import { currentLocationRoster } from './scanLog'
import { captureGameWindow, captureDisplay, cropImage, toUpscaledPng, toPreviewDataUrl } from '../../main/capture'
import { TesseractEngine } from '../../main/ocr/tesseractEngine'
import { logger } from '../../main/logger'
import { trace } from '../../main/trace'

export const WHERE_FAIL_MESSAGE = "couldn't read the map, try again"
export const WHERE_FALLBACK_NOTE = 'Panel unreadable → used map line'

type Why = NonNullable<WhereRunResult['why']>

type Zone = 1 | 2

let engine: TesseractEngine | null = null
let busy = false
const recent: WhereRunResult[] = []
const RECENT_MAX = 10

/** last 10 runs, newest last (diagnostics) */
export function getRecentWhereRuns(): WhereRunResult[] {
  return recent.slice()
}

function remember(r: WhereRunResult): void {
  recent.push(r)
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX)
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function captureScreen(settings: AppSettings): Promise<NativeImage | null> {
  // same source order as upstream capturePreview
  let img = settings.ocrCaptureTarget === 'display' ? null : await captureGameWindow()
  if (!img) img = await captureDisplay(settings.ocrDisplayId)
  return img
}

/** text per zone from the test file, or null when the seam is off */
function seamText(): { zone1?: string; zone2?: string } | null {
  const file = process.env.SC_WHERE_TEXT_FILE
  if (!file) return null
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { zone1?: unknown; zone2?: unknown }
  return {
    zone1: typeof j.zone1 === 'string' ? j.zone1 : undefined,
    zone2: typeof j.zone2 === 'string' ? j.zone2 : undefined
  }
}

async function ocrZone(img: NativeImage, crop: CropRect, zone: Zone): Promise<string> {
  const cropped = cropImage(img, crop)
  // zone 2's debug text is small: upscale more
  const png = toUpscaledPng(cropped, zone === 2 ? 3 : 2)
  engine ??= new TesseractEngine()
  const r = await engine.recognize(png)
  return r.text
}

function readZone(zone: Zone, text: string, at: string, out: { info?: DisplayInfo }): Where | null {
  const locations = currentLocationRoster()
  if (zone === 2) {
    const info = parseDisplayInfo(text)
    if (info) out.info = info
    return info ? resolveDisplayInfo(info, locations, at) : null
  }
  const line = parseMapLine(text)
  return line ? resolveMapLine(line, locations, at) : null
}

function zoneOrder(settings: AppSettings, zones: Zone | 'both' | undefined): Zone[] {
  if (zones === 1 || zones === 2) return [zones]
  return otherSetting(settings, 'otherWhereUseZone2') ? [2, 1] : [1]
}

/** panel parsed by the current run; survives a throw so the result still carries info */
let lastParsed: { info?: DisplayInfo } = {}

async function doRun(settings: AppSettings, zones: Zone | 'both' | undefined): Promise<WhereRunResult> {
  const t0 = Date.now()
  const at = new Date().toISOString()
  const raw: WhereRunResult['raw'] = {}
  const order = zoneOrder(settings, zones)
  const parsed = lastParsed
  const fail = (error: string): WhereRunResult => ({
    ok: false,
    raw,
    error,
    ms: Date.now() - t0,
    ...(parsed.info ? { info: parsed.info } : {})
  })

  let seam: { zone1?: string; zone2?: string } | null
  try {
    seam = seamText()
  } catch (e) {
    logger.warn('other', 'where: test text file unreadable', { error: errText(e) })
    return fail(WHERE_FAIL_MESSAGE)
  }

  let img: NativeImage | null = null
  if (!seam) {
    img = await captureScreen(settings)
    if (!img) {
      logger.warn('other', 'where: capture failed: no source', { target: settings.ocrCaptureTarget })
      return fail(WHERE_FAIL_MESSAGE)
    }
  }

  for (const zone of order) {
    let text: string
    try {
      if (seam) text = (zone === 1 ? seam.zone1 : seam.zone2) ?? ''
      else {
        const crop = otherSetting(settings, zone === 1 ? 'otherWhereZone1' : 'otherWhereZone2')
        text = await ocrZone(img as NativeImage, crop, zone)
      }
    } catch (e) {
      logger.warn('other', 'where: recognize failed', { zone, error: errText(e) })
      continue
    }
    if (zone === 1) raw.zone1 = text
    else raw.zone2 = text
    let where: Where | null = null
    try {
      where = readZone(zone, text, at, parsed)
    } catch (e) {
      logger.warn('other', 'where: parse failed', { zone, error: errText(e) })
    }
    if (where) {
      const r: WhereRunResult = { ok: true, where, zone, raw, ms: Date.now() - t0 }
      if (parsed.info) r.info = parsed.info
      // zone 2 was tried first and gave nothing: say so
      if (zone === 1 && order[0] === 2) r.note = WHERE_FALLBACK_NOTE
      return r
    }
    logger.info('other', 'where: zone gave no position', { zone, chars: text.length })
  }
  return fail(WHERE_FAIL_MESSAGE)
}

function record(r: WhereRunResult, why: Why, seam: boolean): void {
  remember(r)
  logger.info('other', 'where: run done', {
    why,
    ok: r.ok,
    zone: r.zone,
    label: r.where?.label,
    source: r.where?.source,
    ms: r.ms,
    note: r.note,
    seam
  })
  trace({
    area: 'ocr',
    mode: 'other',
    what: r.ok ? 'where read' : 'where failed',
    ms: r.ms,
    data: {
      why,
      zone: r.zone,
      label: r.where?.label,
      name: r.where?.name,
      system: r.where?.system,
      body: r.where?.body,
      source: r.where?.source,
      error: r.error,
      note: r.note,
      accuracy: r.where?.accuracy,
      checks: r.info?.checks,
      tracked: r.info?.trackedMission?.id,
      zone1: r.raw.zone1?.slice(0, 500),
      // whole panel (all fields), not cut
      zone2: r.raw.zone2?.slice(0, 4000)
    }
  })
}

function broadcast(r: WhereRunResult): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.evtOtherWhere, r)
  }
}

let getSettingsRef: (() => AppSettings) | null = null

export interface RunWhereOptions {
  zones?: Zone | 'both'
  /** false = calibrator TEST (result shown there only) */
  broadcast?: boolean
  why?: Why
}

/** one WHERE AM I read; one run at a time (a second call while busy returns an error, not broadcast) */
export async function runWhere(opts: RunWhereOptions = {}): Promise<WhereRunResult> {
  if (busy) {
    logger.info('other', 'where: busy, ignored', { why: opts.why })
    return { ok: false, raw: {}, error: 'busy', ms: 0, why: opts.why }
  }
  if (!getSettingsRef) return { ok: false, raw: {}, error: 'not ready', ms: 0, why: opts.why }
  busy = true
  const why: Why = opts.why ?? 'button'
  let r: WhereRunResult
  lastParsed = {}
  try {
    r = await doRun(getSettingsRef(), opts.zones)
  } catch (e) {
    logger.error('other', 'where: run threw', { error: errText(e) })
    r = { ok: false, raw: {}, error: WHERE_FAIL_MESSAGE, ms: 0 }
    if (lastParsed.info) r.info = lastParsed.info
  } finally {
    busy = false
  }
  r.why = why
  record(r, why, !!process.env.SC_WHERE_TEXT_FILE)
  if (opts.broadcast !== false) broadcast(r)
  return r
}

// ---- live position (O3) ----

export interface WhereLiveStats {
  /** live reads attempted (timer + AFK) */
  reads: number
  ok: number
  failed: number
  /** ticks skipped: busy, hotkeys paused for recording, not in Other mode */
  skipped: number
  /** failures in a row since the last ok read */
  failsInRow: number
  lastAt?: string
  lastOk?: boolean
  /** timer running and its period */
  on: boolean
  everySec?: number
}

const live: WhereLiveStats = { reads: 0, ok: 0, failed: 0, skipped: 0, failsInRow: 0, on: false }
let liveTimer: ReturnType<typeof setTimeout> | null = null
let liveSec = 0

/** diagnostics: live read counts */
export function getWhereLiveStats(): WhereLiveStats {
  return { ...live }
}

export function liveEverySec(settings: AppSettings): number {
  const n = Number(otherSetting(settings, 'otherWhereLiveSec'))
  return Math.min(120, Math.max(30, Number.isFinite(n) ? Math.round(n) : 45))
}

/**
 * One quiet zone 2 read (why 'live'), broadcast ok or failed (renderer decides what to show).
 * Skipped (returns null) while a run is busy or hotkeys are paused for recording.
 * AFK should import this for its once-a-minute read (counts in diagnostics).
 */
export async function runLiveWhere(): Promise<WhereRunResult | null> {
  if (busy || hotkeysPaused) {
    live.skipped++
    return null
  }
  const r = await runWhere({ zones: 2, why: 'live' })
  if (r.error === 'busy' || r.error === 'not ready') {
    live.skipped++
    return null
  }
  live.reads++
  live.lastAt = new Date().toISOString()
  live.lastOk = r.ok
  if (r.ok) {
    live.ok++
    live.failsInRow = 0
  } else {
    live.failed++
    live.failsInRow++
    if (live.failsInRow === 3) logger.info('other', 'where: live reads failing', { failsInRow: live.failsInRow })
  }
  return r
}

function stopLiveTimer(): void {
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = null
  live.on = false
}

function scheduleLive(): void {
  liveTimer = setTimeout(() => {
    liveTimer = null
    const s = getSettingsRef?.()
    if (s && resolveWorkMode(s.workMode) !== 'other') live.skipped++
    else void runLiveWhere()
    if (live.on) scheduleLive()
  }, liveSec * 1000)
}

/** start / restart / stop the live timer from the current settings (call on start and on every settings change) */
export function syncWhereLive(getSettings?: () => AppSettings): void {
  if (getSettings) getSettingsRef = getSettings
  if (!getSettingsRef) return
  const s = getSettingsRef()
  const on = otherSetting(s, 'otherWhereLive') === true
  const sec = liveEverySec(s)
  if (!on) {
    if (live.on) logger.info('other', 'where: live off')
    stopLiveTimer()
    return
  }
  if (live.on && sec === liveSec) return
  stopLiveTimer()
  liveSec = sec
  live.on = true
  live.everySec = sec
  live.failsInRow = 0
  scheduleLive()
  logger.info('other', 'where: live on', { everySec: sec })
}

/** app quit */
export function stopWhereLive(): void {
  stopLiveTimer()
}

// ---- hotkey pause / resume / check (recorder) ----

let hotkeysPaused = false
let reregister: (() => void) | null = null
let whereHotkeyOk: { hotkey: string; ok: boolean; reason?: 'invalid' | 'in-use' } | null = null

/** upstream registerHotkey() (unregisterAll + OCR + WHERE AM I), used by resume */
export function setOtherHotkeyReregister(fn: () => void): void {
  reregister = fn
}

export function otherHotkeysPaused(): boolean {
  return hotkeysPaused
}

/** recorder listening: drop every app global shortcut (upstream OCR + WHERE AM I) */
export function pauseOtherHotkeys(): boolean {
  hotkeysPaused = true
  globalShortcut.unregisterAll()
  logger.info('other', 'hotkeys paused for recording')
  return true
}

export function resumeOtherHotkeys(): boolean {
  const was = hotkeysPaused
  hotkeysPaused = false
  if (reregister) reregister()
  else if (getSettingsRef) registerOtherWhereHotkey(getSettingsRef)
  if (was) logger.info('other', 'hotkeys resumed')
  return true
}

export interface HotkeyCheck {
  ok: boolean
  reason?: 'invalid' | 'in-use'
}

/**
 * Can this accelerator be registered? Already ours = ok. Otherwise try register + unregister
 * (only touches a key we don't hold). Empty = ok (off).
 */
export function checkOtherHotkey(accel: unknown): HotkeyCheck {
  if (typeof accel !== 'string') return { ok: false, reason: 'invalid' }
  const a = accel.trim()
  if (!a) return { ok: true }
  try {
    if (globalShortcut.isRegistered(a)) return { ok: true }
    const ok = globalShortcut.register(a, () => {})
    if (!ok) return { ok: false, reason: 'in-use' }
    globalShortcut.unregister(a)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/** result of the last real WHERE AM I hotkey registration (diagnostics) */
export function getWhereHotkeyStatus(): typeof whereHotkeyOk {
  return whereHotkeyOk ? { ...whereHotkeyOk } : null
}

/** after upstream registerHotkey()'s unregisterAll(); never unregisters anything itself */
export function registerOtherWhereHotkey(getSettings: () => AppSettings): void {
  getSettingsRef = getSettings
  const hotkey = otherSetting(getSettings(), 'otherWhereHotkey')
  if (!hotkey) {
    whereHotkeyOk = null
    return
  }
  // recorder listening: stay off until resume
  if (hotkeysPaused) return
  try {
    const ok = globalShortcut.register(hotkey, () => void runWhere({ why: 'hotkey' }))
    whereHotkeyOk = ok ? { hotkey, ok } : { hotkey, ok, reason: 'in-use' }
    if (!ok) logger.warn('other', 'where: hotkey not registered', { hotkey })
    else logger.info('other', 'where: hotkey registered', { hotkey })
  } catch (e) {
    whereHotkeyOk = { hotkey, ok: false, reason: 'invalid' }
    logger.warn('other', 'where: invalid hotkey', { hotkey, error: errText(e) })
  }
}

let ipcDone = false

export function registerOtherWhereIpc(getSettings: () => AppSettings): void {
  getSettingsRef = getSettings
  if (ipcDone) return
  ipcDone = true
  ipcMain.handle(IPC.otherWhereRun, () => runWhere({ why: 'button' }))
  ipcMain.handle(IPC.otherWhereCalPreview, async () => {
    const img = await captureScreen(getSettings())
    return img ? toPreviewDataUrl(img) : null
  })
  ipcMain.handle(IPC.otherWhereCalTest, (_e, zone: unknown) =>
    runWhere({ zones: zone === 1 ? 1 : 2, broadcast: false, why: 'calibrate' })
  )
  ipcMain.handle(IPC.otherHotkeysPause, () => pauseOtherHotkeys())
  ipcMain.handle(IPC.otherHotkeysResume, () => resumeOtherHotkeys())
  ipcMain.handle(IPC.otherHotkeyCheck, (_e, accel: unknown) => checkOtherHotkey(accel))
}
