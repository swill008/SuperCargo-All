// autoUpdater needs app ready, touch only after whenReady

import electronUpdater, { type AppUpdater } from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
import type { UpdateState } from '@shared/types'
import { logger } from './logger'

let listenersAttached = false

function updater(): AppUpdater {
  return electronUpdater.autoUpdater
}

function send(win: BrowserWindow | null, state: UpdateState): void {
  if (win && !win.isDestroyed()) win.webContents.send('evt:update', state)
}

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (listenersAttached) return
  listenersAttached = true

  const au = updater()
  au.autoDownload = true
  au.autoInstallOnAppQuit = true

  au.on('checking-for-update', () => logger.info('net', 'update check start'))
  au.on('update-available', (info) => logger.info('net', 'update available', { version: info.version }))
  au.on('update-not-available', (info) => logger.info('net', 'update none', { version: info.version }))
  au.on('download-progress', (p) => logger.debug('net', 'update download', { percent: Math.round(p.percent) }))
  au.on('update-downloaded', (info) => logger.info('net', 'update downloaded', { version: info.version }))
  au.on('error', (err) => logger.warn('net', 'update error', { error: err == null ? 'unknown' : String(err.message || err) }))
  au.on('checking-for-update', () => send(getWindow(), { kind: 'checking' }))
  au.on('update-available', (info) =>
    send(getWindow(), { kind: 'available', version: info.version })
  )
  au.on('update-not-available', (info) =>
    send(getWindow(), { kind: 'none', version: info.version })
  )
  au.on('download-progress', (p) =>
    send(getWindow(), { kind: 'downloading', percent: Math.round(p.percent) })
  )
  au.on('update-downloaded', (info) =>
    send(getWindow(), { kind: 'downloaded', version: info.version })
  )
  au.on('error', (err) =>
    send(getWindow(), { kind: 'error', message: err == null ? 'unknown' : String(err.message || err) })
  )
}

export async function checkForUpdates(): Promise<void> {
  // prerelease builds don't follow the public feed
  if (app.getVersion().includes('-')) logger.info('net', 'update check skipped (prerelease)', { version: app.getVersion() })
  if (app.getVersion().includes('-')) return
  try {
    await updater().checkForUpdates()
  } catch (e) {
    console.error('[updater] check failed:', e)
    logger.warn('net', 'update check failed', { error: (e as Error)?.message ?? String(e) })
  }
}

export function quitAndInstall(): void {
  logger.info('net', 'quit and install')
  updater().quitAndInstall()
}
