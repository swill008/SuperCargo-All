/** Other start-up scan (rule 7). Haul scanSessionLog stays in src/main/scanLog.ts. */
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { OtherLogEvent, OtherScanResult } from '@other/otherEvents'
import { createOtherLineParser } from '@other/otherLogParse'
import { logger } from '../../main/logger'

type Parser = ReturnType<typeof createOtherLineParser>

function ms(at: string): number {
  const t = Date.parse(at)
  return Number.isNaN(t) ? 0 : t
}

/** >= : several log lines share one ms, so the watermark's own ms is replayed (the reducer skips repeats). */
function newer(at: string, since?: string): boolean {
  return !since || ms(at) >= ms(since)
}

/** strictly after the watermark: used for crash judgement so a replayed last line isn't "new activity" */
function after(at: string, since?: string): boolean {
  return !since || ms(at) > ms(since)
}

/** Game.log untouched this long at scan time = the game isn't running. */
const STALE_MS = 60_000

async function newestBackup(logPath: string): Promise<string | null> {
  const d = path.join(path.dirname(logPath), 'logbackups')
  let names: string[]
  try {
    names = await fsp.readdir(d)
  } catch {
    logger.debug('other', 'scan: no logbackups folder', { dir: d })
    return null
  }
  let best: { file: string; mtime: number } | null = null
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.log')) continue
    const f = path.join(d, n)
    try {
      const st = await fsp.stat(f)
      if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { file: f, mtime: st.mtimeMs }
    } catch {
      /* vanished */
    }
  }
  return best?.file ?? null
}

async function feedFile(file: string, parser: Parser): Promise<{ events: OtherLogEvent[]; bytes: number } | null> {
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (e) {
    logger.warn('other', 'scan: read failed', { file, error: (e as Error).message })
    return null
  }
  const events: OtherLogEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const ev = parser.feed(line)
    if (ev) events.push(ev)
  }
  return { events, bytes: text.length }
}

const isActivity = (e: OtherLogEvent): boolean =>
  e.kind === 'accepted' || e.kind === 'objective' || e.kind === 'objectiveComplete' || e.kind === 'objectiveWithdrawn'

/**
 * quit = SystemQuit or "Player requested disconnect" after the last contract activity (rule 5);
 * crash = activity after since with no quit/disconnect after it (rule 6).
 */
function judgeEnd(events: OtherLogEvent[], since?: string): OtherScanResult['previousEnd'] {
  let lastAct = -1
  let lastEnd = -1
  events.forEach((e, i) => {
    if (isActivity(e)) lastAct = i
    else if (e.kind === 'quit' || e.kind === 'disconnect') lastEnd = i
  })
  if (lastEnd > lastAct) return 'quit'
  if (lastAct >= 0 && events.some((e) => isActivity(e) && after(e.at, since))) return 'crash'
  return 'none'
}

async function mtimeMs(file: string): Promise<number | null> {
  try {
    return (await fsp.stat(file)).mtimeMs
  } catch {
    return null
  }
}

export async function scanOtherEvents(logPath: string | undefined, since?: string): Promise<OtherScanResult> {
  const t0 = Date.now()
  const out: OtherScanResult = { events: [], files: [], previousEnd: 'none' }
  if (!logPath) {
    logger.warn('other', 'scan skipped: no Game.log path')
    return out
  }
  const parser = createOtherLineParser() // one parser across both files, in log order
  const all: OtherLogEvent[] = []

  const backup = await newestBackup(logPath)
  if (backup) {
    const r = await feedFile(backup, parser)
    const last = r?.events[r.events.length - 1]
    if (r && last && newer(last.at, since)) {
      out.files.push(backup)
      all.push(...r.events)
      out.previousEnd = judgeEnd(r.events, since)
      logger.info('other', 'scan: backup log read', { file: backup, bytes: r.bytes, events: r.events.length, last: last.at, previousEnd: out.previousEnd })
    } else {
      logger.info('other', 'scan: backup log not newer than watermark, skipped', { file: backup, last: last?.at, since })
    }
  }

  const cur = await feedFile(logPath, parser)
  if (cur) {
    out.files.push(logPath)
    all.push(...cur.events)
    // the session line is at the top of the log, usually before the watermark: always report it
    const sess = cur.events.find((e) => e.kind === 'session')
    if (sess?.kind === 'session') out.currentSession = { at: sess.at, build: sess.build }
    // app opened after a crash, before the game: the current Game.log is the previous session
    const mt = await mtimeMs(logPath)
    const age = mt === null ? null : Date.now() - mt
    let curEnd: OtherScanResult['previousEnd'] | 'running' = 'running'
    if (age !== null && age > STALE_MS) {
      curEnd = judgeEnd(cur.events, since)
      if (curEnd !== 'none') out.previousEnd = curEnd // newer than the backup, so it wins
    }
    logger.info('other', 'scan: Game.log read', {
      file: logPath,
      bytes: cur.bytes,
      events: cur.events.length,
      ageS: age === null ? null : Math.round(age / 1000),
      end: curEnd,
      previousEnd: out.previousEnd
    })
  }

  out.events = all.filter((e) => newer(e.at, since))
  logger.info('other', 'scan done', {
    since: since || null,
    files: out.files.length,
    parsed: all.length,
    returned: out.events.length,
    previousEnd: out.previousEnd,
    ms: Date.now() - t0
  })
  return out
}
