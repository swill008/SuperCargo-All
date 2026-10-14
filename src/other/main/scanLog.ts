/** Other session scan. Haul scanSessionLog stays in src/main/scanLog.ts. */
import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from '../../main/logParser'
import type { ScannedContract, ContractEndedEvent } from '@shared/types'
import { logger } from '../../main/logger'

export type OtherSessionScan = {
  contracts: ScannedContract[]
  ended: ContractEndedEvent[]
  objectivesByMission: Record<string, ScannedContract['objectives']>
}

export function scanOtherSessionLog(logPath: string): OtherSessionScan {
  const t0 = Date.now()
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch (e) {
    logger.warn('other', 'session scan read failed', { path: logPath, error: (e as Error).message })
    return { contracts: [], ended: [], objectivesByMission: {} }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const ended: ContractEndedEvent[] = []
  const objsByContract = new Map<string, ScannedContract['objectives']>()
  const objectivesByMission = new Map<string, ScannedContract['objectives']>()

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    const parsed = parseLine(line, markers)
    if (!parsed) continue
    switch (parsed.kind) {
      case 'accepted':
        active.set(parsed.event.missionId, { accepted: parsed.event, objectives: [] })
        break
      case 'objective': {
        const list = objectivesByMission.get(parsed.event.missionId) ?? []
        list.push(parsed.event)
        objectivesByMission.set(parsed.event.missionId, list)
        const contract = active.get(parsed.event.missionId)
        if (contract) {
          contract.objectives.push(parsed.event)
          const key = contract.accepted.contractName || contract.accepted.title
          if (key) objsByContract.set(key, [...contract.objectives])
        }
        break
      }
      case 'ended':
        ended.push(parsed.event)
        active.delete(parsed.event.missionId)
        break
      case 'sessionDrop':
        logger.info('other', 'session scan: sessionDrop clears active', { cleared: active.size })
        active.clear()
        break
    }
  }

  const contracts = [...active.values()].map((c) => {
    if (c.objectives.length > 0) return c
    const key = c.accepted.contractName || c.accepted.title
    const inherited = key ? objsByContract.get(key) : undefined
    if (!inherited?.length) return c
    return {
      ...c,
      objectives: inherited.map((o) => ({ ...o, missionId: c.accepted.missionId }))
    }
  })

  const byMission: Record<string, ScannedContract['objectives']> = {}
  for (const [id, objs] of objectivesByMission) byMission[id] = objs
  logger.info('other', 'session scan done', {
    active: contracts.length,
    ids: contracts.map((c) => c.accepted.missionId.slice(0, 8)),
    ended: ended.length,
    ms: Date.now() - t0
  })
  return { contracts, ended, objectivesByMission: byMission }
}
