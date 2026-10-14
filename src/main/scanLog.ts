// recover active hauls (and their sharing state) mid-session

import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import { logger } from './logger'
import { trace } from './trace'
import type { ScannedContract, ScanShare, SessionScan } from '@shared/types'

export function scanSessionLog(logPath: string): SessionScan {
  const t0 = Date.now()
  logger.info('watch', 'session scan start', { path: logPath })
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch (e) {
    logger.warn('watch', 'session scan read failed', { path: logPath, error: (e as Error).message })
    return { contracts: [], shares: [] }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const joined = new Map<string, Set<string>>()
  const sharedToMe = new Set<string>()
  const leftByOthers = new Set<string>()
  let localGeid = ''
  let lines = 0
  let events = 0

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    lines++
    const parsed = parseLine(line, markers)
    if (!parsed) continue
    events++
    logger.debug('watch', 'scan matched line', { kind: parsed.kind, line: line.slice(0, 300) })
    switch (parsed.kind) {
      case 'identity':
        localGeid = parsed.geid
        break
      case 'accepted':
        trace({
          area: 'parse',
          mode: 'haul',
          what: parsed.isHauling ? 'scan accepted: hauling' : 'scan accepted: not hauling',
          line,
          missionId: parsed.event.missionId,
          data: {
            isHauling: parsed.isHauling,
            generator: parsed.event.generator,
            contractName: parsed.event.contractName,
            title: parsed.event.title
          }
        })
        if (parsed.isHauling) {
          active.set(parsed.event.missionId, { accepted: parsed.event, objectives: [] })
        }
        break
      case 'objective': {
        const contract = active.get(parsed.event.missionId)
        trace({
          area: 'parse',
          mode: 'haul',
          what: contract ? 'scan objective' : 'scan objective: no active haul',
          line,
          missionId: parsed.event.missionId,
          data: { commodity: parsed.event.commodity, scu: parsed.event.scuAmount, destination: parsed.event.destination }
        })
        if (contract) contract.objectives.push(parsed.event)
        break
      }
      case 'ended':
        trace({
          area: 'parse',
          mode: 'haul',
          what: `scan ended: ${parsed.event.completion}`,
          line,
          missionId: parsed.event.missionId,
          data: { completion: parsed.event.completion, reason: parsed.event.reason, wasActive: active.has(parsed.event.missionId) }
        })
        active.delete(parsed.event.missionId)
        break
      case 'share': {
        const e = parsed.event
        trace({ area: 'parse', mode: 'haul', what: `scan share: ${e.kind}`, line, missionId: e.missionId, data: { kind: e.kind } })
        if (e.kind === 'shared') {
          sharedToMe.add(e.missionId)
          leftByOthers.delete(e.missionId)
        } else {
          const on = joined.get(e.missionId) ?? new Set<string>()
          if (e.kind === 'joined') on.add(e.actorId)
          else on.delete(e.actorId)
          joined.set(e.missionId, on)
          if (e.kind === 'left' && localGeid && e.actorId !== localGeid) leftByOthers.add(e.missionId)
        }
        break
      }
    }
  }

  const ids = new Set<string>([...sharedToMe, ...joined.keys()])
  const shares: ScanShare[] = [...ids].map((missionId) => ({
    missionId,
    sharedWithMe: sharedToMe.has(missionId),
    sharedWith: [...(joined.get(missionId) ?? [])],
    ownerLeft: leftByOthers.has(missionId) || undefined
  }))

  trace({
    area: 'perf',
    mode: 'haul',
    what: 'session scan',
    ms: Date.now() - t0,
    data: { bytes: content.length, lines, events, active: active.size, shares: shares.length }
  })
  logger.info('watch', 'session scan end', {
    lines,
    events,
    active: active.size,
    ids: [...active.keys()].map((id) => id.slice(0, 8)),
    shares: shares.length,
    ms: Date.now() - t0
  })
  return { contracts: [...active.values()], shares }
}

