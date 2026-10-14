/** Other-mode Next page. Sorts open stops by UEX map distance from STARTING AT. */
import React, { useEffect, useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import { Btn } from '@renderer/components/ui'
import Typeahead from '@renderer/components/Typeahead'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import {
  listOpenStops, formatMapDistance, stepActionLabel, stepActivePlace, formatPlaceWithBodySystem, formatPlaceNear, routeTotal,
  resolveOrigin, groupByPlace, type OpenStopRow, type ListOrder
} from '@other/otherNext'
import { formatTravel } from '@other/otherGeo'
import type { WhereSource } from '@other/otherWhere'
import { useMergedLocations } from '../state/otherPlaces'
import { otherView, withoutWithdrawn, JobTags } from './JobsPartsStyles'
import { AccSlider, TrackedTag } from '../components/AccuracyMeter'
import { MatchTag, candidatesLine, stopPlaceText } from '../components/MatchTag'
import type { StopPlace } from '@other/otherResolve'
import { memoryKey } from '@other/otherMemory'
import { useMemoryLookup } from '../state/otherMemoryStore'

type OpenStop = OpenStopRow

const ORDER_LABEL: Record<ListOrder, string> = { distance: 'FROM START', route: 'ROUTE', manual: 'MANUAL' }
const CIRCLED = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465', '\u2466', '\u2467', '\u2468', '\u2469',
  '\u246a', '\u246b', '\u246c', '\u246d', '\u246e', '\u246f', '\u2470', '\u2471', '\u2472', '\u2473']
const circled = (n: number): string => CIRCLED[n - 1] ?? `#${n}`
/** what set the start */
const SOURCE_WORD: Record<WhereSource, string> = {
  typed: 'typed', tick: 'tick', objective: 'objective', inventory: 'inventory', map: 'map', displayinfo: 'display info'
}
const MARKER_TIP = 'from mission marker (estimate)'
const NO_DISTANCE_TEXT: Record<NonNullable<OpenStopRow['noDistanceWhy']>, string> = {
  'not-in-uex': 'Not found in UEX',
  'no-start': 'No start: type one, or open a station inventory',
  'no-gateway': 'No jump route to that system'
}

/** "12.3 Gm" / "≈490 km surface" / "38.0 Gm + 1 jump"; "≈" prefix for marker-based ones */
function distText(
  m: number | null,
  source: OpenStopRow['distanceSource'],
  jumps?: number,
  surface?: boolean
): string {
  const t = formatTravel(m == null ? null : { meters: m, jumps: jumps ?? 0, surface: !!surface })
  return source === 'marker' && !t.startsWith('\u2248') ? `\u2248${t}` : t
}

/** "2 min ago" style age of an ISO time */
function ago(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
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
  jumps?: number
  surface?: boolean
  legJumps?: number
  legSurface?: boolean
  /** location grouping only: the stop's resolved place (first row's) */
  match?: StopPlace
}

/** withdrawn rows are listed, never resolved */
const noMatch = (text: string): StopPlace => ({
  text, label: text, source: null, status: 'none', confidence: 0, evidence: [], candidates: [], memoryKey: memoryKey(text)
})

/** "<pickup> (pickup) → <dest>" or "→ N destinations"; `shown` is the pickup as displayed */
function pickupHeading(shown: string, rows: OpenStopRow[], fmt: (p: string) => string): string {
  const dests = [...new Set(rows.map((r) => placeKey(r.dest)).filter(Boolean))]
  const to = dests.length > 1 ? `${dests.length} destinations` : fmt(rows[0]?.dest ?? '')
  return `${shown} (pickup) \u2192 ${to}`
}

