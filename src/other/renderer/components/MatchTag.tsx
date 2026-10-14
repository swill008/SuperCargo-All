/**
 * How sure a stop's place is (otherResolve StopPlace): "✓ exact", "≈ corrected", "📍 game marker"...
 * Colour from confidence on the WHERE AM I accuracy gradient. Only exact/marker/you set/learned can look green;
 * every other status is held to amber/red. Hover lists the evidence weighed; click opens MatchFix.
 */
import React, { useCallback, useState } from 'react'
import { C, F } from '@renderer/theme'
import { matchWord, type StopPlace } from '@other/otherResolve'
import { formatDistance, formatPlaceNear, formatPlaceWithBodySystem } from '@other/otherNext'
import type { Location } from '@shared/types'
import { accuracyColor } from './AccuracyMeter'
import { MatchFix } from './MatchFix'

const NORMAL = new Set<StopPlace['status']>(['exact', 'marker', 'user', 'learned'])

/** tag colour: exact/marker/you set/learned on the full gradient; others (and disputed) capped at amber (5) */
export function matchColor(match: Pick<StopPlace, 'status' | 'confidence'> & Partial<Pick<StopPlace, 'memory'>>): string {
  const c = Number.isFinite(match.confidence) ? match.confidence : 0
  return accuracyColor(NORMAL.has(match.status) && !match.memory?.disputed ? c : Math.min(c, 5))
}

/** "⚠ the game disagrees · you were at X" for a disputed user entry; null otherwise */
export function disputedLine(match: StopPlace | undefined | null): string | null {
  if (!match?.memory?.disputed) return null
  const w = match.memory.wrongAt?.[0]
  if (!w?.name) return '\u26a0 the game disagrees'
  const where = w.meters != null && w.meters > 1000 ? `${formatDistance(w.meters)} from ${w.name}` : `at ${w.name}`
  return `\u26a0 the game disagrees \u00b7 you were ${where}`
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

/** the tag is a button: click (or Enter/Space) opens MatchFix to confirm, correct or forget the match */
export function MatchTag({ match }: { match?: StopPlace | null }): React.ReactElement | null {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  if (!match) return null
  const col = matchColor(match)
  const disputed = disputedLine(match)
  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        title={`${matchTip(match)}\n\nClick to fix this match`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          // rows and cards around the tag have their own click/drag handlers
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          fontFamily: F.body, fontSize: 10, letterSpacing: '0.04em', color: col, background: 'transparent',
          border: `1px solid ${col}`, borderRadius: 2, padding: '0 4px', lineHeight: 1.4, margin: 0,
          flex: 'none', whiteSpace: 'nowrap', verticalAlign: 'middle', textTransform: 'none', cursor: 'pointer',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        {matchWord(match.status)}
      </button>
      {disputed ? (
        <span style={{
          fontFamily: F.body, fontSize: 10, color: C.amber, marginLeft: 6, whiteSpace: 'nowrap',
          verticalAlign: 'middle', textTransform: 'none', letterSpacing: 'normal'
        }}>{disputed}</span>
      ) : null}
      {open ? <MatchFix match={match} anchor={anchor} onClose={close} /> : null}
    </>
  )
}
