/**
 * WHERE AM I (main process): one screenshot of the map screen, two zones read with OCR.
 * Zone 2 (r_DisplayInfo text, upper right) first when otherWhereUseZone2, then zone 1 (map bottom line).
 * OCR: one own tesseract.js worker reads both zones. Zone 2: ocrPrep.ts output (grey, inverted, scaled for ~30 px text
 * from the frame height), psm 6, Sauvola. Zone 1: 2x upscale, no prep, psm 3, Otsu (the 1.0.1 settings). The full
 * parameter set (ocrPrep.ts zoneParams) is applied whenever the zone changes. If the worker won't load, both zones fall
 * back to a TesseractEngine (3x/2x upscale, psm 3), created only then.
 * Test seam: env SC_WHERE_TEXT_FILE = JSON {"zone1"?: string, "zone2"?: string} replaces capture + OCR.
 * Live position (otherWhereLive): zone 2 only, every otherWhereLiveSec (30-120 s); every result broadcast with why 'live'
 * (the overlay stays quiet until 3 live failures in a row).
 * Hotkeys: pauseOtherHotkeys() unregisters every app global shortcut while the recorder listens.
 */
import * as fs from 'node:fs'
import { BrowserWindow, globalShortcut, ipcMain, nativeImage, screen, type NativeImage } from 'electron'
import { cachePath as appCachePath } from '../../main/paths'
import { IPC } from '@shared/channels'
import type { AppSettings, CropRect } from '@shared/types'
import {
  type DisplayInfo,
  parseDisplayInfo,
  parseMapLine,
  resolveDisplayInfo,
  resolveMapLine,
  type Where,
  type WhereResolve,
  type WhereRunResult
} from '@other/otherWhere'
import { resolveStartText } from '@other/otherResolve'
import { lookupMemory } from '@other/otherMemory'
import type { Location } from '@shared/types'
import { getMemory } from './matchMemory'
import { otherSetting, resolveWorkMode } from '../workMode'
import { currentLocationRoster } from './scanLog'
import { getBodies, onWhereRead } from './bodies'
import { bodyRadiusFromTable } from '../otherBodies'
import { captureGameWindow, captureDisplay, cropImage, toUpscaledPng, toPreviewDataUrl } from '../../main/capture'
import { TesseractEngine } from '../../main/ocr/tesseractEngine'
import { prepForOcr, zoneParams } from './ocrPrep'
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

// ---- diagnostics state (items 3, 5, 6, 15) ----

export interface WhereTimings {
  captureMs?: number
  ocrMs: { zone1?: number; zone2?: number }
  /** parse + resolve, all zones tried */
  parseMs: number
}

export interface WhereHistoryEntry {
  why?: Why
  at: string
  ok: boolean
  zone?: Zone
  ms: number
  timings: WhereTimings
  note?: string
  checks?: unknown
  accuracy?: number
  label?: string
  error?: string
  /** raw OCR text per zone (the export sanitises it) */
  raw: { zone1?: string; zone2?: string }
  seam: boolean
}

interface ZoneBox {
  px: { x: number; y: number; w: number; h: number }
  frac: CropRect
  /** size of the crop actually taken (cropImage falls back to the whole frame when too small) */
  cropSize?: { width: number; height: number }
}

export interface WhereCaptureDiag {
  at: string
  /** 'game window' | 'display <id>' | 'none' */
  target: string
  requested: AppSettings['ocrCaptureTarget']
  displayId?: string
  image?: { width: number; height: number }
  displays: { id: number; label?: string; size: { width: number; height: number }; scaleFactor: number; bounds: Electron.Rectangle; primary: boolean }[]
  zones: { zone1?: ZoneBox; zone2?: ZoneBox }
}

const history: WhereHistoryEntry[] = []
let curTimings: WhereTimings = { ocrMs: {}, parseMs: 0 }
let lastCapture: WhereCaptureDiag | null = null
let curCapture: WhereCaptureDiag | null = null
const lastCrops: { zone1?: Buffer; zone2?: Buffer; zone2Prepped?: Buffer } = {}

function displayList(): WhereCaptureDiag['displays'] {
  try {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || undefined,
      size: { ...d.size },
      scaleFactor: d.scaleFactor,
      bounds: { ...d.bounds },
      primary: d.id === primary
    }))
  } catch {
    return []
  }
}

function zoneBox(img: NativeImage, crop: CropRect, cropped?: NativeImage): ZoneBox {
  const size = img.getSize()
  return {
    // same rounding as cropImage
    px: {
      x: Math.max(0, Math.round(crop.x * size.width)),
      y: Math.max(0, Math.round(crop.y * size.height)),
      w: Math.min(size.width, Math.round(crop.w * size.width)),
      h: Math.min(size.height, Math.round(crop.h * size.height))
    },
    frac: { ...crop },
    ...(cropped ? { cropSize: cropped.getSize() } : {})
  }
}

