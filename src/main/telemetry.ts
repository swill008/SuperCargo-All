// opt-in OCR sample upload, queued + retried. insert-only bucket, the key can't read it back.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { dataPath } from './paths'
import { logger } from './logger'

// publishable key, safe to embed
export const SUPABASE_URL = 'https://rjljbmbuegqerhxyaypq.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_wb_4KDrnvRc39ZaUfsUFxw_3Cvy1cxC'
const BUCKET = 'ocr-samples'
const RETRY_MS = 5 * 60 * 1000

interface QueueItem {
  id: string
  clientId: string
}
interface QueueFile {
  items: QueueItem[]
  uploaded: number
}

function outboxDir(): string {
  return dataPath('outbox')
}
function queuePath(): string {
  return dataPath('upload-queue.json')
}

let queue: QueueFile = { items: [], uploaded: 0 }
let processing = false
let timer: NodeJS.Timeout | null = null

function loadQueue(): void {
  try {
    queue = { items: [], uploaded: 0, ...JSON.parse(fs.readFileSync(queuePath(), 'utf8')) }
  } catch {
    queue = { items: [], uploaded: 0 }
  }
}
function saveQueue(): void {
  try {
    fs.writeFileSync(queuePath(), JSON.stringify(queue), 'utf8')
  } catch (e) {
    console.error('[telemetry] failed to persist queue:', e)
    logger.warn('net', 'telemetry queue save failed', { error: (e as Error)?.message ?? String(e) })
  }
}

async function putObject(objectPath: string, body: Buffer, contentType: string): Promise<boolean> {
  const t0 = Date.now()
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType
    },
    body: new Uint8Array(body)
  })
  // path holds the client id; log only the bucket
  logger.info('net', 'telemetry upload', {
    host: new URL(SUPABASE_URL).host,
    path: `/storage/v1/object/${BUCKET}`,
    type: contentType,
    status: res.status,
    ms: Date.now() - t0
  })
  // 409 = already there
  return res.status === 200 || res.status === 409
}

async function processQueue(): Promise<void> {
  if (processing || queue.items.length === 0) return
  processing = true
  try {
    const remaining: QueueItem[] = []
    for (const item of queue.items) {
      const png = path.join(outboxDir(), `${item.id}.png`)
      const json = path.join(outboxDir(), `${item.id}.json`)
      if (!fs.existsSync(png) || !fs.existsSync(json)) continue
      try {
        const okPng = await putObject(`${item.clientId}/${item.id}.png`, fs.readFileSync(png), 'image/png')
        // skip the label if the image didn't land
        const okJson = okPng && await putObject(`${item.clientId}/${item.id}.json`, fs.readFileSync(json), 'application/json')
        if (okPng && okJson) {
          fs.unlinkSync(png)
          fs.unlinkSync(json)
          queue.uploaded++
        } else {
          remaining.push(item)
        }
      } catch (e) {
        logger.warn('net', 'telemetry upload failed', { error: (e as Error)?.message ?? String(e) })
        remaining.push(item)
      }
    }
    logger.info('net', 'telemetry queue processed', { before: queue.items.length, remaining: remaining.length, uploaded: queue.uploaded })
    queue.items = remaining
    saveQueue()
  } finally {
    processing = false
  }
}

export function enqueue(clientId: string, id: string, png: Buffer, label: object): void {
  try {
    fs.mkdirSync(outboxDir(), { recursive: true })
    fs.writeFileSync(path.join(outboxDir(), `${id}.png`), png)
    fs.writeFileSync(path.join(outboxDir(), `${id}.json`), JSON.stringify(label), 'utf8')
    queue.items.push({ id, clientId })
    saveQueue()
  } catch (e) {
    console.error('[telemetry] failed to enqueue sample:', e)
    logger.warn('net', 'telemetry enqueue failed', { error: (e as Error)?.message ?? String(e) })
    return
  }
  void processQueue()
}

export function init(): void {
  loadQueue()
  logger.info('net', 'telemetry init', { queued: queue.items.length, uploaded: queue.uploaded })
  if (!timer) timer = setInterval(() => void processQueue(), RETRY_MS)
  void processQueue()
}

export function status(): { uploaded: number; queued: number } {
  return { uploaded: queue.uploaded, queued: queue.items.length }
}