export default function NextPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const typedStart = useOtherJobs((s) => s.startLocation)
  const startTypedAt = useOtherJobs((s) => s.startTypedAt)
  // latest location clue (tick, objective, inventory, map, display info)
  const where = useOtherJobs((s) => s.where)
  const setStartLocation = useOtherJobs((s) => s.setStartLocation)
  // job the game tracks (from r_DisplayInfo)
  const trackedMissionId = useOtherJobs((s) => (s as { trackedMissionId?: string }).trackedMissionId)
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
  const locations = useMergedLocations()
  // user-set / learned places; identity changes with the memory doc so the list re-resolves
  const memory = useMemoryLookup()
  const names = useMemo(() => locations.map((l) => l.name).filter(Boolean), [locations])

  const settings = useStore((s) => s.settings)
  const markerDistance = otherSetting(settings, 'otherMarkerDistance')
  const startMode = otherSetting(settings, 'otherStartMode')
  const updateSettings = useStore((s) => s.updateSettings)
  // re-check once a minute so "N min ago" and stale move without a new clue
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  // auto: newer of typed start and latest clue; fixed: typed only
  const origin = useMemo(
    () => resolveOrigin({ typed: typedStart, typedAt: startTypedAt, where, mode: startMode, locations, now, memory }),
    [typedStart, startTypedAt, where, startMode, locations, now, memory]
  )
  const fromClue = origin.kind != null && origin.kind !== 'typed'
  // score from resolveOrigin; null for typed
  const originAcc = ((): number | null => {
    const a = (origin as { accuracy?: number | null }).accuracy
    return fromClue && typeof a === 'number' && Number.isFinite(a) ? a : null
  })()
  const originName = origin.label || origin.name || ''
  // name kept for fallbacks (roster lookup when there is no point)
  const startLocation = origin.name ?? ''
  const originPoint = origin.point
  // a read start (not typed) counts as "you are here" evidence for the resolver
  const originIsRead = origin.kind != null && origin.kind !== 'typed'
  const originAt = origin.kind === 'typed' ? startTypedAt : origin.kind ? where?.at : undefined
  const view = otherView(settings)
  // withdrawn steps are never next; 'grey' lists them dimmed under their group when showing all
  const liveJobs = useMemo(() => jobs.map(withoutWithdrawn), [jobs])
  const open = useMemo(
    () => listOpenStops(liveJobs, startLocation, locations, {
      showAll, hideCompleted, listOrder, jobOrder, markerDistance, origin: originPoint, originIsRead, memory
    }),
    [liveJobs, startLocation, originPoint, originIsRead, locations, showAll, hideCompleted, listOrder, jobOrder, markerDistance, memory]
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
          distanceSource: lead?.distanceSource ?? null, noDistanceWhy: rows[0]?.noDistanceWhy ?? null,
          jumps: lead?.jumps, surface: lead?.surface
        }
      })
    } else {
      // one stop per place you go next (pickup or delivery); heading and distance are that place's
      all = groupByPlace(open, locations).map((g) => ({
        key: placeKey(g.place) || g.rows[0]?.step.id || 'unspecified',
        heading: g.place.trim() || 'Unspecified location',
        rows: g.rows, withdrawn: [], place: true,
        distance: g.distance, leg: g.leg, distanceSource: g.distanceSource, noDistanceWhy: g.noDistanceWhy,
        jumps: g.jumps, surface: g.surface, legJumps: g.legJumps, legSurface: g.legSurface,
        match: g.match
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
            place: stepActivePlace(step), pickup: false, dest: step.location, noDistanceWhy: null,
            match: noMatch(stepActivePlace(step))
          })
        }
      }
    }
    // groups whose stops all lack a distance go last, under their own divider
    const placed = all.filter((g) => !g.rows.every((r) => r.noDistance))
    const unplaced = all.filter((g) => g.rows.every((r) => r.noDistance))
    return { placed, unplaced }
  }, [open, groupBy, jobs, showAll, view.withdrawn])

  const hasStart = !!(startLocation.trim() || originPoint)
  const nearest = hasStart ? open.find((r) => r.distance != null) : undefined
  const total = routeTotal(open)
  const orderLine = listOrder === 'manual'
    ? 'Manual order'
    : !hasStart
      ? null
      : listOrder === 'route'
        ? `Route from ${originName}${fromClue ? ' (auto)' : ''} \u00b7 nearest next stop each time`
        : `Sorted by distance from ${originName}${fromClue ? ' (auto)' : ''} \u00b7 nearest first`
  const activeCount = jobs.filter((j) => j.status === 'active').length

  const fmtPlace = (p: string): string => formatPlaceWithBodySystem(p, locations)
  const renderGroup = (g: Group, gi: number): React.ReactElement => {
    const { rows, withdrawn } = g
    const pickup = g.place && rows.some((r) => r.pickup)
    // a marker-placed stop says where it is ("· at <place>") instead of "Not found in UEX"
    const near = g.match ? g.match.near : rows.find((r) => r.near)?.near
    const shown = g.match ? stopPlaceText(g.match, g.heading, locations) : formatPlaceNear(g.heading, near, locations)
    const title = !g.place ? g.heading : pickup ? pickupHeading(shown, rows, fmtPlace) : shown
    const unsure = g.place ? candidatesLine(g.match) : null
    const snapped = g.place
      ? rows.some((r) => (r.pickup ? r.step.pickupLocationSnapped : r.step.locationSnapped))
      : rows.some((r) => r.step.locationSnapped)
    const why = g.distance == null && g.noDistanceWhy && !(near && g.noDistanceWhy === 'not-in-uex') ? NO_DISTANCE_TEXT[g.noDistanceWhy] : null
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
            <div style={{ fontFamily: F.display, fontSize: 16, color: snapped ? C.acc : C.text, flex: 1, minWidth: 0 }}>
              {title}
              {g.place && g.match ? <span style={{ marginLeft: 8 }}><MatchTag match={g.match} /></span> : null}
              {unsure ? <div style={{ fontFamily: F.body, fontSize: 12, color: C.amber, marginTop: 2 }}>{unsure}</div> : null}
            </div>
            {groupBy === 'job' && trackedMissionId && rows[0]?.job.missionId === trackedMissionId ? <TrackedTag /> : null}
            {groupBy === 'job' && rows[0] ? <JobTags rep={rows[0].job.rep} repMax={rows[0].job.repMax} sharedBy={rows[0].job.sharedBy} view={view} /> : null}
            {g.distance != null ? (
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div title={distTip(g.distance, g.distanceSource)} style={{ fontFamily: F.mono, fontSize: 14, color: C.text }}>
                  {distText(g.distance, g.distanceSource, g.jumps, g.surface)}
                </div>
                {g.leg != null ? (
                  <div title={formatMapDistance(g.leg)} style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {`+${distText(g.leg, null, g.legJumps, g.legSurface)} from ${gi === 0 ? 'start' : circled(gi)}`}
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
          {rows.map(({ job, step, distance, distanceSource, jumps, surface, near, pickup, match }) => (
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
                  >{!pickup && match ? stopPlaceText(match, step.location, locations) : formatPlaceNear(step.location, near && !pickup ? near : undefined, locations)}</div>
                ) : null}
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, marginTop: 2 }}>
                  {job.ref}
                  {trackedMissionId && job.missionId === trackedMissionId ? <span style={{ marginLeft: 8 }}><TrackedTag /></span> : null}
                  {distance != null ? (
                    <span title={distTip(distance, distanceSource)}>{` \u00b7 ${distText(distance, distanceSource, jumps, surface)}`}</span>
                  ) : ''}
                  {groupBy === 'job' && match ? <span style={{ marginLeft: 8 }}><MatchTag match={match} /></span> : null}
                  {groupBy === 'location' ? <span style={{ marginLeft: 8 }}><JobTags rep={job.rep} repMax={job.repMax} sharedBy={job.sharedBy} view={view} /></span> : null}
                </div>
                {/* location grouping says this once on the stop's heading */}
                {groupBy === 'job' && candidatesLine(match) ? (
                  <div style={{ fontFamily: F.body, fontSize: 12, color: C.amber, marginTop: 2 }}>{candidatesLine(match)}</div>
                ) : null}
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
        {total != null ? <Stat label="ROUTE" value={distText(total, null)} title={formatMapDistance(total)} /> : null}
        <Stat
          label="NEAREST"
          value={!hasStart ? 'Set start' : nearest ? (nearest.place || nearest.step.label || '\u2014') : '\u2014'}
          sub={nearest ? distText(nearest.distance, nearest.distanceSource, nearest.jumps, nearest.surface) : undefined}
          title={nearest ? distTip(nearest.distance, nearest.distanceSource) : undefined}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>STARTING AT</span>
        <StartModeToggle mode={startMode} onChange={(m) => { void updateSettings({ otherStartMode: m }) }} />
        <RefreshButton />
        <div
          style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 380, position: 'relative' }}
          title={fromClue ? `${AUTO_TIP}${origin.stale ? ' \u00b7 last seen over 5 min ago' : ''}` : undefined}
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
            placeholder={fromClue && originName ? `Auto: ${originName}` : 'Type city or station \u2014 e.g. New Babbage'}
          />
          {origin.kind ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 3 }}>
              <span style={{ fontFamily: F.body, fontSize: 11, color: origin.stale ? C.amber : C.dim }}>
                {`from: ${SOURCE_WORD[origin.kind]}${originAt ? ` \u00b7 ${ago(originAt, now)}` : ''}${origin.stale ? ' \u00b7 stale' : ''}`}
              </span>
              {originAcc != null ? <AccSlider score={originAcc} /> : null}
              {/* how sure the start's name is (one resolver; click to fix) */}
              <MatchTag match={origin.match} />
            </div>
          ) : null}
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

