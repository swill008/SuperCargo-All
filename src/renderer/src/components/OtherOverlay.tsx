/**
 * Compact overlay used only when Work mode = Other.
 * Same window as the haul overlay; different body so we never show box math.
 * Cycle arrows walk the open-stop list. Clicks need overlay click-through OFF.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { C, F } from '../theme'
import { useStore } from '../state/store'
import { useOtherJobs } from '../state/otherJobs'
import { mergeLocations } from '../state/otherPlaces'
import { listOpenStops } from '@shared/otherNext'

const WHITE = '#eaf1f7'

export default function OtherOverlay(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const startLocation = useOtherJobs((s) => s.startLocation)
  const settings = useStore((s) => s.settings)
  const haulLocs = useStore((s) => s.locations) ?? []
  const locations = useMemo(() => mergeLocations(haulLocs), [haulLocs])
  const opacity = settings.overlayOpacity ?? 0.85
  const [idx, setIdx] = useState(0)

  const open = useMemo(
    () => listOpenStops(jobs, startLocation, locations),
    [jobs, startLocation, locations]
  )

  useEffect(() => {
    setIdx(0)
  }, [startLocation])

  useEffect(() => {
    if (idx >= open.length) setIdx(Math.max(0, open.length - 1))
  }, [idx, open.length])

  const current = open[idx]
  const upcoming = open[idx + 1]
  const total = open.length
  const shown = current ? idx + 1 : 0
  const canPrev = idx > 0
  const canNext = idx < total - 1

  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: 10,
        background: `rgba(8,12,16,${opacity})`,
        border: `1px solid ${C.accBorder}`,
        borderRadius: 8,
        color: WHITE,
        fontFamily: F.body,
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {current && (
            <span style={{
              width: 22, height: 22, borderRadius: '50%', border: `1px solid ${C.acc}`, color: C.acc,
              fontFamily: F.display, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none'
            }}>{shown}</span>
          )}
          <div
            style={{
              fontFamily: F.display,
              fontSize: 13,
              letterSpacing: '0.08em',
              color: C.acc,
              textTransform: 'uppercase',
              minWidth: 0
            }}
          >
            {current?.step.location || current?.step.label || 'NO OPEN STOP'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => setIdx((n) => Math.max(0, n - 1))}
            style={{
              background: 'transparent',
              border: `1px solid ${C.accBorder}`,
              color: canPrev ? C.acc : C.ghost,
              width: 22,
              height: 22,
              padding: 0,
              cursor: canPrev ? 'pointer' : 'default',
              fontFamily: F.display,
              fontSize: 12
            }}
          >
            {'\u2039'}
          </button>
          <div style={{ fontFamily: F.display, fontSize: 11, color: C.dim, letterSpacing: '0.08em' }}>
            STOP {shown}/{Math.max(total, 1)}
          </div>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setIdx((n) => Math.min(total - 1, n + 1))}
            style={{
              background: 'transparent',
              border: `1px solid ${C.accBorder}`,
              color: canNext ? C.acc : C.ghost,
              width: 22,
              height: 22,
              padding: 0,
              cursor: canNext ? 'pointer' : 'default',
              fontFamily: F.display,
              fontSize: 12
            }}
          >
            {'\u203a'}
          </button>
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.16em', color: '#8fe9b0', marginBottom: 8 }}>
        GO HERE
      </div>
      {current ? (
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{current.step.label}</div>
      ) : (
        <div style={{ fontSize: 13, color: C.dim }}>Add an Other-mode job in the main window.</div>
      )}
      {upcoming && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.dim }}>then {upcoming.step.location || upcoming.step.label}</div>
      )}
      <div
        style={{
          marginTop: 14,
          fontFamily: F.display,
          fontSize: 10,
          letterSpacing: '0.16em',
          color: C.ghost
        }}
      >
        SUPERCARGO \u00b7 OTHER MODE
      </div>
    </div>
  )
}
