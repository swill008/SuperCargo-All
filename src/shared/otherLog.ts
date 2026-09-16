/**
 * Map Game.log accept / objective lines onto Other-mode jobs.
 *
 * Haul generators stay with stock SuperCargo (isHaulingGenerator).
 * This file only classifies everything else.
 *
 * Tested against Stacie's LIVE Game.log (2026-09-12):
 *   Rayari_RecoverItem  → Deliver 0/5 Ranta Dung to Rayari Cantwell…
 *   Shubin_…FPSMining   → Deliver 0/56 Hadanite to Shubin…
 *   Adagio ship salvage → Deliver N SCU / Deliver N component
 *   Go to X / Neutralize X
 */
import type { Location } from './types'
import { isHaulingGenerator } from './contract'
import type { OtherJobKind, OtherStep, OtherStepKind } from './otherJob'
import { snapOtherLocation } from './otherLocationSnap'

export type OtherObjectiveParse = {
  kind: OtherStepKind
  label: string
  location: string
  locationRaw?: string
  locationSnapped?: boolean
  item?: string
  have: number
  need: number
}

/** Haul contracts must not become Other jobs. */
export function isOtherGenerator(generator: string | undefined | null): boolean {
  if (!generator) return false
  return !isHaulingGenerator(generator)
}

export function kindFromGenerator(generator: string, title = ''): OtherJobKind {
  const g = generator.toLowerCase()
  const t = title.toLowerCase()
  if (/salvage/.test(g) || /salvage/.test(t)) return 'salvage'
  if (/mining|resourcegathering/.test(g) && !/salvage/.test(g)) return 'mining'
  if (/recover|collector/.test(g) || /retriev|recover|ranta|collection/.test(t)) return 'collection'
  if (/refuel|wayfarer|courier|deliver/.test(g)) return 'delivery'
  return 'delivery'
}

export function parseOtherObjectiveText(raw: string): OtherObjectiveParse | null {
  const text = raw.replace(/<[^>]+>/g, '').replace(/[:.]+$/, '').trim()
  if (!text) return null

  let m = text.match(/^Go\s+to\s+(.+)$/i)
  if (m) {
    const location = m[1].trim()
    return { kind: 'go', label: `Go to ${location}`, location, have: 0, need: 1 }
  }

  m = text.match(/^Neutralize\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    return { kind: 'go', label: `Neutralize ${item}`, location: item, item, have: 0, need: 1 }
  }

  m = text.match(/^Deliver\s+(\d+)\s*\/\s*(\d+)\s+SCU\s+of\s+(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const have = parseInt(m[1], 10)
    const need = parseInt(m[2], 10)
    const item = m[3].trim()
    const location = m[4].trim()
    return {
      kind: 'turnin',
      label: `Deliver ${have}/${need} SCU of ${item} to ${location}`,
      location,
      item,
      have,
      need
    }
  }

  m = text.match(/^Deliver\s+(\d+)\s*\/\s*(\d+)\s+(.+?)\s+to\s+(.+)$/i)
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

  m = text.match(/^(?:Deliver|Bring|Turn\s*in)\s+(.+?)\s+to\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    const location = m[2].trim()
    return { kind: 'turnin', label: text, location, item, have: 0, need: 1 }
  }

  m = text.match(/^(?:Collect|Recover)\s+(.+?)\s+from\s+(.+)$/i)
  if (m) {
    const item = m[1].trim()
    const location = m[2].trim()
    return { kind: 'pickup', label: text, location, item, have: 0, need: 1 }
  }

  return {
    kind: 'go',
    label: text,
    location: text,
    have: 0,
    need: 1
  }
}

export function stepFromParse(id: string, parsed: OtherObjectiveParse, locations?: Location[]): OtherStep {
  const skipSnap = /^Neutralize\s/i.test(parsed.label)
  const snap = !skipSnap && locations
    ? snapOtherLocation(parsed.location, locations)
    : {
        location: parsed.location,
        locationRaw: parsed.locationRaw ?? parsed.location,
        locationSnapped: parsed.locationSnapped ?? false
      }
  return {
    id,
    kind: parsed.kind,
    label: parsed.label,
    location: snap.location,
    locationRaw: snap.locationRaw,
    locationSnapped: snap.locationSnapped,
    item: parsed.item,
    have: parsed.have,
    need: parsed.need,
    done: parsed.need > 0 && parsed.have >= parsed.need
  }
}

export function stepKey(step: Pick<OtherStep, 'kind' | 'location' | 'item'>): string {
  return `${step.kind}|${(step.location || '').toLowerCase()}|${(step.item || '').toLowerCase()}`
}
