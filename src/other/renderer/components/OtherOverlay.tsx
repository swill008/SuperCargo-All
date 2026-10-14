/**
 * Compact overlay used only when Work mode = Other.
 * Same window as the haul overlay; different body so we never show box math.
 * Cycle arrows walk the open-stop list. Clicks need overlay click-through OFF.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import { mergeLocations } from '../state/otherPlaces'
import {
  listOpenStops, stepActivePlace, stepActionLabel, formatPlaceWithBodySystem, formatMapDistance, formatDistance,
  resolveOrigin, groupByPlace, remainingRoute
} from '@other/otherNext'
import type { ListOrder } from '@other/otherNext'
import { miniBtn, otherView, withoutWithdrawn, JobTags } from '../pages/JobsPartsStyles'

const WHITE = '#eaf1f7'

const ORDER_HINT: Record<ListOrder, string> = { distance: 'FROM START', route: 'ROUTE', manual: 'MANUAL' }
// user-approved wording for a stop with no distance
const NO_DISTANCE_TEXT = { 'not-in-uex': 'Not found in UEX', 'no-start': 'open station inventory or manually set a start' } as const
const APPROX_TIP = 'Approximate: measured from the mission marker (no UEX coordinates for this place)'
/** ① ② ... for stop numbers up to 20 */
const circled = (n: number): string => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `#${n}`)
const hintStyle: React.CSSProperties = { fontFamily: F.display, fontSize: 9, letterSpacing: '0.12em', color: C.ghost }

