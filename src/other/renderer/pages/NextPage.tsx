/** Other-mode Next page. Sorts open stops by UEX map distance from STARTING AT. */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import { Btn } from '@renderer/components/ui'
import Typeahead from '@renderer/components/Typeahead'
import { useStore } from '@renderer/state/store'
import { useOtherJobs } from '../state/otherJobs'
import { type OtherJob, type OtherStep } from '@other/otherJob'
import { listOpenStops, distanceFromStart, formatMapDistance, stepActivePlace, stepActionLabel, formatPlaceWithBodySystem } from '@other/otherNext'
import { mergeLocations } from '../state/otherPlaces'

interface OpenStop { job: OtherJob; step: OtherStep }

export default function NextPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const startLocation = useOtherJobs((s) => s.startLocation)
  const setStartLocation = useOtherJobs((s) => s.setStartLocation)
  const groupBy = useOtherJobs((s) => s.groupBy)
  const setGroupBy = useOtherJobs((s) => s.setGroupBy)
  const toggleStep = useOtherJobs((s) => s.toggleStep)
  const showAll = !!useStore((s) => s.settings.overlayShowAllObjectives)
  const hideCompleted = useStore((s) => s.settings.overlayHideCompletedObjectives) !== false
  const haulLocs = useStore((s) => s.locations) ?? []
  const locations = useMemo(() => mergeLocations(haulLocs), [haulLocs])
  const names = useMemo(() => locations.map((l) => l.name).filter(Boolean), [locations])

  const open = useMemo(
    () => listOpenStops(jobs, startLocation, locations, { showAll, hideCompleted }),
    [jobs, startLocation, locations, showAll, hideCompleted]
  )

  const groups = useMemo(() => {
    const map = new Map<string, OpenStop[]>()
    for (const row of open) {
      const key = groupBy === 'job' ? `${row.job.ref} ${row.job.title}` : row.step.location.trim() || 'Unspecified location'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [open, groupBy])

  const nearest = open[0]
  const activeCount = jobs.filter((j) => j.status === 'active').length

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="NEXT"
        subtitle={`${activeCount} jobs \u00b7 ${open.length} open stops \u00b7 Other mode`}
        right={
          <div style={{ display: 'flex', border: `1px solid ${C.lineStrong}` }}>
            {(['location', 'job'] as const).map((id) => {
              const on = groupBy === id
              return (
                <Btn key={id} onClick={() => setGroupBy(id)} style={{
                  border: 0, background: on ? C.acc : 'transparent', color: on ? '#111' : C.ghost,
                  fontFamily: F.display, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', padding: '7px 12px', cursor: 'pointer'
                }}>{id.toUpperCase()}</Btn>
              )
            })}
          </div>
        }
      />
      <div style={{ display: 'flex', gap: 18, marginBottom: 22 }}>
        <Stat label="JOBS" value={String(activeCount)} />
        <Stat label="STOPS" value={String(open.length)} />
        <Stat label="NEAREST" value={startLocation.trim() ? (nearest?.step.location || nearest?.step.label || '\u2014') : 'Set start'} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>STARTING AT</span>
        <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 380 }}>
          <Typeahead
            value={startLocation}
            options={names}
            freeText={false}
            search
            maxResults={40}
            menuMinWidth={420}
            wrapMenu
            onSelect={setStartLocation}
            placeholder="Type city or station \u2014 e.g. New Babbage"
          />
        </div>
        <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>Type to search the full UEX list. Open list is only the first matches.</span>
        {startLocation && (
          <Btn onClick={() => setStartLocation('')} style={{
            border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim,
            fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', padding: '6px 10px', cursor: 'pointer'
          }}>CLEAR</Btn>
        )}
      </div>
      {groups.length === 0 && <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim }}>No open stops. Add a job on the Jobs tab.</div>}
      {groups.map(([heading, rows], gi) => (
        <div key={heading} style={{ marginBottom: 14, border: `1px solid ${C.accBorder}`, background: C.accFill, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', border: `1px solid ${C.acc}`, color: C.acc,
              fontFamily: F.display, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none'
            }}>{gi + 1}</span>
            <div style={{ fontFamily: F.display, fontSize: 16, color: rows.some((r) => r.step.locationSnapped) ? C.acc : C.text }}>
              {groupBy === 'job' ? heading : formatPlaceWithBodySystem(heading, locations)}
            </div>
          </div>
          {rows.map(({ job, step }) => (
            <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '6px 0 2px 32px' }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 14, color: C.textBody }}>{step.label}</div>
                {step.location ? (
                  <div
                    title={step.locationSnapped && step.locationRaw ? `Log: ${step.locationRaw}` : undefined}
                    style={{
                      fontFamily: F.body,
                      fontSize: 12,
                      color: step.locationSnapped ? C.acc : C.dim,
                      marginTop: 2
                    }}
                  >{formatPlaceWithBodySystem(step.location, locations)}</div>
                ) : null}
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, marginTop: 2 }}>
                  {job.ref}
                  {startLocation.trim() ? ` \u00b7 ${formatMapDistance(distanceFromStart(startLocation, stepActivePlace(step), locations))}` : ''}
                </div>
              </div>
              <Btn onClick={() => toggleStep(job.id, step.id)} style={{
                border: 0, background: C.acc, color: '#111',
                fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', padding: '8px 14px', cursor: 'pointer'
              }}>{stepActionLabel(step)}</Btn>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginTop: 4 }}>{value}</div>
    </div>
  )
}
