/** Other-mode Next page. Sorts open stops by UEX map distance from STARTING AT. */
import React, { useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import { Btn } from '@renderer/components/ui'
import Typeahead from '@renderer/components/Typeahead'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import {
  listOpenStops, formatMapDistance, formatDistance, stepActionLabel, stepActivePlace, formatPlaceWithBodySystem, routeTotal,
  resolveOrigin, groupByPlace, type OpenStopRow, type ListOrder
} from '@other/otherNext'
import { mergeLocations } from '../state/otherPlaces'
import { otherView, withoutWithdrawn, JobTags } from './JobsPartsStyles'

type OpenStop = OpenStopRow

const ORDER_LABEL: Record<ListOrder, string> = { distance: 'FROM START', route: 'ROUTE', manual: 'MANUAL' }
const CIRCLED = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465', '\u2466', '\u2467', '\u2468', '\u2469',
  '\u246a', '\u246b', '\u246c', '\u246d', '\u246e', '\u246f', '\u2470', '\u2471', '\u2472', '\u2473']
const circled = (n: number): string => CIRCLED[n - 1] ?? `#${n}`
const MARKER_TIP = 'from mission marker (estimate)'
const NO_DISTANCE_TEXT: Record<'not-in-uex' | 'no-start', string> = {
  'not-in-uex': 'Not found in UEX',
  'no-start': 'open station inventory or manually set a start'
}

/** short distance, "≈" prefix for marker-based ones */
function distText(m: number | null, source: OpenStopRow['distanceSource']): string {
  return `${source === 'marker' ? '\u2248' : ''}${formatDistance(m)}`
}

/** tooltip: exact distance, plus the marker note */
function distTip(m: number | null, source: OpenStopRow['distanceSource']): string {
  return `${formatMapDistance(m)}${source === 'marker' ? ` \u00b7 ${MARKER_TIP}` : ''}`
}

const placeKey = (p: string): string => p.toLowerCase().replace(/\s+/g, ' ').trim()

/** one card on the page: a job (JOB grouping) or a stop where you go next (LOCATION grouping) */
interface Group {
  key: string
  heading: string
  rows: OpenStopRow[]
  withdrawn: OpenStopRow[]
  /** location grouping only: heading is a place name to format with body/system */
  place: boolean
  distance: number | null
  leg: number | null
  distanceSource: OpenStopRow['distanceSource']
  noDistanceWhy: OpenStopRow['noDistanceWhy']
}

/** "<pickup> (pickup) → <dest>" or "→ N destinations" */
function pickupHeading(place: string, rows: OpenStopRow[], fmt: (p: string) => string): string {
  const dests = [...new Set(rows.map((r) => placeKey(r.dest)).filter(Boolean))]
  const to = dests.length > 1 ? `${dests.length} destinations` : fmt(rows[0]?.dest ?? '')
  return `${fmt(place)} (pickup) \u2192 ${to}`
}