export default function OtherOverlay(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const typedStart = useOtherJobs((s) => s.startLocation)
  // where the game log says the player is (trace-other's store field)
  const currentLocation = useOtherJobs((s) => s.currentLocation)
  const currentLocationAt = useOtherJobs((s) => s.currentLocationAt)
  // rule 8: the overlay only sends actions; the main window applies and saves them
  const toggleStep = (jobId: string, stepId: string): void => window.supercargo.otherAction({ type: 'toggleStep', jobId, stepId })
  const abandonJob = (jobId: string): void => window.supercargo.otherAction({ type: 'abandon', jobId })
  const settings = useStore((s) => s.settings)
  const haulLocs = useStore((s) => s.locations) ?? []
  const locations = useMemo(() => mergeLocations(haulLocs), [haulLocs])
  const opacity = settings.overlayOpacity ?? 0.85
  const returnToFirst = settings.overlayReturnToFirst !== false
  const returnSeconds = Math.max(0, Math.min(20, settings.overlayReturnSeconds ?? 8))
  const [idx, setIdx] = useState(0)

  const showAll = !!settings.overlayShowAllObjectives
  const hideCompleted = settings.overlayHideCompletedObjectives !== false
  const listOrder = useOtherJobs((s) => s.listOrder)
  const jobOrder = useOtherJobs((s) => s.jobOrder)
  const view = otherView(settings)
  const markerDistance = otherSetting(settings, 'otherMarkerDistance')
  const showDistance = otherSetting(settings, 'otherOverlayDistance')
  const autoStartOn = otherSetting(settings, 'otherAutoStart')
  // typed STARTING AT wins; empty falls back to the log's current station (otherAutoStart)
  // re-check once a minute so the current station turns stale without a new log line
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])
  const origin = useMemo(
    () => resolveOrigin({ typed: typedStart, current: currentLocation, currentAt: currentLocationAt, autoStart: autoStartOn }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedStart, currentLocation, currentLocationAt, autoStartOn, tick]
  )
  const startLocation = origin.name ?? ''
  // withdrawn steps never become the current stop
  const liveJobs = useMemo(() => jobs.map(withoutWithdrawn), [jobs])
  const open = useMemo(
    () => listOpenStops(liveJobs, startLocation, locations, { showAll, hideCompleted, listOrder, jobOrder, markerDistance }),
    [liveJobs, startLocation, locations, showAll, hideCompleted, listOrder, jobOrder, markerDistance]
  )
  // the overlay walks places: several steps at one station are one stop
  const groups = useMemo(() => groupByPlace(open), [open])

  useEffect(() => {
    setIdx(0)
  }, [startLocation])

  useEffect(() => {
    if (idx >= groups.length) setIdx(Math.max(0, groups.length - 1))
  }, [idx, groups.length])

  useEffect(() => {
    if (!returnToFirst || idx <= 0) return
    const timer = window.setTimeout(() => setIdx(0), returnSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [idx, returnToFirst, returnSeconds])

  const group = groups[idx]
  const nextGroup = groups[idx + 1]
  // actions and the objective line act on the group's first row
  const current = group?.rows[0]
  const upcoming = group?.rows[1] ?? nextGroup?.rows[0]
  const total = groups.length
  const shown = current ? idx + 1 : 0
  const canPrev = idx > 0
  const canNext = idx < total - 1
  const order: ListOrder = (listOrder as ListOrder) ?? 'distance'
  const orderHint = order !== 'manual' && !origin.name ? 'LOG ORDER' : ORDER_HINT[order]
  // stop 1 from the origin, later stops from the previous stop
  const legMeters = group ? (idx === 0 ? group.distance ?? group.leg : group.leg) : null
  const legApprox = group?.distanceSource === 'marker'
  const legFrom =
    idx > 0
      ? `from stop ${circled(idx)}`
      : origin.kind === 'current'
        ? origin.stale ? `from ${origin.name}` : `from you (${origin.name})`
        : 'from start'
  const noDistanceText = group && legMeters == null && group.noDistanceWhy ? NO_DISTANCE_TEXT[group.noDistanceWhy] : null
  const nextLeg = showDistance && nextGroup && nextGroup.leg != null ? nextGroup.leg : null
  const left = useMemo(() => remainingRoute(groups, idx), [groups, idx])

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
            {group && current
              ? formatPlaceWithBodySystem(group.place || stepActivePlace(current.step) || current.step.label, locations)
              : 'NO OPEN STOP'}
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
            <div style={{ fontFamily: F.display, fontSize: 11, color: C.dim, letterSpacing: '0.08em' }}>
              STOP {shown}/{Math.max(total, 1)}
            </div>
            <div style={hintStyle}>{orderHint}</div>
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
      {showDistance && group && (legMeters != null || noDistanceText) ? (
        <div style={{ marginTop: -6, marginBottom: 6 }}>
          {legMeters != null ? (
            <span
              title={`${formatMapDistance(legMeters)}${legApprox ? ` \u00b7 ${APPROX_TIP}` : ''}`}
              style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.06em', color: C.acc }}
            >
              {legApprox ? '\u2248 ' : ''}{formatDistance(legMeters)}
              <span style={{ ...hintStyle, marginLeft: 6, textTransform: 'none', letterSpacing: '0.04em' }}>{legFrom}</span>
            </span>
          ) : (
            <span style={{ fontSize: 11, color: C.ghost }}>{noDistanceText}</span>
          )}
        </div>
      ) : null}
      {current ? (
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>
          {current.job.reward > 0 ? `${current.job.reward.toLocaleString()} aUEC \u00b7 ` : ''}
          {current.step.label}
          {(view.showRep && current.job.rep) || (view.sharedBadge && current.job.sharedBy) ? (
            <span style={{ marginLeft: 8 }}><JobTags rep={current.job.rep} sharedBy={current.job.sharedBy} view={view} /></span>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.dim }}>Add an Other-mode job in the main window.</div>
      )}
      {(upcoming || nextGroup) && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.dim, lineHeight: 1.45 }}>
          {upcoming ? (
            <div>
              <span style={{ color: C.acc }}>Next Objective</span>
              <span>: {upcoming.step.label}</span>
            </div>
          ) : null}
          {nextGroup ? (
            <div style={{ marginTop: upcoming ? 4 : 0 }}>
              <span style={{ color: C.acc }}>Next Location</span>
              <span>: {formatPlaceWithBodySystem(nextGroup.place || stepActivePlace(nextGroup.rows[0].step), locations)}</span>
              {nextLeg != null ? (
                <span title={formatMapDistance(nextLeg)}>
                  {' \u00b7 '}{nextGroup.distanceSource === 'marker' ? '\u2248 ' : ''}{formatDistance(nextLeg)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {left.stops > 0 ? (
        <div style={{ ...hintStyle, letterSpacing: '0.06em', marginTop: 8 }} title={showDistance && left.distance != null ? formatMapDistance(left.distance) : undefined}>
          {left.stops} {left.stops === 1 ? 'stop' : 'stops'} left
          {showDistance && left.distance != null && left.stops > 1 ? ` \u00b7 ${formatDistance(left.distance)} route` : ''}
        </div>
      ) : null}
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
