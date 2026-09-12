/** Tiny IPC helper so Other-mode events do not require rewriting main/index.ts. */
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'

function sendAll(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export function sendOtherAccepted(payload: unknown): void {
  sendAll(IPC.evtOtherAccepted, payload)
}

export function sendOtherSessionDrop(): void {
  sendAll(IPC.evtOtherSessionDrop, {})
}
