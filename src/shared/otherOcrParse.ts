/**
 * Other-mode OCR text parser.
 * Label is the full cleaned objective sentence from Primary Objectives.
 * Item / location / counts are still extracted when the line matches.
 */
import type { OtherObjectiveParse } from './otherLog'

const SKIP =
  /^(primary\s+)?(objectives?|details?|description|reputation|risk|reward|aUEC|max box|box size|pickup|drop-?off|contract|accepted|offered)$/i

const OBJECTIVE_START =
  /^(?:Deliver|Bring|Collect|Recover|Turn\s*in|Go\s+to|Neutralize)\b/i

export type OtherOcrRow = {
  kind: OtherObjectiveParse['kind']
  label: string
  location: string
  item?: string
  have: number
  need: number
}

export type OtherOcrParse = {
  reward: number
  rows: OtherOcrRow[]
}

function parseReward(text: string): number {
  const m = text.match(/(\d[\d,]*)\s*aUEC/i)
  if (!m) return 0
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function clean(line: string): string {
  return line
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[:.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isContinuation(line: string): boolean {
  if (!line || SKIP.test(line)) return false
  if (OBJECTIVE_START.test(line)) return false
  if (line.length < 3) return false
  return true
}

function row(kind: OtherOcrRow['kind'], text: string, location: string, extra: Partial<OtherOcrRow> = {}): OtherOcrRow {
  return { kind, label: text, location, have: 0, need: 1, ...extra }
}

/** Structured fields plus the full on-screen sentence as label. */
export function parseOtherOcrLine(raw: string): OtherOcrRow | null {
  const text = clean(raw)
  if (!text || text.length < 4 || SKIP.test(text)) return null

  let m = text.match(/Go\s+to\s+(.+)$/i)
  if (m) return row('go', text, m[1].trim())

  m = text.match(/Neutralize\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    return row('go', text, item, { item })
  }

  m = text.match(/(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+)?(.+?)\s+to\s+(.+)$/i)
  if (m) {
    return row('turnin', text, m[4].trim(), {
      item: m[3].trim(),
      have: parseInt(m[1], 10),
      need: parseInt(m[2], 10)
    })
  }

  m = text.match(/(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+)?(.+)$/i)
  if (m) {
    return row('turnin', text, '', {
      item: m[3].trim(),
      have: parseInt(m[1], 10),
      need: parseInt(m[2], 10)
    })
  }

  return null
}

function rowKey(r: OtherOcrRow): string {
  return `${r.kind}|${r.location.toLowerCase()}|${(r.item || '').toLowerCase()}`
}

export function parseOtherOcrText(rawText: string): OtherOcrParse {
  const reward = parseReward(rawText)
  const lines = rawText.split(/\r?\n/).map(clean).filter((l) => l.length > 0)
  const joined: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i]
    if (OBJECTIVE_START.test(text)) {
      let extra = 0
      while (extra < 2 && i + 1 < lines.length && isContinuation(lines[i + 1])) {
        text = `${text} ${lines[i + 1]}`
        i += 1
        extra += 1
      }
    }
    joined.push(text)
  }
  const rows: OtherOcrRow[] = []
  const seen = new Set<string>()
  for (const line of joined) {
    const parsed = parseOtherOcrLine(line)
    if (!parsed) continue
    const key = rowKey(parsed)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(parsed)
  }
  return { reward, rows }
}
