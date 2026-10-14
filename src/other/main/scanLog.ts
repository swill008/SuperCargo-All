/** Other start-up scan (rule 7). Haul scanSessionLog stays in src/main/scanLog.ts. */
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { OtherLogEvent, OtherScanResult } from '@other/otherEvents'
import { createOtherLineParser } from '@other/otherLogParse'
import { logger } from '../../main/logger'
import { trace } from '../../main/trace'
import { loadCachedLocations } from '../../main/uex'
import { createCurrentLocationTracker } from '@other/otherCurrentLocation'
import type { Location } from '@shared/types'
import { loadOtherPlaces } from './uex'

type Parser = ReturnType<typeof createOtherLineParser>

/** the parser's diagnostics hook (createOtherLineParser's optional onTrace) */
export type OtherParseTrace = { what: string; line: string; kind?: string; data?: Record<string, unknown> }

/** Other parser wired to main trace(): unrecognised lines -> 'unknown', the rest -> 'parse' */
export function createTracedOtherParser(): ReturnType<typeof createOtherLineParser> {
  return createOtherLineParser({
    onTrace: (r: OtherParseTrace) =>
      trace({
        area: r.what === 'unknown' ? 'unknown' : 'parse',
        mode: 'other',
        what: r.what,
        line: r.line,
        data: r.kind ? { kind: r.kind, ...(r.data ?? {}) } : r.data
      })
  })
}

/** roster for the "where am I" tracker: haul UEX cache plus Other places (cities/outposts) */
let rosterCache: { at: number; list: Location[] } | null = null
export function currentLocationRoster(): Location[] {
  // read from disk at most every 60 s (every 5 s while still empty); called per log line
  const now = Date.now()
  const ttl = rosterCache?.list.length ? 60_000 : 5_000
  if (!rosterCache || now - rosterCache.at > ttl) {
    rosterCache = { at: now, list: [...(loadCachedLocations()?.locations ?? []), ...loadOtherPlaces()] }
  }
  return rosterCache.list
}

/** drop the roster cache so the next log line rebuilds it (after the places roster is refreshed) */
export function resetLocationRoster(): void {
  rosterCache = null
}

/** runs the location tracker over the same lines; returns a 'location' event when current() changes */
export function createLocationEmitter(
  locations: Location[] | (() => Location[])
): (line: string, at: () => string) => OtherLogEvent | null {
  // the roster can be empty at start-up (first run, before the UEX cache is seeded): rebuild once it fills
  const roster = typeof locations === 'function' ? locations : (): Location[] => locations
  let size = -1
  let t = createCurrentLocationTracker([])
  let prev: string | null = null
  return (line, at) => {
    const list = roster()
    if (list.length !== size) {
      size = list.length
      t = createCurrentLocationTracker(list)
    }
    t.push(line)
    const now = t.current()
    if (now === prev) return null
    prev = now
    return { kind: 'location', at: at(), name: now }
  }
}

/** Game.log line timestamp `<2026-10-14T12:00:00.000Z>`, else now */
export function lineTime(line: string): string {
  const m = /^<(\d{4}-\d\d-\d\dT[^>]+)>/.exec(line)
  return m ? m[1] : new Date().toISOString()
}

type Locate = ReturnType<typeof createLocationEmitter>

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

async function feedFile(
  file: string,
  parser: Parser,
  locate: Locate
): Promise<{ events: OtherLogEvent[]; bytes: number; location?: OtherLogEvent } | null> {
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (e) {
    logger.warn('other', 'scan: read failed', { file, error: (e as Error).message })
    return null
  }
  const events: OtherLogEvent[] = []
  let location: OtherLogEvent | undefined
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const ev = parser.feed(line)
    if (ev) events.push(ev)
    location = locate(line, () => lineTime(line)) ?? location
  }
  return { events, bytes: text.length, location }
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
  const parser = createTracedOtherParser() // one parser across both files, in log order
  const all: OtherLogEvent[] = []
  let location: OtherLogEvent | undefined

  const backup = await newestBackup(logPath)
  if (backup) {
    // the backup is an earlier game session: its location isn't where the player is now
    const r = await feedFile(backup, parser, () => null)
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

  const cur = await feedFile(logPath, parser, createLocationEmitter(currentLocationRoster()))
  if (cur) {
    location = cur.location
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
  // only the last location matters; report it even when older than the watermark (like currentSession)
  if (location) out.events.push(location)
  logger.info('other', 'scan done', {
    since: since || null,
    files: out.files.length,
    parsed: all.length,
    returned: out.events.length,
    location: location?.kind === 'location' ? location.name : undefined,
    previousEnd: out.previousEnd,
    ms: Date.now() - t0
  })
  return out
}

/** REFRESH filter: markers of the given missions plus session lines (build/zone context), in log order */
export function pickRefreshEvents(events: OtherLogEvent[], missionIds: string[]): OtherLogEvent[] {
  const want = new Set(missionIds)
  return events.filter((e) => e.kind === 'session' || (e.kind === 'marker' && want.has(e.missionId)))
}

export type OtherRefreshScanResult = { events: OtherLogEvent[]; files: string[]; ms: number }

/**
 * REFRESH re-scan: same files as scanOtherEvents (newest logbackups file, then Game.log) but no watermark;
 * returns only session lines and markers of the given (active) missions.
 */
export async function scanMarkersFor(logPath: string | undefined, missionIds: string[]): Promise<OtherRefreshScanResult> {
  const t0 = Date.now()
  const out: OtherRefreshScanResult = { events: [], files: [], ms: 0 }
  const ids = Array.isArray(missionIds) ? missionIds.filter((x): x is string => typeof x === 'string' && !!x) : []
  if (!logPath) {
    logger.warn('other', 'refresh scan skipped: no Game.log path')
    return out
  }
  if (!ids.length) {
    logger.info('other', 'refresh scan skipped: no active missions')
    out.ms = Date.now() - t0
    return out
  }
  const parser = createTracedOtherParser() // one parser across both files, in log order
  const all: OtherLogEvent[] = []
  const backup = await newestBackup(logPath)
  if (backup) {
    const r = await feedFile(backup, parser, () => null)
    if (r) {
      out.files.push(backup)
      all.push(...r.events)
    }
  }
  const cur = await feedFile(logPath, parser, () => null)
  if (cur) {
    out.files.push(logPath)
    all.push(...cur.events)
  }
  out.events = pickRefreshEvents(all, ids)
  out.ms = Date.now() - t0
  logger.info('other', 'refresh scan done', {
    missions: ids.map((m) => m.slice(0, 8)),
    files: out.files.length,
    parsed: all.length,
    markers: out.events.filter((e) => e.kind === 'marker').length,
    sessions: out.events.filter((e) => e.kind === 'session').length,
    ms: out.ms
  })
  return out
}
