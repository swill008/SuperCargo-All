// Game.log lines -> OtherLogEvent. Same parser for live tailing and the start-up scan.
// Cheap indexOf checks first; the regexes only run on lines that can match.
import { cleanTitle, isHaulingContract } from '@shared/contract'
import type { OtherLineParser, OtherLogEvent } from '@other/otherEvents'
import { parseOtherObjectiveText } from '@other/otherLog'

/** diagnostics hook: main wires it to trace(); what = 'event' | 'ignored: …' | 'unknown' */
export interface OtherParseTrace {
  what: string
  line: string
  kind?: string
  data?: Record<string, unknown>
}

export interface OtherLineParserOptions {
  onTrace?: (r: OtherParseTrace) => void
}

// notification kinds the parser reads; any other mission-looking notification is reported as unknown
const HANDLED = ['Contract Accepted:', 'New Objective:', 'Objective Complete:', 'Objective Withdrawn:']
const MISSIONISH = /^(Contract|Objective|Mission|New Objective|Bounty|Job)\b/i
// notification kinds seen in real Game.logs that carry no job info: traced as
// 'ignored: known (<label>)' instead of 'unknown'. Shared / Complete / Failed come from
// <MissionShared> and <EndMission> already.
const KNOWN: Array<[RegExp, string]> = [
  [/^Contract Shared:/, 'contract shared'],
  [/^Contract Complete:/, 'contract complete'],
  [/^Contract Failed:/, 'contract failed'],
  [/^Contract Not Accepted:/, 'contract not accepted'],
  [/^Contract (?:Abandoned|Withdrawn|Expired|Available|Offered):/, 'contract status'],
  [/^Mission (?:Complete|Failed|Abandoned):/, 'mission status'],
  [/^Journal Entry Added:/, 'journal entry'],
  [/^(?:Entered|Exited|Entering|Leaving) /, 'area change'],
  [/^Hangar Request Completed:/, 'hangar request'],
  [/^CrimeStat /, 'crimestat'],
  [/^[^\n:]*\bReward:/i, 'reward'],
  [/You've been awarded/i, 'reward'],
  [/^(?:New Member Joined|Member Left|New Party Leader|Party Disbanded|Friend Added|You have (?:joined|left|been kicked))/, 'party'],
  [/^Quantum Travel Calibration /, 'quantum calibration'],
  [/^Standby, Local Emergency Services/, 'emergency services']
]
const knownLabel = (body: string): string | undefined => KNOWN.find(([re]) => re.test(body))?.[1]

const ZERO_ID = '00000000-0000-0000-0000-000000000000'
const ADDED = 'Added notification "'
// closes a notification: `" [17] to queue`
const QUEUE_END = /"\s*\[\d+\] to queue/
const RE_TS = /^<([0-9T:\-.Z]+)>/
const RE_MISSION_ID = /MissionId: \[([^\]]*)\]/
const RE_MARKER = /missionId \[([^\]]+)\].*?generator name \[([^\]]*)\].*?contract \[([^\]]*)\]/
const RE_MARKER_POS =
  /objectiveId \[([^\]]*)\].*?zoneHostId \[(\d+)\], position \[x: (-?[\d.]+(?:e[-+]?\d+)?), y: (-?[\d.]+(?:e[-+]?\d+)?), z: (-?[\d.]+(?:e[-+]?\d+)?)\]/
const RE_OBJECTIVE_ID = /ObjectiveId: \[([^\]]*)\]/
const RE_BUILD = /BackupNameAttachment=".*?Build\((\d+)\)/
const RE_SHARED = /ownerId\[([^\]]+)\].*?missionId\[([^\]]+)\]/
const RE_END = /MissionId\[([^\]]+)\].*?CompletionType\[(\w+)\](?:.*?Reason\[([^\]]*)\])?/
// "[313 Rep]" or a range "[100–500 Rep]" / "[100-500 Rep]" / "[1,000 – 2,500 Rep]" (en/em dash or hyphen)
const RE_REP = /\[\s*([\d,]+)(?:\s*[-–—]\s*([\d,]+))?\s*Rep\b/i

// "<EM4>[313 Rep]</EM4>" and "<EM4>[BP]</EM4>" go whole; other EM tags keep their text
export function cleanAcceptTitle(raw: string): string {
  return cleanTitle(raw.replace(/<EM\d*>\s*\[[^\]]*\]\s*<\/EM\d*>/gi, '').replace(/<[^>]+>/g, ''))
}

