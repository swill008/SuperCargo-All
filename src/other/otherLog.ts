/**
 * Map Game.log accept / objective lines onto Other-mode jobs.
 *
 * Haul generators stay with stock SuperCargo (isHaulingContract).
 * This file only classifies everything else.
 *
 * Objective forms checked against real Game.logs (2026-09, 2026-10); see parseOtherObjectiveText.
 */
import type { Location } from '@shared/types'
import { isHaulingContract } from '@shared/contract'
import type { OtherJobKind, OtherStep, OtherStepKind } from '@other/otherJob'
import { importPlace, type ResolveCtx } from '@other/otherResolve'

export type OtherObjectiveParse = {
  kind: OtherStepKind
  label: string
  location: string
  locationRaw?: string
  locationSnapped?: boolean
  pickupLocation?: string
  item?: string
  have: number
  need: number
}

export function kindFromGenerator(generator: string, title = '', contractName = ''): OtherJobKind {
  const g = generator.toLowerCase()
  const t = title.toLowerCase()
  if (isHaulingContract(generator, contractName, title) || /haul/.test(t)) return 'hauling'
  if (/salvage/.test(g) || /salvage/.test(t)) return 'salvage'
  if (/mining|resourcegathering/.test(g) && !/salvage/.test(g)) return 'mining'
  if (/recover|collector/.test(g) || /retriev|recover|ranta|collection/.test(t)) return 'collection'
  if (/refuel|wayfarer|courier|deliver/.test(g)) return 'delivery'
  return 'delivery'
}

const go = (label: string, location: string, item?: string): OtherObjectiveParse =>
  item ? { kind: 'go', label, location, item, have: 0, need: 1 } : { kind: 'go', label, location, have: 0, need: 1 }

/**
 * One objective sentence (log "New Objective" or OCR) to a step.
 * Forms seen in real logs: Deliver 0/N SCU of X to Y, Deliver X To Y, Collect X From Y,
 * Go to / Reach / Return to X, Neutralize X, Salvage the X at Y, Dock With X, Refuel X,
 * Clear X of All Hostiles, Locate Salvage Claim #N, Protect the Ship, Continue Search.
 * Place names keep inner full stops (NB Int. Spaceport); only the trailing one goes.
 */
