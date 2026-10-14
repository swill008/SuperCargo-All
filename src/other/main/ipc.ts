/** Tiny IPC helper so Other-mode events do not require rewriting main/index.ts. */
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'
import { logger } from '../../main/logger'

function sendAll(channel: string, payload: unknown): void {
  let sent = 0
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload)
      sent++
    }
  }
  // every window gets it; each one that handles it will log its own ingest
  logger.debug('ipc', 'other broadcast', { channel, windows: sent })
}

export function sendOtherAccepted(payload: unknown): void {
  const p = payload as { missionId?: string; title?: string }
  logger.info('other', 'send accepted to windows', { id: p?.missionId?.slice(0, 8), title: p?.title })
  sendAll(IPC.evtOtherAccepted, payload)
}

export function sendOtherSessionDrop(): void {
  logger.info('other', 'send sessionDrop to windows')
  sendAll(IPC.evtOtherSessionDrop, {})
}

export function sendOtherJobsChanged(): void {
  sendAll(IPC.evtOtherJobsChanged, {})
}
