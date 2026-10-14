/**
 * Compact overlay used only when Work mode = Other.
 * Same window as the haul overlay; different body so we never show box math.
 * Cycle arrows walk the open-stop list. Clicks need overlay click-through OFF.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { otherSetting } from '@other/workMode'
import { useOtherJobs } from '../state/otherJobs'
import { useMergedLocations, otherPlacesVersion } from '../state/otherPlaces'
import {
  listOpenStops, stepActivePlace, stepActionLabel, formatPlaceNear, formatMapDistance,
  resolveOrigin, groupByPlace, remainingRoute
} from '@other/otherNext'
import type { ListOrder } from '@other/otherNext'
import { formatTravel } from '@other/otherGeo'
import type { WhereRunResult, WhereSource } from '@other/otherWhere'
import { miniBtn, otherView, withoutWithdrawn, JobTags } from '../pages/JobsPartsStyles'
import { AccTag, TrackedTag } from './AccuracyMeter'
import { MatchTag, stopPlaceText } from './MatchTag'
import { stopIssue, issueTextStyle } from '../stopIssue'
import { useMemoryLookup } from '../state/otherMemoryStore'
import { setOverlayDiag, overlayDiag } from '../state/otherOverlayDiag'

/** a stop's key: its place, lower case, spaces collapsed (same as groupKey in otherNext) */
const stopKey = (g: { place: string }): string => g.place.toLowerCase().replace(/\s+/g, ' ').trim()

/** AFK keep-alive state (src/other/otherAfk.ts AfkState); preload methods may be missing mid-build */
interface AfkView { on: boolean; nextAt?: string; lastError?: string }
interface AfkApi {
  otherAfkStart?: () => Promise<AfkView>
  otherAfkStop?: () => Promise<AfkView>
  otherAfkGet?: () => Promise<AfkView>
  onOtherAfk?: (cb: (s: AfkView) => void) => (() => void) | void
}
const afkApi = (): AfkApi => window.supercargo as unknown as AfkApi
const AFK_ERR_MS = 6000
/** live reads stay silent until this many fail in a row */
const LIVE_FAIL_LIMIT = 3

const WHITE = '#eaf1f7'
// O1: fixed header line heights (px); the tags are ~16 px tall, so line 2 fits them
const HEAD_LINE1 = 18
const HEAD_LINE2 = 17

const ORDER_HINT: Record<ListOrder, string> = { distance: 'FROM START', route: 'ROUTE', manual: 'MANUAL' }
// user-approved wording for a stop with no distance
const NO_DISTANCE_TEXT = { 'not-in-uex': 'Not found in UEX', 'no-start': 'No start', 'no-gateway': 'No jump route to that system' } as const
/** what set the start, as the card shows it */
const SOURCE_WORD: Record<WhereSource, string> = {
  typed: 'typed', tick: 'tick', objective: 'objective', inventory: 'inventory', map: 'map', displayinfo: 'display info'
}
const WHERE_FAIL = "\ud83d\udccd Couldn't read the map, try again"
const LIVE_FAIL = '\ud83d\udccd Live position: no read for a while'
/** score from resolveOrigin (null = typed / unknown) */
const originAccuracy = (o: object): number | null => {
  const a = (o as { accuracy?: number | null }).accuracy
  return typeof a === 'number' && Number.isFinite(a) ? a : null
}
const WHERE_MSG_MS = 4000
/** "12.3 Gm" / "≈490 km surface" / "38.0 Gm + 1 jump"; ≈ prefix for marker-based */
const travelText = (m: number, jumps: number | undefined, surface: boolean | undefined, approx: boolean): string => {
  const t = formatTravel({ meters: m, jumps: jumps ?? 0, surface: !!surface })
  return approx && !t.startsWith('\u2248') ? `\u2248 ${t}` : t
}
const APPROX_TIP = 'Approximate: measured from the mission marker (no UEX coordinates for this place)'
/** ① ② ... for stop numbers up to 20 */
const circled = (n: number): string => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `#${n}`)
const hintStyle: React.CSSProperties = { fontFamily: F.display, fontSize: 9, letterSpacing: '0.12em', color: C.ghost }
// only the compact window answers for the overlay; the main window has its own responder (App.tsx)
const IS_OVERLAY_WINDOW = typeof window !== 'undefined' && window.location.hash === '#compact'

