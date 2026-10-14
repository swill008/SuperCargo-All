// Other mode's own Game.log events. Live tailing and the start-up scan produce the same
// stream, and one reducer in the renderer applies it, so both paths behave the same.

export type OtherLogEvent =
  | { kind: 'session'; at: string } // "Log started on": a new game launch, used as the session id
  | {
      kind: 'accepted'
      at: string // log timestamp, ISO
      missionId: string
      title: string // cleaned, no <EM4> markup
      rep?: number // from "<EM4>[313 Rep]</EM4>" in the title
      generator?: string
      contractName?: string
      isHauling: boolean
      sharedBy?: string // ownerId of the most recent MissionShared push for this mission
    }
  | { kind: 'objective'; at: string; missionId: string; text: string } // raw "New Objective" text, no trailing colon
  | { kind: 'objectiveComplete'; at: string; missionId?: string; text: string } // "Objective Complete: …"
  | { kind: 'objectiveWithdrawn'; at: string; missionId?: string; text: string } // "Objective Withdrawn: …"
  | { kind: 'ended'; at: string; missionId: string; outcome: 'complete' | 'abandoned'; completionType: string; reason?: string }
  | { kind: 'contractLimit'; at: string } // "Contract Not Accepted: Contract Limit Exceeded"
  | { kind: 'disconnect'; at: string } // "Player requested disconnect": quit to menu or quit game, every contract ends
  | { kind: 'quit'; at: string } // "<SystemQuit> … Quit via console command": the game closed, every contract ends

// main -> renderer result of the start-up scan
export interface OtherScanResult {
  // events newer than the given watermark: the previous log in logbackups first (when newer
  // than the watermark), then the current Game.log, in log order
  events: OtherLogEvent[]
  files: string[] // which logs were read, for the debug log
  // how the previous game session ended, judged from the end of the newest logbackups file:
  // quit = it ends with SystemQuit; crash = it has contract activity but no SystemQuit; none = no previous log or nothing newer than the watermark
  previousEnd: 'quit' | 'crash' | 'none'
}

// Stateful line parser (CreateMarker and MissionShared lines carry data for the next accept).
export interface OtherLineParser {
  feed(line: string): OtherLogEvent | null
}