export function parseOtherObjectiveText(raw: string): OtherObjectiveParse | null {
  const text = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/[\s:.]+$/, '').trim()
  if (!text) return null
  // "OPTIONAL: Neutralize …" parses as the rest, label keeps the prefix
  const opt = /^OPTIONAL:\s*/i.exec(text)
  const body = opt ? text.slice(opt[0].length) : text
  const pre = opt ? 'OPTIONAL: ' : ''

  let m = body.match(/^Deliver\s+(\d+)\s*\/\s*(\d+)\s+SCU\s+of\s+(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const have = parseInt(m[1], 10)
    const need = parseInt(m[2], 10)
    const item = m[3].trim()
    const location = m[4].trim()
    return { kind: 'turnin', label: `${pre}Deliver ${have}/${need} SCU of ${item} to ${location}`, location, item, have, need }
  }

  m = body.match(/^Deliver\s+(\d+)\s*\/\s*(\d+)\s+(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const have = parseInt(m[1], 10)
    const need = parseInt(m[2], 10)
    const item = m[3].trim()
    const location = m[4].trim()
    return { kind: 'turnin', label: `${pre}Deliver ${have}/${need} ${item} to ${location}`, location, item, have, need }
  }

  // "Deliver Medical Supplies To RSI Event Platform"
  m = body.match(/^(?:Deliver|Bring|Turn\s*in)\s+(.+?)\s+to\s+(.+)$/i)
  if (m) return { kind: 'turnin', label: text, location: m[2].trim(), item: m[1].trim(), have: 0, need: 1 }

  // "Collect Food Supplies From Green Glade Station at Hurston's L1 Lagrange point"
  m = body.match(/^(?:Collect|Recover)\s+(.+?)\s+from\s+(.+)$/i)
  if (m) return { kind: 'pickup', label: text, location: m[2].trim(), item: m[1].trim(), have: 0, need: 1 }

  m = body.match(/^Go\s+to\s+(.+)$/i)
  if (m) return go(`${pre}Go to ${m[1].trim()}`, m[1].trim())

  m = body.match(/^Travel\s+to\s+(.+?)(?:\s+and\b|$)/i)
  if (m) return go(text, m[1].trim())

  m = body.match(/^(?:Reach|Return\s+to)\s+(.+)$/i)
  if (m) return go(text, m[1].trim())

  // a target, never a place or a turn-in
  m = body.match(/^Neutralize\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    return /^targets$/i.test(item) ? go(text, '') : go(text, item, item)
  }

  m = body.match(/^Salvage\s+(?:the\s+)?(.+?)\s+at\s+(.+)$/i)
  if (m) return go(text, m[2].trim(), m[1].trim())

  m = body.match(/^Clear\s+(.+?)\s+of\s+all\s+hostiles$/i)
  if (m) return go(text, m[1].trim())

  // ship, claim or person, not a place
  m = body.match(/^(?:Dock\s+with|Refuel|Investigate)\s+(.+)$/i)
  if (m) return go(text, '', m[1].trim())
  if (/^(?:Locate\s+Salvage\s+Claim\b|Protect\s+the\s+Ship$|Continue\s+Search$)/i.test(body)) return go(text, '')

  return {
    kind: 'go',
    label: text,
    location: text,
    have: 0,
    need: 1
  }
}

const itemKey = (s?: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Fold nested Collect X from A under Deliver X to B when the item matches. */
export function mergeCollectIntoDeliver<T extends OtherObjectiveParse>(rows: T[]): T[] {
  const used = new Set<number>()
  const out: T[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.kind === 'pickup') continue
    if (row.kind === 'turnin' && itemKey(row.item)) {
      const key = itemKey(row.item)
      const cIdx = rows.findIndex((r, j) => !used.has(j) && r.kind === 'pickup' && itemKey(r.item) === key)
      if (cIdx >= 0) {
        used.add(cIdx)
        const collect = rows[cIdx]
        out.push({
          ...row,
          pickupLocation: collect.location,
          label: `${collect.label.replace(/[.]+$/, '')}. ${row.label}`
        })
        continue
      }
    }
    out.push(row)
  }
  rows.forEach((r, j) => {
    if (r.kind === 'pickup' && !used.has(j)) out.push(r)
  })
  return out
}

/** how an import resolves its places: match memory, and OCR misread rules for scanned text */
export interface ImportOpts {
  /** match memory lookup (renderer: currentMemoryLookup(); main: from matchMemory) */
  memory?: ResolveCtx['memory']
  /** text came from a screenshot scan */
  ocr?: boolean
}

/**
 * Places stay as read (locationRaw); `location` is the roster name only when the resolver is sure
 * (importPlace). Without a roster nothing is resolved.
 */
export function stepFromParse(id: string, parsed: OtherObjectiveParse, locations?: Location[], opts: ImportOpts = {}): OtherStep {
  const ctx: ResolveCtx | null = locations ? { locations, useMarker: false, memory: opts.memory } : null
  const place = (raw: string): { location: string; locationRaw: string; locationSnapped: boolean } =>
    ctx ? importPlace(raw, ctx, { ocr: opts.ocr, label: parsed.label }) : { location: raw, locationRaw: raw, locationSnapped: false }
  const snap = ctx
    ? place(parsed.locationRaw ?? parsed.location)
    : {
        location: parsed.location,
        locationRaw: parsed.locationRaw ?? parsed.location,
        locationSnapped: parsed.locationSnapped ?? false
      }
  const pickRaw = parsed.pickupLocation || ''
  const pick = pickRaw ? place(pickRaw) : null
  return {
    id,
    kind: parsed.kind,
    label: parsed.label,
    location: snap.location,
    locationRaw: snap.locationRaw,
    locationSnapped: snap.locationSnapped,
    pickupLocation: pick?.location,
    pickupLocationRaw: pick?.locationRaw,
    pickupLocationSnapped: pick?.locationSnapped,
    pickedUp: pick ? false : undefined,
    item: parsed.item,
    have: parsed.have,
    need: parsed.need,
    done: parsed.need > 0 && parsed.have >= parsed.need
  }
}

export function stepKey(step: Pick<OtherStep, 'kind' | 'location' | 'item'>): string {
  return `${step.kind}|${(step.location || '').toLowerCase()}|${(step.item || '').toLowerCase()}`
}

let logSeq = 0

/** A log "New Objective" text to a step; logText keeps the raw text for Complete / Withdrawn. */
export function stepFromObjectiveText(text: string, locations: Location[], opts: ImportOpts = {}): OtherStep {
  logSeq += 1
  const id = `step-${Date.now().toString(36)}-l${logSeq}`
  const label = text.replace(/[\s:]+$/, '').trim()
  const parsed = parseOtherObjectiveText(text) ?? { kind: 'go' as const, label, location: '', have: 0, need: 1 }
  return { ...stepFromParse(id, parsed, locations, opts), logText: text }
}

const textKey = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[\s:.]+$/, '').trim()

/** Index of the step an Objective Complete / Withdrawn text names, open steps first; -1 if none. */
export function findStepByText(steps: OtherStep[], text: string): number {
  const key = textKey(text)
  if (!key) return -1
  const hit = (s: OtherStep): boolean => (!!s.logText && textKey(s.logText) === key) || textKey(s.label) === key
  const open = steps.findIndex((s) => !s.done && !s.withdrawn && hit(s))
  return open >= 0 ? open : steps.findIndex(hit)
}
