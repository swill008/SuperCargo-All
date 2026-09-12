/**
 * Compact overlay used only when Work mode = Other.
 * Same window as the haul overlay; different body so we never show box math.
 */
import React, { useMemo } from 'react'
import { C, F } from '../theme'
import { useStore } from '../state/store'
import { useOtherJobs } from '../state/otherJobs'
import { nextOpenStep } from '@shared/otherJob'

const WHITE = '#eaf1f7'

export default function OtherOverlay(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const settings = useStore((s) => s.settings)
  const scale = settings.overlayScale || 1
  const opacity = settings.overlayOpacity ?? 0.85

  const open = useMemo(() => {
    return jobs
      .filter((j) => j.status === 'active')
      .map((j) => ({ job: j, step: nextOpenStep(j) }))
      .filter((x): x is { job: (typeof jobs)[0]; step: NonNullable<ReturnType<typeof nextOpenStep>> } => !!x.step)
  }, [jobs])

  const current = open[0]
  const upcoming = open[1]
  const total = Math.max(open.length, 1)

  return (
    <div
      style={{
        width: Math.round(332 * scale),
        padding: 10,
        background: `rgba(8,12,16,${opacity})`,
        border: `1px solid ${C.accBorder}`,
        borderRadius: 8,
        color: WHITE,
        fontFamily: F.body
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div
          style={{
            fontFamily: F.display,
            fontSize: 13,
            letterSpacing: '0.08em',
            color: C.acc,
            textTransform: 'uppercase'
          }}
        >
          {current?.step.location || current?.step.label || 'NO OPEN STOP'}
        </div>
        <div style={{ fontFamily: F.display, fontSize: 11, color: C.dim, letterSpacing: '0.08em' }}>
          STOP {current ? 1 : 0}/{total}
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
        SUPERCARGO · OTHER MODE
      </div>
    </div>
  )
}