async function captureScreen(settings: AppSettings): Promise<NativeImage | null> {
  // same source order as upstream capturePreview
  let img = settings.ocrCaptureTarget === 'display' ? null : await captureGameWindow()
  let target = img ? 'game window' : 'none'
  if (!img) {
    img = await captureDisplay(settings.ocrDisplayId)
    if (img) target = `display ${settings.ocrDisplayId || 'primary'}`
  }
  curCapture = {
    at: new Date().toISOString(),
    target,
    requested: settings.ocrCaptureTarget,
    displayId: settings.ocrDisplayId || undefined,
    image: img ? img.getSize() : undefined,
    displays: displayList(),
    zones: {}
  }
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

// ---- own OCR worker (both zones; parameters differ per zone) ----

type TessWorker = {
  recognize: (img: Buffer) => Promise<{ data: { text: string } }>
  setParameters: (p: Record<string, unknown>) => Promise<unknown>
}
type CreateWorker = (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker>

let worker: TessWorker | null = null
let workerLoading: Promise<TessWorker | null> | null = null
let workerFailed = false
/** zone whose full parameter set is on the worker (0 = none / unknown) */
let workerZone: Zone | 0 = 0

async function whereWorker(): Promise<TessWorker | null> {
  if (worker || workerFailed) return worker
  workerLoading ??= (async () => {
    const t0 = Date.now()
    try {
      // same tessdata cache as the shared engine
      const cachePath = appCachePath('tessdata')
      fs.mkdirSync(cachePath, { recursive: true })
      const t = (await import('tesseract.js')) as unknown as { createWorker?: CreateWorker; default?: { createWorker?: CreateWorker } }
      const create = t.createWorker ?? t.default?.createWorker
      if (!create) throw new Error('tesseract.js missing createWorker')
      const w = await create('eng', 1, { cachePath, gzip: true })
      // no parameters here: the first read applies its zone's full set
      worker = w
      logger.info('other', 'where: ocr worker ready', { ms: Date.now() - t0 })
      return w
    } catch (e) {
      workerFailed = true
      logger.warn('other', 'where: own ocr worker failed, using shared engine', { error: errText(e) })
      return null
    } finally {
      workerLoading = null
    }
  })()
  return workerLoading
}

async function ocrZone(img: NativeImage, crop: CropRect, zone: Zone): Promise<string> {
  const cropped = cropImage(img, crop)
  // diagnostics: unscaled crop + its box
  try {
    if (zone === 1) lastCrops.zone1 = cropped.toPNG()
    else lastCrops.zone2 = cropped.toPNG()
    if (curCapture) curCapture.zones[zone === 1 ? 'zone1' : 'zone2'] = zoneBox(img, crop, cropped)
  } catch (e) {
    logger.debug('other', 'where: crop keep failed', { zone, error: errText(e) })
  }
  const w = await whereWorker()
  if (w) {
    let png: Buffer
    if (zone === 2) {
      const size = cropped.getSize()
      const prep = prepForOcr({ data: cropped.toBitmap(), width: size.width, height: size.height }, img.getSize().height)
      png = nativeImage.createFromBitmap(Buffer.from(prep.data.buffer, prep.data.byteOffset, prep.data.byteLength), { width: prep.width, height: prep.height }).toPNG()
      lastCrops.zone2Prepped = png
    } else {
      // zone 1: the 1.0.1 input (2x upscale, no prep)
      png = toUpscaledPng(cropped, 2)
    }
    if (workerZone !== zone) {
      // reset first so a failed call re-applies next time
      workerZone = 0
      const t0 = Date.now()
      await w.setParameters(zoneParams(zone))
      workerZone = zone
      logger.debug('other', 'where: ocr params switch', { zone, ms: Date.now() - t0 })
    }
    return (await w.recognize(png)).data.text ?? ''
  }
  // the worker failed (1.0.1 fallback): a TesseractEngine for both zones; zone 2's debug text is small: upscale more
  const png = toUpscaledPng(cropped, zone === 2 ? 3 : 2)
  engine ??= new TesseractEngine()
  const r = await engine.recognize(png)
  return r.text
}

/** the one resolver over the merged roster with main's match memory (site codes: gameData.ts already loaded them) */
export function whereResolver(locations: Location[]): WhereResolve {
  const memory = getMemory()
  return (text) => resolveStartText(text, { locations, useMarker: false, memory: (key) => lookupMemory(memory, key) })
}

function readZone(zone: Zone, text: string, at: string, out: { info?: DisplayInfo }): Where | null {
  const locations = currentLocationRoster()
  const resolve = whereResolver(locations)
  if (zone === 2) {
    const info = parseDisplayInfo(text)
    if (info) out.info = info
    return info ? resolveDisplayInfo(info, locations, at, { bodyRadius: (n) => bodyRadiusFromTable(getBodies().bodies, n), resolve }) : null
  }
  const line = parseMapLine(text)
  return line ? resolveMapLine(line, locations, at, resolve) : null
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
    const tc = Date.now()
    img = await captureScreen(settings)
    curTimings.captureMs = Date.now() - tc
    if (curCapture) lastCapture = curCapture
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
        const to = Date.now()
        try {
          text = await ocrZone(img as NativeImage, crop, zone)
        } finally {
          curTimings.ocrMs[zone === 1 ? 'zone1' : 'zone2'] = Date.now() - to
        }
      }
    } catch (e) {
      logger.warn('other', 'where: recognize failed', { zone, error: errText(e) })
      continue
    }
    if (zone === 1) raw.zone1 = text
    else raw.zone2 = text
    let where: Where | null = null
    const tp = Date.now()
    try {
      where = readZone(zone, text, at, parsed)
    } catch (e) {
      logger.warn('other', 'where: parse failed', { zone, error: errText(e) })
    }
    curTimings.parseMs += Date.now() - tp
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
  history.push({
    why,
    at: new Date().toISOString(),
    ok: r.ok,
    zone: r.zone,
    ms: r.ms,
    timings: { ...curTimings, ocrMs: { ...curTimings.ocrMs } },
    note: r.note,
    checks: r.info?.checks,
    accuracy: r.where?.accuracy,
    label: r.where?.label,
    error: r.error,
    raw: { ...r.raw },
    seam
  })
  if (history.length > RECENT_MAX) history.splice(0, history.length - RECENT_MAX)
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
      placeKind: r.where?.placeKind,
      locationCode: r.info?.playerLocationCode,
      error: r.error,
      note: r.note,
      accuracy: r.where?.accuracy,
      checks: r.info?.checks,
      // O3: 'computed' = the screen altitude was garbled/missing and |position| − radius was used
      altitude: r.info?.altitudeM,
      altSource: r.info?.altitudeSource,
      altComputed: r.info?.altitudeComputedM,
      tracked: r.info?.trackedMission?.id,
      zone1: r.raw.zone1?.slice(0, 500),
      // whole panel (all fields), not cut
      zone2: r.raw.zone2?.slice(0, 4000),
      timings: curTimings
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
  curTimings = { ocrMs: {}, parseMs: 0 }
  curCapture = null
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
  // planet table: the panel's exact radius for its body
  onWhereRead(r)
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

// ---- diagnostics export (items 3, 5, 6, 9, 10, 15) ----

function hotkeyInfo(value: unknown, last?: unknown): Record<string, unknown> {
  const v = typeof value === 'string' ? value.trim() : ''
  let isRegistered: boolean | string = false
  if (v) {
    try {
      isRegistered = globalShortcut.isRegistered(v)
    } catch (e) {
      isRegistered = `error: ${errText(e)}`
    }
  }
  return { value: v || '(off)', isRegistered, ...(last !== undefined ? { lastRegistration: last } : {}) }
}

export interface WhereDiag {
  history: WhereHistoryEntry[]
  capture: WhereCaptureDiag | null
  live: WhereLiveStats
  hotkeys: Record<string, unknown>
}

/** diagnostics: last 10 reads (raw text kept; the export sanitises), last capture, live stats, hotkey state */
export function getWhereDiag(): WhereDiag {
  const s = getSettingsRef?.()
  return {
    history: history.map((h) => ({ ...h, timings: { ...h.timings, ocrMs: { ...h.timings.ocrMs } }, raw: { ...h.raw } })),
    capture: lastCapture,
    live: getWhereLiveStats(),
    hotkeys: {
      paused: hotkeysPaused,
      // registered by upstream registerHotkey(); its result is only logged there
      ocrHotkey: hotkeyInfo(s?.ocrHotkey, 'not tracked (upstream registerHotkey logs it)'),
      otherWhereHotkey: hotkeyInfo(s ? otherSetting(s, 'otherWhereHotkey') : undefined, getWhereHotkeyStatus())
    }
  }
}

/** diagnostics: last zone 1 / zone 2 crops, unscaled PNG, plus zone 2 as the OCR saw it */
export function getWhereImages(): { name: string; png: Buffer }[] {
  const out: { name: string; png: Buffer }[] = []
  if (lastCrops.zone1) out.push({ name: 'zone1', png: lastCrops.zone1 })
  if (lastCrops.zone2) out.push({ name: 'zone2', png: lastCrops.zone2 })
  if (lastCrops.zone2Prepped) out.push({ name: 'zone2-prepped', png: lastCrops.zone2Prepped })
  return out
}
