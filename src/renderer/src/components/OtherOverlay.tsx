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
import { listOpenStops, stepActivePlace, stepActionLabel } from '@shared/otherNext'
import { miniBtn } from '../pages/JobsPartsStyles'

const WHITE = '#eaf1f7'

export default function OtherOverlay(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const startLocation = useOtherJobs((s) => s.startLocation)
  const toggleStep = useOtherJobs((s) => s.toggleStep)
  const abandonJob = useOtherJobs((s) => s.abandonJob)
  const settings = useStore((s) => s.settings)
  const haulLocs = useStore((s) => s.locations) ?? []
  const locations = useMemo(() => mergeLocations(haulLocs), [haulLocs])
  const opacity = settings.overlayOpacity ?? 0.85
  const returnToFirst = settings.overlayReturnToFirst !== false
  const returnSeconds = Math.max(0, Math.min(20, settings.overlayReturnSeconds ?? 8))
  const [idx, setIdx] = useState(0)

  const showAll = !!settings.overlayShowAllObjectives
  const hideCompleted = settings.overlayHideCompletedObjectives !== false
  const open = useMemo(
    () => listOpenStops(jobs, startLocation, locations, { showAll, hideCompleted }),
    [jobs, startLocation, locations, showAll, hideCompleted]
  )

  useEffect(() => {
    setIdx(0)
  }, [startLocation])

  useEffect(() => {
    if (idx >= open.length) setIdx(Math.max(0, open.length - 1))
  }, [idx, open.length])

  useEffect(() => {
    if (!returnToFirst || idx <= 0) return
    const timer = window.setTimeout(() => setIdx(0), returnSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [idx, returnToFirst, returnSeconds])

  const current = open[idx]
  const upcoming = open[idx + 1]
  const total = open.length
  const shown = current ? idx + 1 : 0
  const canPrev = idx > 0
  const canNext = idx < total - 1

  return (
    <div
      style={{
        position: 'fixed',
        inset: 3,
        display: 'flex',
        flexDirection: 'column',
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
            title={current?.step.locationSnapped && current.step.locationRaw ? `Log: ${current.step.locationRaw}` : undefined}
            style={{
              fontFamily: F.display,
              fontSize: 13,
              letterSpacing: '0.08em',
              color: current?.step.locationSnapped ? C.acc : WHITE,
              textTransform: 'uppercase',
              minWidth: 0
            }}
          >
            {current ? stepActivePlace(current.step) || current.step.label : 'NO OPEN STOP'}
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
      {current ? (
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>
          {current.job.reward > 0 ? (
            <div>{current.job.reward.toLocaleString()} aUEC</div>
          ) : null}
          <div>{current.step.label}</div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.dim }}>Add an Other-mode job in the main window.</div>
      )}
      {upcoming && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.dim }}>then {upcoming.step.location || upcoming.step.label}</div>
      )}
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 10,
          flex: 'none'
        }}
      >
        {current && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => toggleStep(current.job.id, current.step.id)}
              style={{ ...miniBtn, color: C.text, flex: 'none' }}
            >
              {stepActionLabel(current.step)}
            </button>
            <button
              type="button"
              onClick={() => abandonJob(current.job.id)}
              style={{ ...miniBtn, color: C.text, flex: 'none' }}
            >
              ABANDON
            </button>
          </div>
        )}
        <div
          style={{
            marginLeft: 'auto',
            fontFamily: F.display,
            fontSize: 10,
            letterSpacing: '0.16em',
            color: C.ghost,
            textAlign: 'right'
          }}
        >
          SUPERCARGO {'\u00b7'} OTHER MODE
        </div>
      </div>
    </div>
  )
}
