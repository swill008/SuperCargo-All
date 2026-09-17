/** Other session scan. Haul scanSessionLog stays in src/main/scanLog.ts. */
import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from '../../main/logParser'
import type { ScannedContract, ContractEndedEvent } from '@shared/types'

export type OtherSessionScan = {
  contracts: ScannedContract[]
  ended: ContractEndedEvent[]
  objectivesByMission: Record<string, ScannedContract['objectives']>
}

/** Game launch or menu quit. Haul parseLine only sees Channel Disconnected + Player requested disconnect. */
function isOtherSessionBreak(line: string): boolean {
  if (/CDisciplineServiceExternal::Init/i.test(line)) return true
  if (/Player requested disconnect/i.test(line)) return true
  return false
}

export function scanOtherSessionLog(logPath: string): OtherSessionScan {
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch {
    return { contracts: [], ended: [], objectivesByMission: {} }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const ended: ContractEndedEvent[] = []
  const objsByContract = new Map<string, ScannedContract['objectives']>()
  const objectivesByMission = new Map<string, ScannedContract['objectives']>()

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    if (isOtherSessionBreak(line)) {
      active.clear()
      continue
    }
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
  return { contracts, ended, objectivesByMission: byMission }
}
