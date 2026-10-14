// recover active hauls (and their sharing state) mid-session

import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import { logger } from './logger'
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
        if (parsed.isHauling) {
          active.set(parsed.event.missionId, { accepted: parsed.event, objectives: [] })
        }
        break
      case 'objective': {
        const contract = active.get(parsed.event.missionId)
        if (contract) contract.objectives.push(parsed.event)
        break
      }
      case 'ended':
        active.delete(parsed.event.missionId)
        break
      case 'share': {
        const e = parsed.event
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

