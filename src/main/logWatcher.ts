// tails Game.log, resets on rotation

import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { parseLine, parseTimestamp, type MarkerEntry } from './logParser'
import { logger } from './logger'
import { trace } from './trace'
import type {
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  ContractPaidEvent,
  ShareEvent,
  WatcherStatus
} from '@shared/types'

export const POLL_INTERVAL_MS = 200
const PERF_SAMPLE_MS = 10_000

export interface LogWatcherEvents {
  status: (s: WatcherStatus) => void
  accepted: (e: ContractAcceptedEvent, isHauling: boolean) => void
  objective: (e: ObjectiveEvent) => void
  ended: (e: ContractEndedEvent) => void
  paid: (e: ContractPaidEvent) => void
  share: (e: ShareEvent) => void
  sessionDrop: () => void
  line: (line: string) => void // every raw line, before parsing
}

export class LogWatcher extends EventEmitter {
  private path: string
  private channel: string | null
  private timer: NodeJS.Timeout | null = null
  private fd: number | null = null
  private position = 0
  private lastSize = 0
  private lastIno: number | null = null
  private firstOpen = true
  private buffer = ''
  private markers = new Map<string, MarkerEntry>()
  private lastCompleteId = ''
  private connected = false
  private localGeid = ''
  private lastPollTrace = 0
  private lastLagTrace = 0

  constructor(path: string, channel: string | null) {
    super()
    this.path = path
    this.channel = channel
  }

  start(): void {
    this.stop()
    logger.info('watch', 'watcher start', { path: this.path, channel: this.channel })
    this.tick()
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.closeFd()
    this.connected = false
  }

  status(): WatcherStatus {
    return {
      connected: this.connected,
      path: this.path || null,
      pollIntervalMs: POLL_INTERVAL_MS,
      channel: this.channel
    }
  }

