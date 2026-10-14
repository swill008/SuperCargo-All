/**
 * Other-mode diagnostics snapshot: jobs, history, watermark, marker zones, settings, and a
 * distance table (every open stop in all three list orders, with why a distance is missing).
 * Called when main asks the window for a snapshot; read-only.
 */
import type { Location } from '@shared/types'
import type { ListOrder, OtherHistoryEntry, OtherJob, OtherStep } from '@other/otherJob'
import { findRosterLocation, listOpenStops, stepActivePlace } from '@other/otherNext'
import { isRootFrame, isSmallZone, type MarkerPos } from '@other/otherMarkers'
import { OTHER_SETTING_DEFAULTS, otherSetting, resolveWorkMode } from '@other/workMode'
import { useStore } from '@renderer/state/store'
import { useOtherJobs, otherMissionMarkers } from './otherJobs'
import { useOtherHistory } from './otherHistory'
import { mergeLocations } from './otherPlaces'

const hasCoords = (p?: { x?: number; y?: number; z?: number } | null): boolean => !!p && p.x != null && p.y != null && p.z != null
const round = (n: number | null | undefined): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n))

function compactStep(s: OtherStep): Record<string, unknown> {
  return {
    kind: s.kind,
    label: s.label,
    location: s.location,
    pickupLocation: s.pickupLocation,
    pickedUp: s.pickedUp,
    item: s.item,
    have: s.have,
    need: s.need,
    done: s.done,
    withdrawn: s.withdrawn,
    position: s.position,
    objectiveId: s.objectiveId
  }
}

function compactJob(j: OtherJob | OtherHistoryEntry, status: string): Record<string, unknown> {
  return {
    ref: j.ref,
    missionId: j.missionId,
    title: j.title,
    kind: j.kind,
    status,
    source: j.source,
    reward: j.reward,
    rep: j.rep,
    sharedBy: j.sharedBy,
    sessionAt: j.sessionAt,
    acceptedAt: j.acceptedAt,
    endedAt: j.endedAt,
    filledBy: j.filledBy,
    edited: j.edited,
    locked: 'objectivesLocked' in j ? j.objectivesLocked : undefined,
    steps: j.steps.map(compactStep)
  }
}

/** why a stop has no distance, in the order listOpenStops checks */
function noDistanceWhy(
  step: OtherStep,
  missionId: string | undefined,
  start: Location | undefined,
  locations: Location[],
  useMarker: boolean,
  zones: Record<string, { bad?: boolean }>
): string {
  if (!start) return 'no start'
  if (!hasCoords(start)) return 'start not in UEX (no coords)'
  const place = stepActivePlace(step)
  const named = findRosterLocation(place, locations)
  if (named && !hasCoords(named)) return 'place in UEX without coords'
  const why = named ? '' : 'place not in UEX'
  if (!useMarker) return `${why || 'no coords'}; marker distance off`
  const raw = missionId && step.objectiveId ? otherMissionMarkers().get(missionId)?.get(step.objectiveId) : undefined
  if (!raw) return `${why}; no marker for objective${step.objectiveId ? '' : ' (no objectiveId)'}`
  if (isSmallZone(raw)) return `${why}; marker in small zone`
  const zc = zones[raw.zoneHostId]
  if (!zc) return `${why}; marker zone not calibrated`
  if (zc.bad) return `${why}; marker zone conflicting (bad)`
  return `${why}; marker not placed on step`
}

function markerInfo(missionId: string | undefined, step: OtherStep): Record<string, unknown> | undefined {
  if (!missionId || !step.objectiveId) return undefined
  const m: MarkerPos | undefined = otherMissionMarkers().get(missionId)?.get(step.objectiveId)
  if (!m) return undefined
  return { zone: m.zoneHostId, x: round(m.x), y: round(m.y), z: round(m.z), root: isRootFrame(m), small: isSmallZone(m) }
}

