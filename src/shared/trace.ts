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
  combinedImage?: string // <base>-all.png: every saved picture side by side (only when images were saved)
}

// COPY TEXT / COPY IMAGES buttons: copy the last export again (main reads it back from disk)
export interface DiagCopyTextResult {
  ok: boolean
  bytes?: number
  error?: string
}

export interface DiagCopyImagesResult {
  ok: boolean
  width?: number
  height?: number
  error?: string
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

// feedback next to the COPY buttons, e.g. "Text copied · 1.1 MB" / "Picture copied (3 in one)"
export function diagCopyTextLine(r: DiagCopyTextResult): string {
  if (!r.ok) return r.error || 'copy failed'
  return r.bytes != null ? `Text copied · ${fmtDiagBytes(r.bytes)}` : 'Text copied'
}

export function diagCopyImagesLine(r: DiagCopyImagesResult, count: number): string {
  if (!r.ok) return r.error || 'copy failed'
  return count > 1 ? `Picture copied (${count} in one)` : 'Picture copied'
}

// raw 4-byte-per-pixel bitmap (Electron's toBitmap order is BGRA; stitching doesn't care)
export interface Bitmap {
  width: number
  height: number
  bgra: Uint8Array
}

export const STITCH_GAP = 16

// pictures side by side, top-aligned, unscaled, STITCH_GAP px apart, on opaque black
export function stitchBitmaps(list: Bitmap[], gap = STITCH_GAP): Bitmap {
  const pics = list.filter((b) => b.width > 0 && b.height > 0 && b.bgra.length >= b.width * b.height * 4)
  const width = pics.reduce((w, b) => w + b.width, 0) + gap * Math.max(0, pics.length - 1)
  const height = pics.reduce((h, b) => Math.max(h, b.height), 0)
  const bgra = new Uint8Array(width * height * 4)
  for (let i = 3; i < bgra.length; i += 4) bgra[i] = 255
  let x0 = 0
  for (const b of pics) {
    const row = b.width * 4
    for (let y = 0; y < b.height; y++) bgra.set(b.bgra.subarray(y * row, y * row + row), (y * width + x0) * 4)
    x0 += b.width + gap
  }
  return { width, height, bgra }
}
