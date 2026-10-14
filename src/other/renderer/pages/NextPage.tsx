/** Other-mode Next page. Sorts open stops by UEX map distance from STARTING AT. */
import React, { useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import { Btn } from '@renderer/components/ui'
import Typeahead from '@renderer/components/Typeahead'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import { listOpenStops, formatMapDistance, stepActionLabel, formatPlaceWithBodySystem, routeTotal, type OpenStopRow, type ListOrder } from '@other/otherNext'
import { mergeLocations } from '../state/otherPlaces'
import { otherView, withoutWithdrawn, JobTags } from './JobsPartsStyles'

type OpenStop = OpenStopRow

const ORDER_LABEL: Record<ListOrder, string> = { distance: 'FROM START', route: 'ROUTE', manual: 'MANUAL' }
const CIRCLED = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465', '\u2466', '\u2467', '\u2468', '\u2469',
  '\u246a', '\u246b', '\u246c', '\u246d', '\u246e', '\u246f', '\u2470', '\u2471', '\u2472', '\u2473']
const circled = (n: number): string => CIRCLED[n - 1] ?? `#${n}`
const MARKER_TIP = 'from mission marker (estimate)'

/** "≈" prefix for marker-based distances */
function distText(m: number | null, source: OpenStopRow['distanceSource']): string {
  return `${source === 'marker' ? '\u2248' : ''}${formatMapDistance(m)}`
}

