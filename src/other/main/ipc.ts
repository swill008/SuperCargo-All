/** Other-mode broadcasts from main. */
import { BrowserWindow, ipcMain } from 'electron'
import type { OtherAction } from '@other/otherActions'
import { IPC } from '@shared/channels'
import { logger } from '../../main/logger'

/** Every window (main + overlay) reloads; the saver skips its own echo by sender/rev (rule 8). */
export function sendOtherJobsChanged(payload: { rev?: number; sender?: number }): void {
  let sent = 0
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    w.webContents.send(IPC.evtOtherJobsChanged, payload)
    sent++
  }
  logger.debug('ipc', 'other jobsChanged broadcast', { windows: sent, rev: payload.rev, sender: payload.sender })
}

let relayBound = false

/** Overlay actions go to the main window only, which applies and saves them (rule 8). */
export function registerOtherActionRelay(getMainWindow: () => BrowserWindow | null): void {
  if (relayBound) return
  relayBound = true
  ipcMain.on(IPC.otherAction, (e, a: OtherAction) => {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string' || typeof a.jobId !== 'string') {
      logger.warn('ipc', 'other action rejected: bad payload', { sender: e.sender.id })
      return
    }
    const w = getMainWindow()
    if (!w || w.isDestroyed()) {
      logger.warn('ipc', 'other action dropped: no main window', { type: a.type, sender: e.sender.id })
      return
    }
    if (w.webContents.id === e.sender.id) {
      logger.debug('ipc', 'other action from main window itself: ignored', { type: a.type })
      return
    }
    w.webContents.send(IPC.evtOtherAction, a)
    logger.debug('ipc', 'other action relayed to main window', { type: a.type, jobId: a.jobId, sender: e.sender.id })
  })
}
