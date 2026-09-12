// recover active hauls (and their sharing state) mid-session

import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import type { ScannedContract, ScanShare, SessionScan, ContractEndedEvent } from '@shared/types'

export function scanSessionLog(logPath: string): SessionScan {
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch {
    return { contracts: [], shares: [] }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const joined = new Map<string, Set<string>>()
  const sharedToMe = new Set<string>()
  const leftByOthers = new Set<string>()
  let localGeid = ''

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    const parsed = parseLine(line, markers)
    if (!parsed) continue
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

  return { contracts: [...active.values()], shares }
}

export type OtherSessionScan = {
  contracts: ScannedContract[]
  ended: ContractEndedEvent[]
}

/** Active non-haul contracts still open in this Game.log. Other mode only. */
export function scanOtherSessionLog(logPath: string): OtherSessionScan {
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch {
    return { contracts: [], ended: [] }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const ended: ContractEndedEvent[] = []
  const objsByContract = new Map<string, ScannedContract['objectives']>()

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    const parsed = parseLine(line, markers)
    if (!parsed) continue
    switch (parsed.kind) {
      case 'accepted':
        if (!parsed.isHauling) {
          active.set(parsed.event.missionId, { accepted: parsed.event, objectives: [] })
        }
        break
      case 'objective': {
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

  return { contracts, ended }
}
