/**
 * Session-only Other OCR screenshots.
 * Folder is wiped on startup (ensureOtherJobsIpc) and on app quit.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'other-ocr-session'

function dir(): string {
  return path.join(app.getPath('userData'), DIR)
}

function fileFor(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'job'
  return path.join(dir(), `${safe}.png`)
}

export function wipeOtherOcrSession(): void {
  const d = dir()
  try {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
  } catch (e) {
    console.warn('[other-ocr-session] wipe failed:', e)
  }
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {
    /* ignore */
  }
}

export function saveOtherOcrShot(jobId: string, dataUrl: string): boolean {
  if (!jobId || !dataUrl) return false
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  try {
    fs.mkdirSync(dir(), { recursive: true })
    fs.writeFileSync(fileFor(jobId), Buffer.from(b64, 'base64'))
    return true
  } catch (e) {
    console.warn('[other-ocr-session] save failed:', e)
    return false
  }
}

export function loadOtherOcrShot(jobId: string): string | null {
  if (!jobId) return null
  try {
    const buf = fs.readFileSync(fileFor(jobId))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

let quitHooked = false
export function hookOtherOcrSessionQuit(): void {
  if (quitHooked) return
  quitHooked = true
  app.on('before-quit', () => wipeOtherOcrSession())
}
