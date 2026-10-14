/**
 * StandAlone Other — main-process adapter.
 * Re-tie after an upstream pull:
 *   1. registerOther() in app.whenReady, after the single-instance lock
 *   2. routeAccepted() in the Game.log accepted handler (skip Manifest in Other mode)
 */
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'
import type { AppSettings, ContractAcceptedEvent } from '@shared/types'
import { createOtherLineParser } from '@other/otherLogParse'
import { resolveWorkMode } from '../workMode'
import { registerOtherJobsIpc } from './jobs'
import { registerOtherActionRelay } from './ipc'
import { refreshOtherPlaces } from './uex'
import { wipeOtherOcrSession, hookOtherOcrSessionQuit } from './ocrSession'
import { loadCachedLocations } from '../../main/uex'
import { logger } from '../../main/logger'

/** Anything that emits raw Game.log lines (index.ts relays each LogWatcher's 'line'). */
export interface OtherLineSource {
  on(event: 'line', cb: (line: string) => void): unknown
}

export interface RegisterOtherOptions {
  watcher: OtherLineSource
  getSettings: () => AppSettings
  getMainWindow: () => BrowserWindow | null
}

let started = false

export function registerOther({ watcher, getSettings, getMainWindow }: RegisterOtherOptions): void {
  if (started) return
  started = true
  registerOtherJobsIpc(getSettings)
  registerOtherActionRelay(getMainWindow)
  wipeOtherOcrSession()
  hookOtherOcrSessionQuit()
  void refreshOtherPlaces(loadCachedLocations()?.locations ?? [])

  const parser = createOtherLineParser()
  watcher.on('line', (line) => {
    const ev = parser.feed(line)
    if (!ev) return
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