export default function NextPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const typedStart = useOtherJobs((s) => s.startLocation)
  // where the game log says the player is (trace-other's store field)
  const currentLocation = useOtherJobs((s) => s.currentLocation)
  const setStartLocation = useOtherJobs((s) => s.setStartLocation)
  const groupBy = useOtherJobs((s) => s.groupBy)
  const setGroupBy = useOtherJobs((s) => s.setGroupBy)
  const listOrder = useOtherJobs((s) => s.listOrder)
  const setListOrder = useOtherJobs((s) => s.setListOrder)
  const jobOrder = useOtherJobs((s) => s.jobOrder)
  const moveJob = useOtherJobs((s) => s.moveJob)
  const placeJob = useOtherJobs((s) => s.placeJob)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const toggleStep = useOtherJobs((s) => s.toggleStep)
  const showAll = !!useStore((s) => s.settings.overlayShowAllObjectives)
  const hideCompleted = useStore((s) => s.settings.overlayHideCompletedObjectives) !== false
  const haulLocs = useStore((s) => s.locations) ?? []
  const locations = useMemo(() => mergeLocations(haulLocs), [haulLocs])
  const names = useMemo(() => locations.map((l) => l.name).filter(Boolean), [locations])

  const settings = useStore((s) => s.settings)
  type Group = readonly [string, OpenStop[], OpenStop[]]
  const markerDistance = otherSetting(settings, 'otherMarkerDistance')
  // typed STARTING AT wins; empty falls back to the log's current station (otherAutoStart)
  const autoStart = !typedStart.trim() && otherSetting(settings, 'otherAutoStart') && currentLocation ? currentLocation : null
  const startLocation = autoStart ?? typedStart
  const view = otherView(settings)
  // withdrawn steps are never next; 'grey' lists them dimmed under their group when showing all
  const liveJobs = useMemo(() => jobs.map(withoutWithdrawn), [jobs])
  const open = useMemo(
    () => listOpenStops(liveJobs, startLocation, locations, { showAll, hideCompleted, listOrder, jobOrder, markerDistance }),
    [liveJobs, startLocation, locations, showAll, hideCompleted, listOrder, jobOrder, markerDistance]
  )

  const groups = useMemo(() => {
    const keyOf = (row: OpenStop): string =>
      groupBy === 'job' ? `${row.job.ref} ${row.job.title}` : row.step.location.trim() || 'Unspecified location'
    const map = new Map<string, OpenStop[]>()
    for (const row of open) {
      const key = keyOf(row)
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    const greyed = new Map<string, OpenStop[]>()
    if (showAll && view.withdrawn === 'grey') {
      for (const job of jobs) {
        if (job.status !== 'active') continue
        for (const step of job.steps) {
          if (!step.withdrawn) continue
          const key = keyOf({ job, step } as OpenStop)
          if (!map.has(key)) continue
          greyed.set(key, [...(greyed.get(key) ?? []), { job, step, distance: null, leg: null, distanceSource: null, noDistance: false }])
        }
      }
    }
    const all = [...map.entries()].map(([k, rows]) => [k, rows, greyed.get(k) ?? []] as const)
    // groups whose stops all lack a distance go last, under their own divider
    const placed = all.filter(([, rows]) => !rows.every((r) => r.noDistance))
    const unplaced = all.filter(([, rows]) => rows.every((r) => r.noDistance))
    return { placed, unplaced }
  }, [open, groupBy, jobs, showAll, view.withdrawn])

  const hasStart = !!startLocation.trim()
  const nearest = hasStart ? open.find((r) => r.distance != null) : undefined
  const total = routeTotal(open)
  const orderLine = listOrder === 'manual'
    ? 'Manual order'
    : !hasStart
      ? null
      : listOrder === 'route'
        ? `Route from ${startLocation.trim()}${autoStart ? ' (auto)' : ''} \u00b7 nearest next stop each time`
        : `Sorted by distance from ${startLocation.trim()}${autoStart ? ' (auto)' : ''} \u00b7 nearest first`
  const activeCount = jobs.filter((j) => j.status === 'active').length

  const renderGroup = ([heading, rows, withdrawn]: Group, gi: number): React.ReactElement => (
        <div
          key={heading}
          draggable={listOrder === 'manual' && groupBy === 'job'}
          onDragStart={(e) => {
            const id = rows[0]?.job.id
            if (!id) return
            setDragId(id)
            e.dataTransfer.setData('text/plain', id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (listOrder !== 'manual' || groupBy !== 'job') return
            e.preventDefault()
            const id = rows[0]?.job.id
            if (id) setOverId(id)
          }}
          onDragLeave={() => {
            if (overId === rows[0]?.job.id) setOverId(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            const from = e.dataTransfer.getData('text/plain') || dragId
            const to = rows[0]?.job.id
            if (from && to) placeJob(from, to)
            setDragId(null)
            setOverId(null)
          }}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          style={{
            marginBottom: 14,
            border: `1px solid ${overId === rows[0]?.job.id ? C.acc : C.accBorder}`,
            background: C.accFill,
            padding: '12px 14px',
            cursor: listOrder === 'manual' && groupBy === 'job' ? 'grab' : 'default'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', border: `1px solid ${C.acc}`, color: C.acc,
              fontFamily: F.display, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none'
            }}>{gi + 1}</span>
            <div style={{ fontFamily: F.display, fontSize: 16, color: rows.some((r) => r.step.locationSnapped) ? C.acc : C.text, flex: 1 }}>
              {groupBy === 'job' ? heading : formatPlaceWithBodySystem(heading, locations)}
            </div>
            {groupBy === 'job' && rows[0] ? <JobTags rep={rows[0].job.rep} sharedBy={rows[0].job.sharedBy} view={view} /> : null}
            {(() => {
              const lead = rows.find((r) => r.distance != null)
              if (!lead) return null
              return (
                <div title={lead.distanceSource === 'marker' ? MARKER_TIP : undefined} style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontFamily: F.mono, fontSize: 14, color: C.text }}>{distText(lead.distance, lead.distanceSource)}</div>
                  {lead.leg != null ? (
                    <div style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {`+${formatMapDistance(lead.leg)} from ${gi === 0 ? 'start' : circled(gi)}`}
                    </div>
                  ) : null}
                </div>
              )
            })()}
            {listOrder === 'manual' && groupBy === 'job' && rows[0] ? (
              <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
                <Btn onClick={() => moveJob(rows[0].job.id, -1)} style={{
                  border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.text,
                  fontFamily: F.display, fontSize: 11, padding: '4px 8px', cursor: 'pointer'
                }}>UP</Btn>
                <Btn onClick={() => moveJob(rows[0].job.id, 1)} style={{
                  border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.text,
                  fontFamily: F.display, fontSize: 11, padding: '4px 8px', cursor: 'pointer'
                }}>DOWN</Btn>
              </span>
            ) : null}
          </div>
          {rows.map(({ job, step, distance, distanceSource }) => (
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
                  {distance != null ? (
                    <span title={distanceSource === 'marker' ? MARKER_TIP : undefined}>{` \u00b7 ${distText(distance, distanceSource)}`}</span>
                  ) : ''}
                  {groupBy === 'location' ? <span style={{ marginLeft: 8 }}><JobTags rep={job.rep} sharedBy={job.sharedBy} view={view} /></span> : null}
                </div>
              </div>
              <Btn onClick={() => toggleStep(job.id, step.id)} style={{
                border: 0, background: C.acc, color: '#111',
                fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', padding: '8px 14px', cursor: 'pointer'
              }}>{stepActionLabel(step)}</Btn>
            </div>
          ))}
          {withdrawn.map(({ job, step }) => (
            <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '6px 0 2px 32px', opacity: 0.5 }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, textDecoration: 'line-through' }}>{step.label}</div>
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, marginTop: 2 }}>{job.ref}</div>
              </div>
              <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.ghost }}>WITHDRAWN</span>
            </div>
          ))}
        </div>
  )

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="NEXT"
        subtitle={`${activeCount} jobs \u00b7 ${open.length} open stops \u00b7 Other mode`}
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', border: `1px solid ${C.lineStrong}` }}>
            {(['distance', 'route', 'manual'] as const).map((id) => {
              const on = listOrder === id
              return (
                <Btn key={id} onClick={() => setListOrder(id)} style={{
                  border: 0, background: on ? C.acc : 'transparent', color: on ? '#111' : C.ghost,
                  fontFamily: F.display, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', padding: '7px 12px', cursor: 'pointer'
                }}>{ORDER_LABEL[id]}</Btn>
              )
            })}
          </div>
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
          </div>
        }
      />
      {orderLine ? (
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, margin: '-6px 0 14px' }}>{orderLine}</div>
      ) : (
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.amber, margin: '-6px 0 14px' }}>
          {'\u26a0 Set STARTING AT to sort by distance \u00b7 showing log order for now'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, marginBottom: 22, flexWrap: 'wrap' }}>
        <Stat label="JOBS" value={String(activeCount)} />
        <Stat label="STOPS" value={String(open.length)} />
        {total != null ? <Stat label="ROUTE" value={formatMapDistance(total)} /> : null}
        <Stat
          label="NEAREST"
          value={!hasStart ? 'Set start' : nearest ? (nearest.step.location || nearest.step.label || '\u2014') : '\u2014'}
          sub={nearest ? distText(nearest.distance, nearest.distanceSource) : undefined}
          title={nearest?.distanceSource === 'marker' ? MARKER_TIP : undefined}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>STARTING AT</span>
        <div
          style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 380, position: 'relative' }}
          title={autoStart ? AUTO_TIP : undefined}
        >
          <Typeahead
            value={typedStart}
            options={names}
            freeText={false}
            search
            maxResults={40}
            menuMinWidth={420}
            wrapMenu
            onSelect={setStartLocation}
            placeholder={autoStart ? `Auto: ${autoStart}` : 'Type city or station \u2014 e.g. New Babbage'}
          />
        </div>
        {autoStart ? <AutoTag /> : null}
        <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>Type to search the full UEX list. Open list is only the first matches.</span>
        {typedStart && (
          <Btn onClick={() => setStartLocation('')} style={{
            border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim,
            fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', padding: '6px 10px', cursor: 'pointer'
          }}>CLEAR</Btn>
        )}
      </div>
      {groups.placed.length + groups.unplaced.length === 0 && <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim }}>No open stops. Add a job on the Jobs tab.</div>}
      {groups.placed.map((g, gi) => renderGroup(g, gi))}
      {groups.unplaced.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 12px' }}>
          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>
            {`NO DISTANCE (${groups.unplaced.length}) \u00b7 place not in UEX and no marker`}
          </span>
          <span style={{ flex: 1, borderTop: `1px solid ${C.lineStrong}` }} />
        </div>
      ) : null}
      {groups.unplaced.map((g, i) => renderGroup(g, groups.placed.length + i))}
    </div>
  )
}

function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }): React.ReactElement {
  return (
    <div style={{ minWidth: 90 }} title={title}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

const AUTO_TIP = 'from the game log; type to override'

/** small tag beside STARTING AT while it follows the game log */
export function AutoTag(): React.ReactElement {
  return (
    <span
      title={AUTO_TIP}
      style={{
        fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color: C.amber,
        border: `1px solid ${C.amber}`, padding: '2px 6px', flex: 'none'
      }}
    >
      AUTO
    </span>
  )
}
