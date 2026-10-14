/**
 * LEARNED DATA → Places → "Needs your eye" (S2): open stops whose place the app is not sure of
 * (unsure / guess / mismatch / none). Same stop list as Next (listOpenStops with memory, every open step);
 * the match tag opens MatchFix, so a fix here is the same write as anywhere else.
 */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { listOpenStops, resolveOrigin, type OpenStopRow } from '@other/otherNext'
import type { StopPlace } from '@other/otherResolve'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import { useMergedLocations } from '../state/otherPlaces'
import { useMemoryLookup } from '../state/otherMemoryStore'
import { MatchTag, candidatesLine } from './MatchTag'

const NEEDS = new Set<StopPlace['status']>(['unsure', 'guess', 'mismatch', 'none'])

/** open stops needing a look, one per job + stop text */
export function useNeedsYourEye(): OpenStopRow[] {
  const jobs = useOtherJobs((s) => s.jobs)
  const jobOrder = useOtherJobs((s) => s.jobOrder)
  const typed = useOtherJobs((s) => s.startLocation)
  const typedAt = useOtherJobs((s) => s.startTypedAt)
  const where = useOtherJobs((s) => s.where)
  const settings = useStore((s) => s.settings)
  const locations = useMergedLocations()
  const memory = useMemoryLookup()
  const startMode = otherSetting(settings, 'otherStartMode')
  const markerDistance = otherSetting(settings, 'otherMarkerDistance')
  return useMemo(() => {
    const origin = resolveOrigin({ typed, typedAt, where, mode: startMode, locations, memory })
    const live = jobs.map((j) => (j.steps.some((x) => x.withdrawn) ? { ...j, steps: j.steps.filter((x) => !x.withdrawn) } : j))
    const rows = listOpenStops(live, origin.name ?? '', locations, {
      showAll: true,
      hideCompleted: true,
      listOrder: 'manual',
      jobOrder,
      markerDistance,
      withdrawnSteps: 'hide',
      origin: origin.point,
      originIsRead: origin.kind != null && origin.kind !== 'typed',
      memory
    })
    const seen = new Set<string>()
    const out: OpenStopRow[] = []
    for (const r of rows) {
      const m = r.match
      if (!NEEDS.has(m.status) || !m.text.trim()) continue
      const k = `${r.job.id}|${m.memoryKey ?? m.text}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
    return out
  }, [jobs, jobOrder, typed, typedAt, where, startMode, markerDistance, locations, memory])
}

export default function NeedsYourEye({ highlight = false }: { highlight?: boolean }): React.ReactElement {
  const rows = useNeedsYourEye()
  return (
    <div
      id="learned-needs"
      data-testid="learned-needs"
      style={{
        margin: '14px 0 6px', padding: '10px 12px', scrollMarginTop: 12,
        border: `1px solid ${highlight ? C.acc : rows.length ? C.accBorder : C.lineSoft}`,
        background: rows.length ? 'rgba(255,210,30,0.05)' : 'transparent',
        transition: 'border-color 0.4s'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: F.display, fontSize: 14, letterSpacing: '0.14em', color: rows.length ? C.acc : C.dim }}>
          NEEDS YOUR EYE
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{rows.length}</span>
      </div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, margin: '2px 0 6px' }}>
        Stops on your current jobs whose place the app is not sure of. Click the tag to confirm or pick the right place.
      </div>
      {rows.length ? (
        rows.map((r) => {
          const m = r.match
          const maybe = candidatesLine(m)
          const guess = m.status === 'guess' ? m.match?.name ?? m.site?.name : undefined
          return (
            <div
              key={`${r.job.id}|${m.memoryKey ?? m.text}`}
              data-testid="learned-needs-row"
              data-key={m.memoryKey ?? ''}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: `1px dotted ${C.lineFaint}`, fontSize: 13 }}
            >
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                <span style={{ color: C.text }}>{m.text}</span>
                {guess ? <span style={{ color: C.dim }}>{` → ${guess}?`}</span> : null}
                {maybe ? <span style={{ color: C.amber, fontSize: 12, marginLeft: 8 }}>{maybe}</span> : null}
              </span>
              <span style={{ flex: 'none', fontFamily: F.mono, fontSize: 12, color: C.dim }} title={r.job.title}>{r.job.ref}</span>
              <span style={{ flex: 'none' }}><MatchTag match={m} /></span>
            </div>
          )
        })
      ) : (
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.green, padding: '2px 0' }}>Nothing right now: every open stop has a sure place.</div>
      )}
    </div>
  )
}
