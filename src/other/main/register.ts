/**
 * StandAlone Other — main-process adapter.
 * Re-tie after an upstream pull:
 *   1. registerOther() in app.whenReady, after the single-instance lock
 *   2. routeAccepted() in the Game.log accepted handler (skip Manifest in Other mode)
 *   3. registerOtherWhereHotkey(getSettings) at the end of registerHotkey() (after its unregisterAll),
 *      and registerHotkey() again when patch.otherWhereHotkey changes
 *   4. registerOther({ ..., reregisterHotkeys: registerHotkey }) so the hotkey recorder's resume re-runs it
 *   5. onOtherSettingsChanged(patch) at the end of the settingsSet handler (live position timer)
 */
import { app, type BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'
import type { AppSettings, ContractAcceptedEvent } from '@shared/types'
import { resolveWorkMode } from '../workMode'
import { registerOtherJobsIpc } from './jobs'
import { registerOtherActionRelay } from './ipc'
import { refreshOtherPlaces } from './uex'
import type { OtherLogEvent } from '@other/otherEvents'
import { createTracedOtherParser, createLocationEmitter, currentLocationRoster, lineTime } from './scanLog'
import { wipeOtherOcrSession, hookOtherOcrSessionQuit } from './ocrSession'
import {
  getWhereDiag,
  getWhereImages,
  registerOtherWhereIpc,
  registerOtherWhereHotkey as registerWhereHotkey,
  setOtherHotkeyReregister,
  stopWhereLive,
  syncWhereLive
} from './whereAmI'
import { disposeReader, setReaderTimeLimit } from './ocrReader'
import { getAfkDiag, registerOtherAfkIpc, stopOtherAfk } from './afk'
import { getBodiesDiag, registerOtherBodiesIpc } from './bodies'
import { flushMemory, getMemoryDiag, registerOtherMemoryIpc } from './matchMemory'
import { getGameDataStatus, registerOtherGameDataIpc } from './gameData'
import { loadCachedLocations } from '../../main/uex'
import { logger } from '../../main/logger'
import { setOtherDiagSource } from '../../main/diagnostics'

/** Anything that emits raw Game.log lines (index.ts relays each LogWatcher's 'line'). */
export interface OtherLineSource {
  on(event: 'line', cb: (line: string) => void): unknown
}

export interface RegisterOtherOptions {
  watcher: OtherLineSource
  getSettings: () => AppSettings
  getMainWindow: () => BrowserWindow | null
  /** upstream registerHotkey(): unregisterAll + OCR + WHERE AM I (hotkey recorder resume) */
  reregisterHotkeys?: () => void
}

let started = false

export function registerOther({ watcher, getSettings, getMainWindow, reregisterHotkeys }: RegisterOtherOptions): void {
  if (started) return
  started = true
  registerOtherJobsIpc(getSettings)
  registerOtherActionRelay(getMainWindow)
  // shared OCR reader (batch 15): time limit read per job from settings
  setReaderTimeLimit(() => getSettings().ocrTimeLimitSec)
  registerOtherWhereIpc(getSettings)
  if (reregisterHotkeys) setOtherHotkeyReregister(reregisterHotkeys)
  syncWhereLive(getSettings)
  registerOtherAfkIpc(getSettings)
  registerOtherBodiesIpc()
  registerOtherMemoryIpc()
  registerOtherGameDataIpc()
  // diagnostics export: each key becomes a '## <KEY>' section (sanitised there); zone crops only when images are opted in
  setOtherDiagSource({
    sections: () => {
      const w = getWhereDiag()
      return {
        'WHERE AM I HISTORY': w.history,
        CAPTURE: w.capture ?? { note: 'no screen capture yet this run (no WHERE AM I read from the screen; test-seam reads capture nothing)' },
        LIVE: w.live,
        HOTKEYS: w.hotkeys,
        'AFK LOG': getAfkDiag(),
        BODIES: getBodiesDiag(),
        'MATCH MEMORY': getMemoryDiag(),
        'GAME DATA': getGameDataStatus()
      }
    },
    images: () => getWhereImages()
  })
  app.on('will-quit', () => {
    stopWhereLive()
    stopOtherAfk()
    flushMemory()
    // close the shared OCR reader's worker (batch 15 answer 4)
    void disposeReader()
  })
  wipeOtherOcrSession()
  hookOtherOcrSessionQuit()
  void refreshOtherPlaces(loadCachedLocations()?.locations ?? [])

  const parser = createTracedOtherParser()
  const locate = createLocationEmitter(currentLocationRoster)
  const send = (ev: OtherLogEvent): void => {
    const mode = resolveWorkMode(getSettings().workMode)
    const id = 'missionId' in ev && ev.missionId ? ev.missionId.slice(0, 8) : undefined
    // rule 1: forward in both modes; the reducer ignores 'accepted' in Haul mode, so endings,
    // quits and objectives still reach jobs created in Other mode
    if (mode !== 'other') logger.debug('other', 'log event in haul mode: forwarded, accepted ignored by reducer (rule 1)', { kind: ev.kind, id })
    // main window only applies log events (rule 8); overlay follows via jobsChanged
    const w = getMainWindow()
    if (!w || w.isDestroyed()) {
      logger.warn('other', 'log event dropped: no main window', { kind: ev.kind, id, at: ev.at })
      return
    }
    w.webContents.send(IPC.evtOtherLogEvent, ev)
    logger.info('other', 'log event sent to main window', { kind: ev.kind, id, at: ev.at })
  }
  watcher.on('line', (line) => {
    const ev = parser.feed(line)
    if (ev) send(ev)
    const loc = locate(line, () => lineTime(line))
    if (loc) send(loc)
  })
  logger.info('other', 'registered', { workMode: resolveWorkMode(getSettings().workMode) })
}

/** Only tells index.ts whether to skip the haul Manifest; sends nothing to Other. */
export function routeAccepted(
  e: ContractAcceptedEvent,
  isHauling: boolean,
  settings: AppSettings
): 'other' | 'haul' | 'none' {
  const mode = resolveWorkMode(settings.workMode)
  const route = mode === 'other' ? 'other' : isHauling ? 'haul' : 'none'
  logger.info('other', 'route accepted', { id: e.missionId.slice(0, 8), isHauling, workMode: mode, route })
  return route
}

/** WHERE AM I hotkey; call after upstream registerHotkey()'s globalShortcut.unregisterAll() */
export function registerOtherWhereHotkey(getSettings: () => AppSettings): void {
  registerWhereHotkey(getSettings)
}

/** settingsSet re-tie: restarts / stops the live position timer when its settings change */
export function onOtherSettingsChanged(patch: Partial<AppSettings>): void {
  if (patch.otherWhereLive !== undefined || patch.otherWhereLiveSec !== undefined) syncWhereLive()
}
