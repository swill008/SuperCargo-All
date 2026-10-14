/**
 * How sure a stop's place is (otherResolve StopPlace): "✓ exact", "≈ corrected", "📍 game marker"...
 * Colour from confidence on the WHERE AM I accuracy gradient. Only exact/marker can look green;
 * every other status is held to amber/red. Hover lists the evidence weighed.
 */
import React from 'react'
import { F } from '@renderer/theme'
import { matchWord, type StopPlace } from '@other/otherResolve'
import { formatDistance, formatPlaceNear, formatPlaceWithBodySystem } from '@other/otherNext'
import type { Location } from '@shared/types'
import { accuracyColor } from './AccuracyMeter'

const NORMAL = new Set<StopPlace['status']>(['exact', 'marker'])

/** tag colour: exact/marker on the full gradient; others capped at amber (5) */
export function matchColor(match: Pick<StopPlace, 'status' | 'confidence'>): string {
  const c = Number.isFinite(match.confidence) ? match.confidence : 0
  return accuracyColor(NORMAL.has(match.status) ? c : Math.min(c, 5))
}

/** tooltip: status, confidence, then each piece of evidence in the order weighed */
export function matchTip(match: StopPlace): string {
  const head = `${matchWord(match.status)} · confidence ${Math.round(match.confidence)}/10`
  const lines = match.evidence.map((e) => `${e.ok ? '+' : '−'} ${e.text}`)
  return [head, ...lines].join('\n')
}

/** "not sure: A or B?" for mismatch/unsure stops; null otherwise or with no candidates */
export function candidatesLine(match: StopPlace | undefined): string | null {
  if (!match || (match.status !== 'mismatch' && match.status !== 'unsure')) return null
  const names = [...new Set(match.candidates.map((c) => c.name).filter(Boolean))].slice(0, 3)
  if (!names.length) return null
  return `not sure: ${names.join(' or ')}?`
}

/**
 * The stop's place as shown everywhere: roster name with body/system, or for a generic site
 * "Security Compound · at Covalex Distribution Centre S1DC06 (4 km)" (distance only when > 1 km, from the marker).
 * Falls back to `fallback` when there is no match.
 */
export function stopPlaceText(match: StopPlace | undefined | null, fallback: string, locations: Location[]): string {
  if (!match) return formatPlaceWithBodySystem(fallback, locations)
  // a generic site's parent place: named in the contract, or nearest to the game marker
  const site = match.site
  if (site?.name) {
    const far = site.meters != null && site.meters > 1000 ? ` (${formatDistance(site.meters)})` : ''
    const parent = formatPlaceWithBodySystem(site.name, locations)
    const [head, ...chips] = parent.split(' \u00b7 ')
    return [`${(match.text || fallback).trim()} \u00b7 at ${head}${far}`, ...chips].join(' \u00b7 ')
  }
  return formatPlaceNear(match.label || match.text || fallback, match.near, locations)
}

export function MatchTag({ match }: { match?: StopPlace | null }): React.ReactElement | null {
  if (!match) return null
  const col = matchColor(match)
  return (
    <span
      title={matchTip(match)}
      style={{
        fontFamily: F.body, fontSize: 10, letterSpacing: '0.04em', color: col,
        border: `1px solid ${col}`, borderRadius: 2, padding: '0 4px', lineHeight: 1.4,
        flex: 'none', whiteSpace: 'nowrap', verticalAlign: 'middle', textTransform: 'none'
      }}
    >
      {matchWord(match.status)}
    </span>
  )
}
