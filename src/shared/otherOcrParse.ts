/**
 * Other-mode OCR text parser.
 * Uses Game.log-style objective lines, not haul SCU/box/pickup parseOcrText.
 *
 * mobiGlas wraps long objectives:
 *   Deliver 0/10 SCU of Recycled Material Composite to
 *   Sakura Sun Goldenrod Workcenter on microTech.
 * parseOtherOcrText joins those before matching.
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
    .replace(/^[\s<>|[\]•\-\u2013\u2014*]+/, '')
    .replace(/[:.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isContinuation(line: string): boolean {
  if (!line || SKIP.test(line)) return false
  if (OBJECTIVE_START.test(line)) return false
  return true
}

/** Structured Other objectives only. Noise lines return null. */
export function parseOtherOcrLine(raw: string): OtherOcrRow | null {
  const text = clean(raw)
  if (!text || text.length < 4 || SKIP.test(text)) return null

  let m = text.match(/Go\s+to\s+(.+)$/i)
  if (m) {
    const location = m[1].trim()
    return { kind: 'go', label: `Go to ${location}`, location, have: 0, need: 1 }
  }

  m = text.match(/Neutralize\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    return { kind: 'go', label: `Neutralize ${item}`, location: item, item, have: 0, need: 1 }
  }

  m = text.match(/^(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+)?(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const have = parseInt(m[1], 10)
    const need = parseInt(m[2], 10)
    const item = m[3].trim()
    const location = m[4].trim()
    return {
      kind: 'turnin',
      label: `Deliver ${have}/${need} ${item} to ${location}`,
      location,
      item,
      have,
      need
    }
  }

  m = text.match(/^(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+)?(.+)$/i)
  if (m) {
    const have = parseInt(m[1], 10)
    const need = parseInt(m[2], 10)
    const item = m[3].trim()
    return {
      kind: 'turnin',
      label: `Deliver ${have}/${need} ${item}`,
      location: '',
      item,
      have,
      need
    }
  }

  return null
}

function rowKey(r: OtherOcrRow): string {
  return `${r.kind}|${r.location.toLowerCase()}|${(r.item || '').toLowerCase()}`
}

/** Glue wrapped HUD lines, then parse. Max two continuation lines per objective. */
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
    const row = parseOtherOcrLine(line)
    if (!row) continue
    const key = rowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return { reward, rows }
}
