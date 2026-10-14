/**
 * WHERE AM I (main process): one screenshot of the map screen, two zones read with OCR.
 * Zone 2 (r_DisplayInfo text, upper right) first when otherWhereUseZone2, then zone 1 (map bottom line).
 * Test seam: env SC_WHERE_TEXT_FILE = JSON {"zone1"?: string, "zone2"?: string} replaces capture + OCR.
 */
import * as fs from 'node:fs'
import { BrowserWindow, globalShortcut, ipcMain, type NativeImage } from 'electron'
import { IPC } from '@shared/channels'
import type { AppSettings, CropRect } from '@shared/types'
import {
  parseDisplayInfo,
  parseMapLine,
  resolveDisplayInfo,
  resolveMapLine,
  type Where,
  type WhereRunResult
} from '@other/otherWhere'
import { otherSetting } from '../workMode'
import { currentLocationRoster } from './scanLog'
import { captureGameWindow, captureDisplay, cropImage, toUpscaledPng, toPreviewDataUrl } from '../../main/capture'
import { TesseractEngine } from '../../main/ocr/tesseractEngine'
import { logger } from '../../main/logger'
import { trace } from '../../main/trace'

export const WHERE_FAIL_MESSAGE = "couldn't read the map, try again"

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

function readZone(zone: Zone, text: string, at: string): Where | null {
  const locations = currentLocationRoster()
  if (zone === 2) {
    const info = parseDisplayInfo(text)
    return info ? resolveDisplayInfo(info, locations, at) : null
  }
  const line = parseMapLine(text)
  return line ? resolveMapLine(line, locations, at) : null
}

function zoneOrder(settings: AppSettings, zones: Zone | 'both' | undefined): Zone[] {
  if (zones === 1 || zones === 2) return [zones]
  return otherSetting(settings, 'otherWhereUseZone2') ? [2, 1] : [1]
}

async function doRun(settings: AppSettings, zones: Zone | 'both' | undefined): Promise<WhereRunResult> {
  const t0 = Date.now()
  const at = new Date().toISOString()
  const raw: WhereRunResult['raw'] = {}
  const order = zoneOrder(settings, zones)
  const fail = (error: string): WhereRunResult => ({ ok: false, raw, error, ms: Date.now() - t0 })

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
      where = readZone(zone, text, at)
    } catch (e) {
      logger.warn('other', 'where: parse failed', { zone, error: errText(e) })
    }
    if (where) return { ok: true, where, zone, raw, ms: Date.now() - t0 }
    logger.info('other', 'where: zone gave no position', { zone, chars: text.length })
  }
  return fail(WHERE_FAIL_MESSAGE)
}

function record(r: WhereRunResult, why: string, seam: boolean): void {
  remember(r)
  logger.info('other', 'where: run done', {
    why,
    ok: r.ok,
    zone: r.zone,
    label: r.where?.label,
    source: r.where?.source,
    ms: r.ms,
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
      zone1: r.raw.zone1?.slice(0, 500),
      zone2: r.raw.zone2?.slice(0, 500)
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
  /** calibrator TEST: show the result there only */
  broadcast?: boolean
  why?: string
}

/** one WHERE AM I read; one run at a time (a second call while busy returns an error, not broadcast) */
export async function runWhere(opts: RunWhereOptions = {}): Promise<WhereRunResult> {
  if (busy) {
    logger.info('other', 'where: busy, ignored', { why: opts.why })
    return { ok: false, raw: {}, error: 'busy', ms: 0 }
  }
  if (!getSettingsRef) return { ok: false, raw: {}, error: 'not ready', ms: 0 }
  busy = true
  const why = opts.why ?? 'run'
  let r: WhereRunResult
  try {
    r = await doRun(getSettingsRef(), opts.zones)
  } catch (e) {
    logger.error('other', 'where: run threw', { error: errText(e) })
    r = { ok: false, raw: {}, error: WHERE_FAIL_MESSAGE, ms: 0 }
  } finally {
    busy = false
  }
  record(r, why, !!process.env.SC_WHERE_TEXT_FILE)
  if (opts.broadcast !== false) broadcast(r)
  return r
}

/** after upstream registerHotkey()'s unregisterAll(); never unregisters anything itself */
export function registerOtherWhereHotkey(getSettings: () => AppSettings): void {
  getSettingsRef = getSettings
  const hotkey = otherSetting(getSettings(), 'otherWhereHotkey')
  if (!hotkey) return
  try {
    const ok = globalShortcut.register(hotkey, () => void runWhere({ why: 'hotkey' }))
    if (!ok) logger.warn('other', 'where: hotkey not registered', { hotkey })
    else logger.info('other', 'where: hotkey registered', { hotkey })
  } catch (e) {
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
}