export default function NextPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const typedStart = useOtherJobs((s) => s.startLocation)
  // where the game log says the player is (trace-other's store field)
  const currentLocation = useOtherJobs((s) => s.currentLocation)
  const currentLocationAt = useOtherJobs((s) => s.currentLocationAt)
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
  const markerDistance = otherSetting(settings, 'otherMarkerDistance')
  // typed STARTING AT wins; empty falls back to the log's current station (otherAutoStart)
  const origin = resolveOrigin({
    typed: typedStart,
    current: currentLocation,
    currentAt: currentLocationAt,
    autoStart: otherSetting(settings, 'otherAutoStart')
  })
  const autoStart = origin.kind === 'current' ? origin.name : null
  const startLocation = origin.name ?? ''
  const pinned = !!typedStart.trim()
  const station = currentLocation?.trim() || null
  const view = otherView(settings)
  // withdrawn steps are never next; 'grey' lists them dimmed under their group when showing all
  const liveJobs = useMemo(() => jobs.map(withoutWithdrawn), [jobs])
  const open = useMemo(
    () => listOpenStops(liveJobs, startLocation, locations, { showAll, hideCompleted, listOrder, jobOrder, markerDistance }),
    [liveJobs, startLocation, locations, showAll, hideCompleted, listOrder, jobOrder, markerDistance]
  )

  const groups = useMemo(() => {
    let all: Group[]
    if (groupBy === 'job') {
      const map = new Map<string, OpenStop[]>()
      for (const row of open) {
        const key = `${row.job.ref} ${row.job.title}`
        map.set(key, [...(map.get(key) ?? []), row])
      }
      all = [...map.entries()].map(([key, rows]) => {
        const lead = rows.find((r) => r.distance != null)
        return {
          key, heading: key, rows, withdrawn: [], place: false,
          distance: lead?.distance ?? null, leg: lead?.leg ?? null,
          distanceSource: lead?.distanceSource ?? null, noDistanceWhy: rows[0]?.noDistanceWhy ?? null
        }
      })
    } else {
      // one stop per place you go next (pickup or delivery); heading and distance are that place's
      all = groupByPlace(open).map((g) => ({
        key: placeKey(g.place) || g.rows[0]?.step.id || 'unspecified',
        heading: g.place.trim() || 'Unspecified location',
        rows: g.rows, withdrawn: [], place: true,
        distance: g.distance, leg: g.leg, distanceSource: g.distanceSource, noDistanceWhy: g.noDistanceWhy
      }))
    }
    if (showAll && view.withdrawn === 'grey') {
      const byKey = new Map(all.map((g) => [g.key, g]))
      for (const job of jobs) {
        if (job.status !== 'active') continue
        for (const step of job.steps) {
          if (!step.withdrawn) continue
          const key = groupBy === 'job' ? `${job.ref} ${job.title}` : placeKey(stepActivePlace(step))
          const g = byKey.get(key)
          if (!g) continue
          g.withdrawn.push({
            job, step, distance: null, leg: null, distanceSource: null, noDistance: false,
            place: stepActivePlace(step), pickup: false, dest: step.location, noDistanceWhy: null
          })
        }
      }
    }
    // groups whose stops all lack a distance go last, under their own divider
    const placed = all.filter((g) => !g.rows.every((r) => r.noDistance))
    const unplaced = all.filter((g) => g.rows.every((r) => r.noDistance))
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

  const fmtPlace = (p: string): string => formatPlaceWithBodySystem(p, locations)
  const renderGroup = (g: Group, gi: number): React.ReactElement => {
    const { rows, withdrawn } = g
    const pickup = g.place && rows.some((r) => r.pickup)
    const title = !g.place ? g.heading : pickup ? pickupHeading(g.heading, rows, fmtPlace) : fmtPlace(g.heading)
    const snapped = g.place
      ? rows.some((r) => (r.pickup ? r.step.pickupLocationSnapped : r.step.locationSnapped))
      : rows.some((r) => r.step.locationSnapped)
    const why = g.distance == null && g.noDistanceWhy ? NO_DISTANCE_TEXT[g.noDistanceWhy] : null
    return (
        <div
          key={g.key}
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
            <div style={{ fontFamily: F.display, fontSize: 16, color: snapped ? C.acc : C.text, flex: 1 }}>
              {title}
            </div>
            {groupBy === 'job' && rows[0] ? <JobTags rep={rows[0].job.rep} sharedBy={rows[0].job.sharedBy} view={view} /> : null}
            {g.distance != null ? (
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div title={distTip(g.distance, g.distanceSource)} style={{ fontFamily: F.mono, fontSize: 14, color: C.text }}>
                  {distText(g.distance, g.distanceSource)}
                </div>
                {g.leg != null ? (
                  <div title={formatMapDistance(g.leg)} style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {`+${formatDistance(g.leg)} from ${gi === 0 ? 'start' : circled(gi)}`}
                  </div>
                ) : null}
              </div>
            ) : why ? (
              <div style={{ fontFamily: F.body, fontSize: 11, color: C.dim, textAlign: 'right', flex: 'none', maxWidth: 220 }}>{why}</div>
            ) : null}
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
                    <span title={distTip(distance, distanceSource)}>{` \u00b7 ${distText(distance, distanceSource)}`}</span>
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
  }

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
        {total != null ? <Stat label="ROUTE" value={formatDistance(total)} title={formatMapDistance(total)} /> : null}
        <Stat
          label="NEAREST"
          value={!hasStart ? 'Set start' : nearest ? (nearest.place || nearest.step.label || '\u2014') : '\u2014'}
          sub={nearest ? distText(nearest.distance, nearest.distanceSource) : undefined}
          title={nearest ? distTip(nearest.distance, nearest.distanceSource) : undefined}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>STARTING AT</span>
        <AutoToggle
          pinned={pinned}
          station={station}
          onPin={() => { if (station) setStartLocation(station) }}
          onFollow={() => setStartLocation('')}
        />
        <div
          style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 380, position: 'relative' }}
          title={autoStart ? `${AUTO_TIP}${origin.stale ? ' \u00b7 last seen over 5 min ago' : ''}` : undefined}
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
            {`NO DISTANCE (${groups.unplaced.length}) \u00b7 ${NO_DISTANCE_TEXT['not-in-uex']}`}
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
const FOLLOW_TIP = 'Following your station from the game log \u2014 click to pin it'
const PINNED_TIP = 'Pinned \u2014 click to follow the game log again'
const NO_STATION_TIP = 'no station from the game log yet'

/** AUTO (empty start, follows the log's station) <-> PINNED (start set); click flips it */
export function AutoToggle({ pinned, station, onPin, onFollow }: {
  pinned: boolean
  station: string | null
  onPin: () => void
  onFollow: () => void
}): React.ReactElement {
  const disabled = !pinned && !station
  const color = disabled ? C.ghost : pinned ? C.acc : C.amber
  return (
    <Btn
      onClick={() => {
        if (disabled) return
        if (pinned) onFollow()
        else onPin()
      }}
      aria-disabled={disabled}
      title={disabled ? NO_STATION_TIP : pinned ? PINNED_TIP : FOLLOW_TIP}
      style={{
        fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color,
        border: `1px solid ${color}`, background: 'transparent', padding: '3px 8px', flex: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1
      }}
    >
      {pinned ? 'PINNED' : 'AUTO'}
    </Btn>
  )
}