export default function OtherOverlay(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const typedStart = useOtherJobs((s) => s.startLocation)
  const startTypedAt = useOtherJobs((s) => s.startTypedAt)
  // latest location clue (tick, objective, inventory, map, display info)
  const where = useOtherJobs((s) => s.where)
  // rule 8: the overlay only sends actions; the main window applies and saves them
  const toggleStep = (jobId: string, stepId: string): void => window.supercargo.otherAction({ type: 'toggleStep', jobId, stepId })
  const abandonJob = (jobId: string): void => window.supercargo.otherAction({ type: 'abandon', jobId })
  const trackedMissionId = useOtherJobs((s) => (s as { trackedMissionId?: string }).trackedMissionId)
  const trackedAt = useOtherJobs((s) => (s as { trackedAt?: string }).trackedAt)
  const settings = useStore((s) => s.settings)
  const locations = useMergedLocations()
  // user-set / learned places (main owns the file; the overlay only reads and sends fixes)
  const memory = useMemoryLookup()
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
  const startMode = otherSetting(settings, 'otherStartMode')
  // auto: newer of typed start and latest clue; fixed: typed only
  // re-check once a minute so a clue turns stale without a new log line
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])
  const origin = useMemo(
    () => resolveOrigin({ typed: typedStart, typedAt: startTypedAt, where, mode: startMode, locations, memory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedStart, startTypedAt, where, startMode, locations, memory, tick]
  )
  // name kept for fallbacks (roster lookup when there is no point)
  const startLocation = origin.name ?? ''
  const originPoint = origin.point
  // a read start (not typed) counts as "you are here" evidence for the resolver
  const originIsRead = origin.kind != null && origin.kind !== 'typed'
  const hasStart = !!(origin.name || origin.point)
  // withdrawn steps never become the current stop
  const liveJobs = useMemo(() => jobs.map(withoutWithdrawn), [jobs])
  const open = useMemo(
    () => listOpenStops(liveJobs, startLocation, locations, {
      showAll, hideCompleted, listOrder, jobOrder, markerDistance, origin: originPoint, originIsRead, memory
    }),
    [liveJobs, startLocation, originPoint, originIsRead, locations, showAll, hideCompleted, listOrder, jobOrder, markerDistance, memory]
  )
  // the overlay walks places: several steps at one station are one stop
  const groups = useMemo(() => groupByPlace(open, locations), [open, locations])

  // set when the card jumped to the tracked job: the return-to-first timer leaves it there
  const heldByTrack = useRef(false)
  // back to stop 1 at once only when the start really changes (its name or kind) or the first stop in the order
  // changes, and only with "Return to first stop" on. Stable string keys: live reads at the same place and job-file
  // saves make new objects but the same keys, so they never move the card (user, 2026-10-14, option A).
  const startKey = `${origin.kind ?? ''}|${(origin.name ?? '').toLowerCase().trim()}`
  const firstStopKey = groups[0] ? stopKey(groups[0]) : ''
  // the card stays on the stop you chose, not on a list position: a live read can re-sort Distance/Route order, so
  // after every regroup the card follows the chosen stop's key; if that stop is gone the clamp below applies
  const chosenKey = useRef('')
  const chosenIndex = (): number => (chosenKey.current ? groups.findIndex((g) => stopKey(g) === chosenKey.current) : -1)
  useEffect(() => {
    const i = chosenIndex()
    if (i >= 0) {
      if (i !== idx) setIdx(i)
    } else if (groups.length) {
      chosenKey.current = stopKey(groups[Math.min(idx, groups.length - 1)])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])
  // any move (‹ ›, tracked jump, return timer, reset, clamp) remembers the stop now shown
  useEffect(() => {
    if (groups[idx]) chosenKey.current = stopKey(groups[idx])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])
  const lastKeys = useRef({ startKey, firstStopKey })
  useEffect(() => {
    const prev = lastKeys.current
    if (prev.startKey === startKey && prev.firstStopKey === firstStopKey) return
    lastKeys.current = { startKey, firstStopKey }
    if (!returnToFirst) return
    setIdx(0)
    chosenKey.current = firstStopKey
    heldByTrack.current = false
  }, [startKey, firstStopKey, returnToFirst])
  const isTracked = (missionId: string | undefined): boolean => !!trackedMissionId && missionId === trackedMissionId
  // a new tracked mission (new trackedAt): jump to that job's next stop once the groups have it
  const [trackPending, setTrackPending] = useState(false)
  useEffect(() => {
    if (trackedAt && trackedMissionId) setTrackPending(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedAt])
  useEffect(() => {
    if (!trackPending) return
    const i = groups.findIndex((g) => g.rows.some((r) => r.job.missionId === trackedMissionId))
    if (i >= 0) {
      setIdx(i)
      chosenKey.current = stopKey(groups[i])
      heldByTrack.current = true
    }
    setTrackPending(false)
  }, [trackPending, groups, trackedMissionId])

  // WHERE AM I: any run (button or hotkey) is broadcast to every window
  const [whereBusy, setWhereBusy] = useState(false)
  const [whereMsg, setWhereMsg] = useState<string | null>(null)
  const fixedTyped = startMode === 'fixed' && !!typedStart.trim()
  const liveFails = useRef(0)
  useEffect(() => {
    const off = window.supercargo.onOtherWhere((r: WhereRunResult) => {
      // live reads are quiet: only a run of failures says anything, once
      if (r.why === 'live') {
        if (r.ok) liveFails.current = 0
        else if (++liveFails.current === LIVE_FAIL_LIMIT) setWhereMsg(LIVE_FAIL)
        return
      }
      setWhereBusy(false)
      if (r.ok && r.where) {
        liveFails.current = 0
        const acc = typeof r.where.accuracy === 'number' ? ` \u00b7 ACC ${Math.round(r.where.accuracy)}` : ''
        const what = r.note
          ? r.note
          : `Read OK \u00b7 ${r.where.source === 'map' ? 'map' : SOURCE_WORD[r.where.source] ?? r.where.source}`
        setWhereMsg(`\ud83d\udccd ${what}${acc}${fixedTyped ? ' \u00b7 FIXED start kept' : ''}`)
      } else setWhereMsg(WHERE_FAIL)
    })
    return () => { off?.() }
  }, [fixedTyped])
  useEffect(() => {
    if (!whereMsg) return
    setOverlayDiag({ lastReadMessage: whereMsg, lastReadMessageAt: new Date().toISOString() })
    const t = window.setTimeout(() => setWhereMsg(null), WHERE_MSG_MS)
    return () => window.clearTimeout(t)
  }, [whereMsg])
  const runWhere = (): void => {
    if (whereBusy) return
    setWhereBusy(true)
    setWhereMsg(null)
    window.supercargo.otherWhereRun().then(
      () => setWhereBusy(false),
      () => { setWhereBusy(false); setWhereMsg(WHERE_FAIL) }
    )
  }

  useEffect(() => {
    // the chosen stop still exists: the regroup effect above moves the card to it
    if (idx >= groups.length && chosenIndex() < 0) setIdx(Math.max(0, groups.length - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, groups.length])

  // AFK keep-alive: main owns the timer; this shows it and toggles it
  const [afk, setAfk] = useState<AfkView>({ on: false })
  const [afkErr, setAfkErr] = useState<string | null>(null)
  const [afkNow, setAfkNow] = useState(() => Date.now())
  useEffect(() => {
    const api = afkApi()
    let alive = true
    api.otherAfkGet?.().then((st) => { if (alive && st) setAfk(st) }, () => undefined)
    const off = api.onOtherAfk?.((st) => setAfk(st))
    return () => { alive = false; if (typeof off === 'function') off() }
  }, [])
  useEffect(() => {
    if (afk.lastError) setAfkErr(afk.lastError)
  }, [afk.lastError])
  useEffect(() => {
    if (!afkErr) return
    const t = window.setTimeout(() => setAfkErr(null), AFK_ERR_MS)
    return () => window.clearTimeout(t)
  }, [afkErr])
  useEffect(() => {
    if (!afk.on) return
    setAfkNow(Date.now())
    const t = window.setInterval(() => setAfkNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [afk.on])
  const toggleAfk = (): void => {
    const api = afkApi()
    const call = afk.on ? api.otherAfkStop : api.otherAfkStart
    if (!call) { setAfkErr('AFK: not available in this build'); return }
    call().then(
      (st) => { if (st) { setAfk(st); if (st.lastError) setAfkErr(st.lastError) } },
      (e: unknown) => setAfkErr(`AFK: ${e instanceof Error ? e.message : String(e)}`)
    )
  }
  const afkNextSec = afk.on && afk.nextAt ? Math.max(0, Math.ceil((Date.parse(afk.nextAt) - afkNow) / 1000)) : null

  useEffect(() => {
    if (!returnToFirst || idx <= 0 || heldByTrack.current) return
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
  const orderHint = order !== 'manual' && !hasStart ? 'LOG ORDER' : ORDER_HINT[order]
  // stop 1 from the origin, later stops from the previous stop
  const legMeters = group ? (idx === 0 ? group.distance ?? group.leg : group.leg) : null
  const legJumps = group ? (idx === 0 && group.distance != null ? group.jumps : group.legJumps) : undefined
  const legSurface = group ? (idx === 0 && group.distance != null ? group.surface : group.legSurface) : undefined
  const legApprox = group?.distanceSource === 'marker'
  const legFrom =
    idx > 0
      ? `from stop ${circled(idx)}`
      : origin.kind && origin.kind !== 'typed' && !origin.stale
        ? 'from you'
        : 'from start'
  // 'no-start' is said by the start line below
  // a marker-placed stop says where it is ("near HDPC-Cassillo") instead of "Not found in UEX"
  const noDistanceText =
    group && legMeters == null && group.noDistanceWhy && group.noDistanceWhy !== 'no-start' &&
    !(group.near && group.noDistanceWhy === 'not-in-uex')
      ? NO_DISTANCE_TEXT[group.noDistanceWhy]
      : null
  const startName = origin.label || origin.name
  const startAcc = origin.kind && origin.kind !== 'typed' ? originAccuracy(origin) : null
  const groupTracked = !!group?.rows.some((r) => isTracked(r.job.missionId))
  const startWord = origin.kind ? `${SOURCE_WORD[origin.kind]}${origin.stale ? ' \u00b7 stale' : ''}` : ''
  const nextLeg = showDistance && nextGroup && nextGroup.leg != null ? nextGroup.leg : null
  const left = useMemo(() => remainingRoute(groups, idx), [groups, idx])

  // ## OVERLAY in EXPORT DIAGNOSTICS: what this card is showing now
  const distanceShown = showDistance && group && legMeters != null ? `${travelText(legMeters, legJumps, legSurface, legApprox)} ${legFrom}` : null
  // the stop's resolved place (otherResolve): its label and near place, else the raw text
  const match = group?.match
  // only the words are tinted on the overlay (user, 2026-10-14)
  const issue = current ? stopIssue(match, current.step) : null
  // Next Location line: same rule, only the place words are tinted
  const nextIssue = nextGroup ? stopIssue(nextGroup.match, nextGroup.rows[0]?.step) : null
  const placeShown = group && current
    ? match
      ? stopPlaceText(match, group.place || stepActivePlace(current.step) || current.step.label, locations)
      : formatPlaceNear(group.place || stepActivePlace(current.step) || current.step.label, group.near, locations)
    : null
  // O1: header line 1 = the place name, line 2 = the rest ("Body · System", "near …", "at …")
  const [placeHead, ...placeChips] = placeShown ? placeShown.split(' \u00b7 ') : []
  const placeRest = placeChips.join(' \u00b7 ')
  const placeTip = placeShown
    ? `${placeShown}${current?.step.locationSnapped && current.step.locationRaw ? `\nLog: ${current.step.locationRaw}` : ''}`
    : undefined
  useEffect(() => {
    setOverlayDiag({
      placeListSize: locations.length,
      placeListVersion: otherPlacesVersion(),
      start: { label: startName || null, kind: origin.kind ?? null, accuracy: originAccuracy(origin), stale: !!origin.stale },
      stop: { index: shown, total },
      place: placeShown,
      distanceText: distanceShown,
      noDistanceText: showDistance ? noDistanceText : null,
      noDistanceWhy: group?.noDistanceWhy ?? null,
      afk: { on: afk.on, nextAt: afk.nextAt ?? null, error: afkErr },
      trackedMissionId: trackedMissionId ?? null,
      settings: { otherOverlayDistance: showDistance, otherStartMode: startMode, listOrder: order }
    })
  }, [locations.length, startName, origin, shown, total, placeShown, distanceShown, noDistanceText, group?.noDistanceWhy,
    afk.on, afk.nextAt, afkErr, trackedMissionId, showDistance, startMode, order])
  useEffect(() => {
    if (!IS_OVERLAY_WINDOW) return
    return window.supercargo.onDiagSnapshotRequest((reqId) => {
      try {
        window.supercargo.diagSnapshotReply(reqId, { overlay: overlayDiag() })
      } catch (e) {
        window.supercargo.diagSnapshotReply(reqId, { overlay: { error: e instanceof Error ? e.message : String(e) } })
      }
    })
  }, [])

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
          {/* O1: fixed two-line header so stepping between stops never changes the card height.
              Line 1 = place name (one line, cut with an ellipsis, full text on hover); line 2 = tags + Body · System. */}
          <div data-testid="overlay-stop-header" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div
              data-testid="overlay-stop-name"
              data-issue={issue?.level}
              title={placeTip}
              style={{
                fontFamily: F.display,
                fontSize: 13,
                letterSpacing: '0.08em',
                color: current?.step.locationSnapped ? C.acc : WHITE,
                textTransform: 'uppercase',
                minWidth: 0,
                height: HEAD_LINE1,
                lineHeight: `${HEAD_LINE1}px`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(issue ? issueTextStyle(issue.level) : null)
              }}
            >
              {placeHead ?? 'NO OPEN STOP'}
            </div>
            <div
              data-testid="overlay-stop-sub"
              title={placeRest || undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                height: HEAD_LINE2, lineHeight: `${HEAD_LINE2}px`, whiteSpace: 'nowrap', overflow: 'hidden',
                fontSize: 11, color: C.dim
              }}
            >
              {current ? <span data-testid="overlay-stop-tag" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}><MatchTag key={group ? stopKey(group) : ''} match={match} /></span> : null}
              {groupTracked ? <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}><TrackedTag /></span> : null}
              {placeRest ? (
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{placeRest}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => { heldByTrack.current = false; setIdx((n) => Math.max(0, n - 1)) }}
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
            onClick={() => { heldByTrack.current = false; setIdx((n) => Math.min(total - 1, n + 1)) }}
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
              {travelText(legMeters, legJumps, legSurface, legApprox)}
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
          <span data-testid="overlay-stop-objective" data-issue={issue?.level} style={issue ? issueTextStyle(issue.level) : undefined}>
            {current.step.label}
          </span>
          {(view.showRep && current.job.rep) || (view.sharedBadge && current.job.sharedBy) ? (
            <span style={{ marginLeft: 8 }}><JobTags rep={current.job.rep} repMax={current.job.repMax} sharedBy={current.job.sharedBy} view={view} /></span>
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
              <span>: <span data-testid="overlay-next-location" data-issue={nextIssue?.level} style={nextIssue ? issueTextStyle(nextIssue.level) : undefined}>{nextGroup.match ? stopPlaceText(nextGroup.match, nextGroup.place || stepActivePlace(nextGroup.rows[0].step), locations) : formatPlaceNear(nextGroup.place || stepActivePlace(nextGroup.rows[0].step), nextGroup.near, locations)}</span></span>
              {nextLeg != null ? (
                <span title={formatMapDistance(nextLeg)}>
                  {' \u00b7 '}{travelText(nextLeg, nextGroup.legJumps, nextGroup.legSurface, nextGroup.distanceSource === 'marker')}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {afk.on || afkErr ? (
        <div style={{ ...hintStyle, letterSpacing: '0.06em', marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {afk.on ? (
            <span style={{ color: C.amber }}>
              {`AFK ON${afkNextSec != null ? ` \u00b7 next key in ${afkNextSec} s` : ''}`}
            </span>
          ) : null}
          {afkErr ? <span style={{ color: C.red }}>{afkErr.startsWith('AFK') ? afkErr : `AFK: ${afkErr}`}</span> : null}
        </div>
      ) : null}
      {left.stops > 0 ? (
        <div style={{ ...hintStyle, letterSpacing: '0.06em', marginTop: 8 }} title={showDistance && left.distance != null ? formatMapDistance(left.distance) : undefined}>
          {left.stops} {left.stops === 1 ? 'stop' : 'stops'} left
          {showDistance && left.distance != null && left.stops > 1 ? ` \u00b7 ${travelText(left.distance, left.jumps, false, false)} route` : ''}
        </div>
      ) : null}
      <div
        data-testid="overlay-footer"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 8,
          rowGap: 6,
          marginTop: 10,
          flex: 'none'
        }}
      >
        {/* Buttons never shrink; when the row is narrow AFK wraps to a new line instead of overlapping. */}
        {current && (
          <>
            <button
              type="button"
              data-testid="overlay-btn-step"
              onClick={() => toggleStep(current.job.id, current.step.id)}
              style={{ ...miniBtn, color: C.text, flex: 'none', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {stepActionLabel(current.step)}
            </button>
            <button
              type="button"
              data-testid="overlay-btn-abandon"
              onClick={() => abandonJob(current.job.id)}
              style={{ ...miniBtn, color: C.text, flex: 'none', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              ABANDON
            </button>
          </>
        )}
        <button
          type="button"
          data-testid="overlay-btn-afk"
          onClick={toggleAfk}
          title="AFK: presses keys in Star Citizen for you every cycle (Windows). Click again to stop."
          style={{
            ...miniBtn, flex: 'none', WebkitAppRegion: 'no-drag',
            color: afk.on ? C.ink : C.text,
            background: afk.on ? C.amber : (miniBtn.background ?? 'transparent'),
            border: afk.on ? `1px solid ${C.amber}` : miniBtn.border
          } as React.CSSProperties}
        >
          AFK
        </button>
      </div>
      {/* FROM row sits under the buttons, above the brand label (user, 2026-10-14, option A). */}
      <div
        data-testid="overlay-from-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, minWidth: 0, flex: 'none',
          fontSize: 11, color: C.ghost, whiteSpace: 'nowrap', WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>
          {whereBusy ? (
            'reading\u2026'
          ) : whereMsg ? (
            <span style={{ color: whereMsg === WHERE_FAIL ? C.amber : whereMsg === LIVE_FAIL ? C.ghost : C.acc }}>{whereMsg}</span>
          ) : startName ? (
            <span title={startName}>
              <span style={{ ...hintStyle, letterSpacing: '0.08em' }}>FROM:</span>{' '}
              <span style={{ color: C.dim }}>{startName}</span>{` (${startWord})`}
              {startAcc != null ? <span style={{ marginLeft: 6 }}><AccTag score={startAcc} /></span> : null}
              {origin.match ? <span style={{ marginLeft: 6 }}><MatchTag key={origin.match?.memoryKey ?? origin.match?.text ?? ''} match={origin.match} /></span> : null}
            </span>
          ) : (
            <>
              {'No start \u00b7 '}
              <button type="button" onClick={runWhere} style={{ ...miniBtn, color: C.acc, padding: '1px 6px', fontSize: 10 }}>
                {'\ud83d\udccd WHERE AM I'}
              </button>
              {' or open a station inventory'}
            </>
          )}
        </span>
        {startName && !whereBusy && !whereMsg ? (
          <button
            type="button"
            onClick={runWhere}
            data-testid="overlay-where-pin"
            title="Where am I? Reads the map screen"
            style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 11, flex: 'none', lineHeight: 1,
              minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties}
          >
            {'\ud83d\udccd'}
          </button>
        ) : null}
      </div>
      <div
        data-testid="overlay-brand"
        style={{
          marginTop: 6,
          flex: 'none',
          whiteSpace: 'nowrap',
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
  )
}