export function otherDiagSnapshot(): Record<string, unknown> {
  try {
    const s = useOtherJobs.getState()
    const settings = useStore.getState().settings
    const locations = mergeLocations(useStore.getState().locations)
    const history = useOtherHistory.getState().history

    // same start the Next page uses: typed wins, else the log's current station (otherAutoStart)
    const autoStart = !s.startLocation.trim() && otherSetting(settings, 'otherAutoStart') && s.currentLocation ? s.currentLocation : null
    const start = autoStart ?? s.startLocation
    const startLoc = start.trim() ? findRosterLocation(start, locations) : undefined
    const useMarker = otherSetting(settings, 'otherMarkerDistance')
    const withdrawn = otherSetting(settings, 'otherWithdrawnSteps')
    const showAll = !!settings.overlayShowAllObjectives
    const hideCompleted = settings.overlayHideCompletedObjectives !== false
    const zones = (s.markerBuild && s.markerZones[s.markerBuild]) || {}
    // Next drops withdrawn steps before listing
    const live = s.jobs.map((j) => (j.steps.some((x) => x.withdrawn) ? { ...j, steps: j.steps.filter((x) => !x.withdrawn) } : j))

    const orders: ListOrder[] = ['distance', 'route', 'manual']
    const distanceTable: Record<string, unknown> = {}
    for (const order of orders) {
      const rows = listOpenStops(live, start, locations, {
        showAll,
        hideCompleted,
        listOrder: order,
        jobOrder: s.jobOrder,
        markerDistance: useMarker,
        withdrawnSteps: withdrawn
      })
      distanceTable[order] = rows.map((r) => {
        const place = stepActivePlace(r.step)
        const uex = findRosterLocation(place, locations)
        return {
          ref: r.job.ref,
          step: r.step.label,
          place,
          uex: uex ? { name: uex.name, x: round(uex.x), y: round(uex.y), z: round(uex.z) } : null,
          marker: markerInfo(r.job.missionId, r.step),
          position: r.step.position,
          distance: round(r.distance),
          leg: round(r.leg),
          distanceSource: r.distanceSource,
          noDistance: r.noDistance,
          why: r.distance == null ? noDistanceWhy(r.step, r.job.missionId, startLoc, locations, useMarker, zones) : undefined
        }
      })
    }

    const zoneSummary: Record<string, unknown> = {}
    for (const [build, table] of Object.entries(s.markerZones)) {
      const list = Object.values(table)
      zoneSummary[build] = {
        zones: list.length,
        root: list.filter((z) => z.root).length,
        bad: list.filter((z) => z.bad).length,
        table: Object.fromEntries(Object.entries(table).map(([id, z]) => [id, { n: z.n, root: z.root, bad: z.bad }]))
      }
    }

    const otherSettings: Record<string, unknown> = { workMode: resolveWorkMode(settings.workMode) }
    for (const k of Object.keys(OTHER_SETTING_DEFAULTS) as (keyof typeof OTHER_SETTING_DEFAULTS)[]) otherSettings[k] = otherSetting(settings, k)
    otherSettings.overlayShowAllObjectives = showAll
    otherSettings.overlayHideCompletedObjectives = hideCompleted
    otherSettings.otherOcrIncludeAuec = settings.otherOcrIncludeAuec

    let markerCount = 0
    for (const m of otherMissionMarkers().values()) markerCount += m.size

    return {
      ready: s.ready,
      passive: s.passive,
      jobs: s.jobs.map((j) => compactJob(j, j.status)),
      history: history.map((h) => compactJob(h, h.outcome)),
      doc: {
        lastLogEventAt: s.lastLogEventAt,
        lastLogEventCount: s.lastLogEventCount,
        sessionAt: s.sessionAt,
        markerBuild: s.markerBuild,
        rev: s.rev,
        listOrder: s.listOrder,
        jobOrder: s.jobOrder,
        groupBy: s.groupBy
      },
      markerZones: zoneSummary,
      markersThisRun: markerCount,
      settings: otherSettings,
      startLocation: s.startLocation,
      currentLocation: s.currentLocation,
      start: { used: start, auto: !!autoStart, uex: startLoc ? { name: startLoc.name, coords: hasCoords(startLoc) } : null },
      locations: { count: locations.length, withCoords: locations.filter(hasCoords).length },
      distanceTable
    }
  } catch (err) {
    return { error: (err as Error)?.message ?? String(err) }
  }
}