  private closeFd(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd)
      } catch {
        /* ignore */
      }
      this.fd = null
    }
  }

  private emitStatus(error?: string): void {
    const s = this.status()
    if (error) s.error = error
    this.emit('status', s)
  }

  private setConnected(connected: boolean, error?: string): void {
    if (connected !== this.connected) {
      if (connected) logger.info('watch', 'Game.log connected', { path: this.path })
      else logger.warn('watch', 'Game.log lost', { path: this.path, error })
      this.connected = connected
      this.emitStatus(error)
    } else if (error) {
      this.emitStatus(error)
    }
  }

  private tick(): void {
    let st: fs.Stats
    try {
      st = fs.statSync(this.path)
    } catch {
      if (this.fd !== null) {
        this.closeFd()
        this.markers.clear()
        this.lastCompleteId = ''
      }
      this.setConnected(false, 'Game.log not found')
      return
    }

    const rotated =
      this.fd === null ||
      (this.lastIno !== null && st.ino !== 0 && st.ino !== this.lastIno) ||
      st.size < this.lastSize

    if (rotated) {
      if (this.fd !== null) {
        logger.info('watch', 'Game.log rotated/truncated', {
          oldSize: this.lastSize,
          newSize: st.size,
          inoChanged: this.lastIno !== null && st.ino !== 0 && st.ino !== this.lastIno
        })
        this.closeFd()
        this.markers.clear()
        this.lastCompleteId = ''
      }
      try {
        this.fd = fs.openSync(this.path, 'r')
      } catch (e) {
        this.setConnected(false, `cannot open Game.log: ${(e as Error).message}`)
        return
      }
      this.lastIno = st.ino || null
      this.buffer = ''
      if (this.firstOpen) {
        this.primeIdentity(st.size)
        this.position = st.size
        this.lastSize = st.size
        this.firstOpen = false
        logger.info('watch', 'first open, tailing from end', { size: st.size, hasIdentity: !!this.localGeid })
      } else {
        logger.info('watch', 'reopened, reading from start', { size: st.size })
        this.position = 0
        this.lastSize = 0
      }
    }

    if (st.size > this.position) {
      const length = st.size - this.position
      const chunk = Buffer.alloc(length)
      try {
        const t0 = performance.now()
        const read = fs.readSync(this.fd!, chunk, 0, length, this.position)
        this.position += read
        this.buffer += chunk.subarray(0, read).toString('utf8')
        this.drainBuffer()
        const now = Date.now()
        if (now - this.lastPollTrace >= PERF_SAMPLE_MS) {
          this.lastPollTrace = now
          trace({
            area: 'perf',
            mode: 'haul',
            what: 'log poll',
            ms: Math.round((performance.now() - t0) * 10) / 10,
            data: { bytes: read, position: this.position }
          })
        }
      } catch (e) {
        this.setConnected(false, `read failed: ${(e as Error).message}`)
        return
      }
    }

    this.lastSize = st.size
    this.setConnected(true)
  }

  private drainBuffer(): void {
    const nl = this.buffer.lastIndexOf('\n')
    if (nl < 0) return
    const block = this.buffer.slice(0, nl + 1)
    this.buffer = this.buffer.slice(nl + 1)
    for (const raw of block.split(/\r?\n/)) {
      if (!raw) continue
      this.emit('line', raw)
      this.processLine(raw)
    }
  }

  private primeIdentity(size: number): void {
    if (this.fd === null) return
    try {
      const head = Buffer.alloc(Math.min(size, 262144))
      const read = fs.readSync(this.fd, head, 0, head.length, 0)
      for (const raw of head.subarray(0, read).toString('utf8').split(/\r?\n/)) {
        const parsed = parseLine(raw, this.markers)
        if (parsed?.kind === 'identity') {
          this.localGeid = parsed.geid
          return
        }
      }
    } catch {
      /* left-events fall back to undefined isLocal */
    }
  }

  private traceLag(line: string): void {
    const now = Date.now()
    if (now - this.lastLagTrace < PERF_SAMPLE_MS) return
    const ts = parseTimestamp(line)
    const at = ts ? Date.parse(ts) : NaN
    if (!Number.isFinite(at)) return
    this.lastLagTrace = now
    trace({ area: 'perf', mode: 'haul', what: 'watcher lag', ms: now - at, data: { logTime: ts } })
  }

  private processLine(line: string): void {
    const parsed = parseLine(line, this.markers)
    if (!parsed) return
    this.traceLag(line)
    logger.debug('watch', 'matched line', { kind: parsed.kind, line: line.slice(0, 300) })
    switch (parsed.kind) {
      case 'accepted':
        logger.info('watch', 'event accepted', {
          id: parsed.event.missionId.slice(0, 8),
          title: parsed.event.title,
          generator: parsed.event.generator,
          isHauling: parsed.isHauling
        })
        trace({
          area: 'parse',
          mode: 'haul',
          what: parsed.isHauling ? 'accepted: hauling' : 'accepted: not hauling',
          line,
          missionId: parsed.event.missionId,
          data: {
            isHauling: parsed.isHauling,
            generator: parsed.event.generator,
            contractName: parsed.event.contractName,
            title: parsed.event.title,
            haulType: parsed.event.haulType
          }
        })
        this.emit('accepted', parsed.event, parsed.isHauling)
        break
      case 'objective':
        logger.info('watch', 'event objective', { id: parsed.event.missionId.slice(0, 8) })
        trace({
          area: 'parse',
          mode: 'haul',
          what: 'objective',
          line,
          missionId: parsed.event.missionId,
          data: {
            commodity: parsed.event.commodity,
            scu: parsed.event.scuAmount,
            destination: parsed.event.destination
          }
        })
        this.emit('objective', parsed.event)
        break
      case 'ended':
        logger.info('watch', 'event ended', {
          id: parsed.event.missionId.slice(0, 8),
          completion: parsed.event.completion,
          reason: parsed.event.reason
        })
        trace({
          area: 'parse',
          mode: 'haul',
          what: `ended: ${parsed.event.completion}`,
          line,
          missionId: parsed.event.missionId,
          data: { completion: parsed.event.completion, reason: parsed.event.reason }
        })
        this.emit('ended', parsed.event)
        break
      case 'sessionDrop':
        logger.info('watch', 'event sessionDrop')
        this.emit('sessionDrop')
        break
      case 'completeNotice':
        logger.info('watch', 'event completeNotice', { id: parsed.missionId.slice(0, 8) })
        trace({ area: 'parse', mode: 'haul', what: 'complete notice', line, missionId: parsed.missionId })
        this.lastCompleteId = parsed.missionId
        break
      case 'awarded':
        logger.info('watch', 'event awarded', {
          amount: parsed.amount,
          id: this.lastCompleteId ? this.lastCompleteId.slice(0, 8) : null,
          dropped: !this.lastCompleteId
        })
        trace({
          area: 'parse',
          mode: 'haul',
          what: this.lastCompleteId ? 'paid' : 'paid: dropped (no complete notice)',
          line,
          missionId: this.lastCompleteId || undefined,
          data: { amount: parsed.amount }
        })
        if (this.lastCompleteId) {
          this.emit('paid', { missionId: this.lastCompleteId, amount: parsed.amount })
          this.lastCompleteId = ''
        }
        break
      case 'identity':
        logger.info('watch', 'event identity')
        this.localGeid = parsed.geid
        break
      case 'share': {
        const e = parsed.event
        logger.info('watch', 'event share', { kind: e.kind, id: e.missionId.slice(0, 8) })
        trace({
          area: 'parse',
          mode: 'haul',
          what: `share: ${e.kind}`,
          line,
          missionId: e.missionId,
          data: { kind: e.kind, isLocal: e.kind === 'left' && this.localGeid ? e.actorId === this.localGeid : undefined }
        })
        if (e.kind === 'left' && this.localGeid) {
          this.emit('share', { ...e, isLocal: e.actorId === this.localGeid })
        } else {
          this.emit('share', e)
        }
        break
      }
    }
  }
}

export interface LogWatcher {
  on<K extends keyof LogWatcherEvents>(event: K, listener: LogWatcherEvents[K]): this
  emit<K extends keyof LogWatcherEvents>(
    event: K,
    ...args: Parameters<LogWatcherEvents[K]>
  ): boolean
}
