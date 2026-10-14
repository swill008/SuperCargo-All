// diagnostics trace contract: what the app read, what it decided and how it performed.
// Written to userData/logs/trace.jsonl; EXPORT DIAGNOSTICS bundles it with a cleaned log excerpt.

export type TraceArea =
  | 'parse' // a Game.log line was turned into an event (or recognised but ignored)
  | 'unknown' // a notification/objective line nothing understood (new game wording)
  | 'decide' // what a reducer/store did with an event, and why
  | 'distance' // place -> UEX match / marker, distance, or why none
  | 'ocr' // text read -> rows parsed -> what was applied (never images)
  | 'perf' // timings, memory, CPU, event-to-screen latency
  | 'usage' // which pages/buttons/options are used (counts only)
  | 'error'

export type TraceMode = 'haul' | 'other' | 'both'

export interface TraceRecord {
  t: number // epoch ms
  area: TraceArea
  mode?: TraceMode // which side of the app this concerns
  src?: 'proc' | 'main' | 'overlay' | 'debug'
  what: string // short decision, e.g. "step added", "ignored: haul mode"
  line?: string // raw Game.log line (cleaned of player names/ids at export)
  missionId?: string
  ms?: number // duration, for perf
  data?: Record<string, unknown>
}

export interface DiagExportOptions {
  hours?: number // only the last N hours; default: this game session
  includeLogExcerpt?: boolean // default true: the cleaned Game.log lines the app used
  note?: string // "What went wrong?" text typed at export -> ## NOTE at the top (cleaned)
  includeImages?: boolean // default false: save OCR crops + an overlay picture next to the export (can't be cleaned)
  copyToClipboard?: boolean // set by main's IPC handler only (UI export): copy the saved text to the clipboard
}

export interface DiagExportResult {
  ok: boolean
  path?: string // the saved file
  bytes?: number
  error?: string
  images?: string[] // PNGs saved next to the export (only when includeImages)
  copied?: boolean // UI export: true = the saved text is on the clipboard, false = the copy failed
}

export function fmtDiagBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const LARGE_EXPORT = 1024 * 1024

// UI result line for a successful export, e.g. "Saved and copied · 1.4 MB · C:\...\diag.txt (large: ...)"
export function diagResultLine(r: DiagExportResult): string {
  const head = r.copied === true ? 'Saved and copied' : r.copied === false ? 'Saved (copy to clipboard failed)' : 'Saved'
  const parts = [head, ...(r.bytes != null ? [fmtDiagBytes(r.bytes)] : []), ...(r.path ? [r.path] : [])]
  const large = r.copied === true && r.bytes != null && r.bytes > LARGE_EXPORT ? ' (large: attaching the file may work better)' : ''
  return parts.join(' · ') + large
}
