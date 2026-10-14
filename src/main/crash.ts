// crash + window-health hooks; everything lands in the debug log, nothing exits

import type { BrowserWindow } from 'electron'
import { logger } from './logger'

let installed = false

function errFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, stack: err.stack ?? '' }
  return { error: String(err) }
}

export function installCrashHooks(): void {
  if (installed) return
  installed = true
  // having a listener stops node's default exit
  process.on('uncaughtException', (err) => logger.error('crash', 'uncaught exception', errFields(err)))
  process.on('unhandledRejection', (reason) => logger.error('crash', 'unhandled rejection', errFields(reason)))
}

const RELOAD_GAP_MS = 60_000

export function watchWindow(win: BrowserWindow, name: 'main' | 'overlay' | 'debug'): void {
  const wc = win.webContents
  let lastReload = 0
  wc.on('render-process-gone', (_e, d) => {
    logger.error('crash', 'renderer gone', { window: name, reason: d.reason, exitCode: d.exitCode })
    if (d.reason === 'clean-exit') return
    // one reload a minute, so a crash loop can't spin
    const now = Date.now()
    if (now - lastReload < RELOAD_GAP_MS) {
      logger.warn('crash', 'not reloading, crashed again within 60s', { window: name })
      return
    }
    lastReload = now
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload()
    }, 500)
  })
  wc.on('unresponsive', () => logger.warn('crash', 'window unresponsive', { window: name }))
  wc.on('responsive', () => logger.info('crash', 'window responsive again', { window: name }))
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3) return // aborted, e.g. a reload mid-load
    logger.error('crash', 'page failed to load', { window: name, code, desc, url, mainFrame: isMainFrame })
  })
  wc.on('preload-error', (_e, preloadPath, err) =>
    logger.error('crash', 'preload error', { window: name, preload: preloadPath, ...errFields(err) })
  )
}