/** notification text without markup and the log's trailing ": " */
const cleanText = (s: string): string =>
  s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/[\s:]+$/, '').trim()

const missionIdOf = (line: string): string | undefined => {
  const id = RE_MISSION_ID.exec(line)?.[1]
  return id && id !== ZERO_ID ? id : undefined
}

export function createOtherLineParser(opts: OtherLineParserOptions = {}): OtherLineParser {
  const onTrace = opts.onTrace
  const markers = new Map<string, { generator: string; contractName: string }>()
  const sharedBy = new Map<string, string>()
  // a notification whose text has a newline: the next line carries `: " [N] to queue … MissionId`
  let pending: string | null = null
  let pendingLines = 0
  let build: string | undefined

  const notification = (at: string, line: string): OtherLogEvent | null => {
    const start = line.indexOf(ADDED) + ADDED.length
    const close = QUEUE_END.exec(line)
    if (!close || close.index < start) return null
    const body = line.slice(start, close.index)

    if (onTrace) {
      const handled = HANDLED.some((h) => body.startsWith(h)) || (body.startsWith('Contract Not Accepted:') && body.includes('Contract Limit Exceeded'))
      if (!handled && (MISSIONISH.test(body) || missionIdOf(line))) {
        const known = knownLabel(body)
        const data = { text: cleanText(body).slice(0, 200), missionId: missionIdOf(line) }
        onTrace({ what: known ? `ignored: known (${known})` : 'unknown', line, kind: 'notification', data })
      }
    }

    if (body.startsWith('Contract Accepted:')) {
      const missionId = missionIdOf(line)
      if (!missionId) {
        onTrace?.({ what: 'ignored: zero/missing mission id', line, kind: 'accepted' })
        return null
      }
      const raw = body.slice('Contract Accepted:'.length)
      const title = cleanAcceptTitle(raw)
      const repM = RE_REP.exec(raw)
      const marker = markers.get(missionId)
      const ev: OtherLogEvent = {
        kind: 'accepted',
        at,
        missionId,
        title,
        isHauling: isHaulingContract(marker?.generator ?? '', marker?.contractName ?? '', title)
      }
      if (repM) {
        ev.rep = parseInt(repM[1].replace(/,/g, ''), 10)
        const high = repM[2] ? parseInt(repM[2].replace(/,/g, ''), 10) : NaN
        if (high > ev.rep) ev.repMax = high
      }
      if (marker?.generator) ev.generator = marker.generator
      if (marker?.contractName) ev.contractName = marker.contractName
      const owner = sharedBy.get(missionId)
      if (owner) ev.sharedBy = owner
      return ev
    }
    if (body.startsWith('New Objective:')) {
      const missionId = missionIdOf(line)
      const text = cleanText(body.slice('New Objective:'.length))
      if (!missionId || !text) {
        onTrace?.({ what: missionId ? 'ignored: empty objective text' : 'ignored: zero/missing mission id', line, kind: 'objective' })
        return null
      }
      // a New Objective wording the step parser doesn't know only gives a generic "go" step
      // (parseOtherObjectiveText's fallback: the whole text as both label and place)
      if (onTrace) {
        const g = parseOtherObjectiveText(text)
        if (!g || (g.kind === 'go' && !g.item && g.location === g.label)) {
          onTrace({ what: 'unknown', line, kind: 'objective', data: { text, missionId, generic: true } })
        }
      }
      const ev: OtherLogEvent = { kind: 'objective', at, missionId, text }
      const objectiveId = RE_OBJECTIVE_ID.exec(line)?.[1]
      if (objectiveId && objectiveId !== ZERO_ID) ev.objectiveId = objectiveId
      return ev
    }
    if (body.startsWith('Objective Complete:')) {
      const text = cleanText(body.slice('Objective Complete:'.length))
      return text ? { kind: 'objectiveComplete', at, missionId: missionIdOf(line), text } : null
    }
    if (body.startsWith('Objective Withdrawn:')) {
      const text = cleanText(body.slice('Objective Withdrawn:'.length))
      return text ? { kind: 'objectiveWithdrawn', at, missionId: missionIdOf(line), text } : null
    }
    if (body.startsWith('Contract Not Accepted:') && body.includes('Contract Limit Exceeded')) {
      return { kind: 'contractLimit', at }
    }
    return null
  }

  const feed = (line: string): OtherLogEvent | null => {
    if (line.charCodeAt(0) !== 60 /* < */) return null
    const ts = RE_TS.exec(line)
    if (!ts) return null
    const at = ts[1]

    if (pending !== null) {
      const joined = pending + ' ' + line.slice(ts[0].length)
      if (!QUEUE_END.test(joined) && ++pendingLines < 4) {
        pending = joined
        return null
      }
      pending = null
      return notification(at, joined)
    }

    if (line.includes(ADDED)) {
      if (!QUEUE_END.test(line)) {
        pending = line
        pendingLines = 0
        return null
      }
      return notification(at, line)
    }
    if (line.includes('<CLocalMissionPhaseMarker::CreateMarker>')) {
      const m = RE_MARKER.exec(line)
      if (!m) return null
      markers.set(m[1], { generator: m[2], contractName: m[3] })
      const p = RE_MARKER_POS.exec(line)
      if (!p) {
        onTrace?.({ what: 'remembered: marker without position', line, kind: 'marker', data: { missionId: m[1], generator: m[2] } })
        return null
      }
      const [x, y, z] = [Number(p[3]), Number(p[4]), Number(p[5])]
      if (![x, y, z].every(Number.isFinite)) return null
      return { kind: 'marker', at, missionId: m[1], objectiveId: p[1], zoneHostId: p[2], x, y, z }
    }
    if (line.includes('<MissionShared>')) {
      const m = RE_SHARED.exec(line)
      if (m) sharedBy.set(m[2], m[1])
      onTrace?.({ what: m ? 'remembered: mission shared' : 'ignored: MissionShared unread', line, kind: 'shared' })
      return null
    }
    if (line.includes('<EndMission>')) {
      const m = RE_END.exec(line)
      if (!m) return null
      const ev: OtherLogEvent = {
        kind: 'ended',
        at,
        missionId: m[1],
        outcome: m[2] === 'Complete' ? 'complete' : 'abandoned',
        completionType: m[2]
      }
      if (m[3]) ev.reason = m[3]
      return ev
    }
    // the <Channel Process Disconnection> twin is skipped so one disconnect is one event
    if (line.includes('<Channel Disconnected>') && line.includes('Player requested disconnect')) {
      return { kind: 'disconnect', at }
    }
    // rule 5: console quit and closing the window end the game; other SystemQuit reasons don't
    if (line.includes('<SystemQuit>')) {
      if (line.includes('Quit via console command') || line.includes('User closed the application')) return { kind: 'quit', at }
      onTrace?.({ what: 'ignored: SystemQuit reason', line, kind: 'quit' })
      return null
    }
    if (line.includes('> Log started on')) return build ? { kind: 'session', at, build } : { kind: 'session', at }
    if (line.includes('BackupNameAttachment=')) {
      build = RE_BUILD.exec(line)?.[1] ?? build
      return null
    }
    if (onTrace && line.includes('<Channel Process Disconnection>')) {
      onTrace({ what: 'ignored: disconnect twin', line, kind: 'disconnect' })
    }
    return null
  }

  if (!onTrace) return { feed }
  return {
    feed(line: string): OtherLogEvent | null {
      const ev = feed(line)
      if (ev) {
        const missionId = 'missionId' in ev ? ev.missionId : undefined
        onTrace({ what: 'event', line, kind: ev.kind, data: missionId ? { missionId } : undefined })
      }
      return ev
    }
  }
}
