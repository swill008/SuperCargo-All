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

/** Leftover is not a commodity name if it still has verbs or a leading of. */
function cleanExtractedItem(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  s = s.replace(/^(?:SCU\s+of\s+|of\s+)/i, '').trim()
  if (!s) return ''
  if (/\b(?:bring|deliver|collect|recover|turn\s*in|go\s+to)\b/i.test(s)) return ''
  if (/[.]$/.test(s)) s = s.replace(/[.]+$/, '').trim()
  return s
}

function cleanExtractedLoc(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[.]+$/, '').trim()
}

/** Structured fields plus the full on-screen sentence as label. No vendor-specific rules. */
export function parseOtherOcrLine(raw: string): OtherOcrRow | null {
  const text = clean(raw)
  if (!text || text.length < 4 || SKIP.test(text)) return null

  let m = text.match(/Go\s+to\s+(.+)$/i)
  if (m) return row('go', text, cleanExtractedLoc(m[1]))

  m = text.match(/Neutralize\s+(.+)$/i)
  if (m) {
    const item = cleanExtractedItem(m[1])
    return row('go', text, item, item ? { item } : {})
  }

  // "Bring 0/1 of Item. Bring to Place" — two sentences, generic verbs only.
  m = text.match(
    /(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+|of\s+)?(.+?)\.\s*(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+to\s+(.+)$/i
  )
  if (m) {
    const item = cleanExtractedItem(m[3])
    return row('turnin', text, cleanExtractedLoc(m[4]), {
      item: item || undefined,
      have: parseInt(m[1], 10),
      need: parseInt(m[2], 10)
    })
  }

  m = text.match(/(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+)?(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const item = cleanExtractedItem(m[3])
    const loc = cleanExtractedLoc(m[4])
    return row('turnin', text, item ? loc : '', {
      item: item || undefined,
      have: parseInt(m[1], 10),
      need: parseInt(m[2], 10)
    })
  }

  m = text.match(/(?:Deliver|Bring|Collect|Recover|Turn\s*in)\s+(\d+)\s*\/\s*(\d+)\s+(?:SCU\s+of\s+|of\s+)?(.+)$/i)
  if (m) {
    const item = cleanExtractedItem(m[3])
    return row('turnin', text, '', {
      item: item || undefined,
      have: parseInt(m[1], 10),
      need: parseInt(m[2], 10)
    })
  }

  m = text.match(/(?:Deliver|Bring|Turn\s*in)\s+(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const item = cleanExtractedItem(m[1])
    const loc = cleanExtractedLoc(m[2])
    return row('turnin', text, loc, { item: item || undefined, have: 0, need: 1 })
  }

  m = text.match(/(?:Collect|Recover)\s+(.+?)\s+from\s+(.+)$/i)
  if (m) {
    const item = cleanExtractedItem(m[1])
    const loc = cleanExtractedLoc(m[2])
    return row('pickup', text, loc, { item: item || undefined, have: 0, need: 1 })
  }

  if (OBJECTIVE_START.test(text)) return row('go', text, '')
  return null
}

function rowKey(r: OtherOcrRow): string {
  return `${r.kind}|${r.label.toLowerCase()}`
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

/** Orison Relief / count-less objective lines from Stacie's 2026-09-16 capture. */
export const OTHER_OCR_LINE_CASES: Array<{ raw: string; kind: OtherOcrRow['kind']; location: string; item?: string }> = [
  { raw: 'Deliver Fresh Food to August Dunlow Spaceport.', kind: 'turnin', location: 'August Dunlow Spaceport', item: 'Fresh Food' },
  { raw: 'Collect Fresh Food from a Landing Pad Locker in New Babbage.', kind: 'pickup', location: 'a Landing Pad Locker in New Babbage', item: 'Fresh Food' },
  { raw: 'Deliver Medical Supplies to August Dunlow Spaceport.', kind: 'turnin', location: 'August Dunlow Spaceport', item: 'Medical Supplies' },
  { raw: 'Collect Medical Supplies from a Landing Pad Locker in New Babbage.', kind: 'pickup', location: 'a Landing Pad Locker in New Babbage', item: 'Medical Supplies' },
  { raw: 'Deliver 0/11 SCU of Aluminum to Everus Harbor', kind: 'turnin', location: 'Everus Harbor', item: 'Aluminum' }
]

export function checkOtherOcrLineFixtures(): string[] {
  const failures: string[] = []
  for (const c of OTHER_OCR_LINE_CASES) {
    const got = parseOtherOcrLine(c.raw)
    if (!got || got.kind !== c.kind || got.location !== c.location || (c.item && got.item !== c.item)) {
      failures.push(
        `"${c.raw}" → ${got?.kind}/${got?.item}/${got?.location} (want ${c.kind}/${c.item}/${c.location})`
      )
    }
  }
  return failures
}