const AUTO_TIP = 'from your latest location clue; type to override'
const MODE_TIP: Record<'auto' | 'fixed', string> = {
  auto: 'AUTO \u2014 the newer of your typed start and your latest location (ticks, inventory, map)',
  fixed: 'FIXED \u2014 always the typed start; location clues are ignored'
}

/** AUTO <-> FIXED start mode (setting otherStartMode); click flips it */
export function StartModeToggle({ mode, onChange }: {
  mode: 'auto' | 'fixed'
  onChange: (m: 'auto' | 'fixed') => void
}): React.ReactElement {
  const fixed = mode === 'fixed'
  const color = fixed ? C.acc : C.amber
  return (
    <Btn
      onClick={() => onChange(fixed ? 'auto' : 'fixed')}
      title={`${MODE_TIP[mode]} \u00b7 click for ${fixed ? 'AUTO' : 'FIXED'}`}
      style={{
        fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color,
        border: `1px solid ${color}`, background: 'transparent', padding: '3px 8px', flex: 'none', cursor: 'pointer'
      }}
    >
      {fixed ? 'FIXED' : 'AUTO'}
    </Btn>
  )
}

const REFRESH_TIP = "Reload places and re-read your active contracts' map markers from the game log"

/** REFRESH: reload places + re-read active jobs' markers (store refreshJobs); result shown ~6 s */
export function RefreshButton(): React.ReactElement {
  const refreshJobs = useOtherJobs((s) => s.refreshJobs)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 6000)
    return () => clearTimeout(t)
  }, [result])

  const run = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await refreshJobs()
      setResult({ text: r.message, error: false })
    } catch (e) {
      setResult({ text: `Refresh failed \u00b7 ${e instanceof Error ? e.message : String(e)}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
      <Btn
        onClick={() => { void run() }}
        disabled={busy}
        title={REFRESH_TIP}
        style={{
          fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color: C.dim,
          border: `1px solid ${C.lineStrong}`, background: 'transparent', padding: '3px 8px', flex: 'none',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1
        }}
      >
        {busy ? 'REFRESHING\u2026' : 'REFRESH'}
      </Btn>
      {result ? (
        <span style={{ fontFamily: F.body, fontSize: 12, color: result.error ? C.red : C.dim }}>{result.text}</span>
      ) : null}
    </span>
  )
}
