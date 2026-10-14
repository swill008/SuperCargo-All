// compact Haul-mode state for EXPORT DIAGNOSTICS: manifest, route, ship, settings, last route stats

import { useStore } from './store'
import { lastRouteStats } from './route'
import { gridCapacity } from '@shared/cargoGrids'
import type { BoxAllocation } from '@shared/types'

const boxes = (b: BoxAllocation[] | undefined): string =>
  (b ?? []).filter((x) => x.count > 0).map((x) => `${x.count}x${x.scuSize}`).join(' ')

export function haulDiagSnapshot(): Record<string, unknown> {
  const st = useStore.getState()
  const s = st.settings
  const ship = s.activeShip
  const installed = s.installedModules[ship]
  let capacity: number | null = null
  try {
    capacity = gridCapacity(ship, installed)
  } catch {
    capacity = null
  }
  const route = st.route

  return {
    view: st.view,
    runId: st.runId,
    crewRole: st.crew.role,
    watcher: { connected: st.watcher.connected, channel: st.watcher.channel },
    manifest: st.contracts.map((c) => ({
      id: c.id,
      ref: c.ref,
      title: c.title,
      status: c.status,
      source: c.dataSource,
      generator: c.generator,
      contractName: c.contractName,
      pickup: c.pickup,
      reward: c.reward,
      maxBoxSize: c.maxBoxSize,
      boxSizeConfirmed: !!c.boxSizeConfirmed,
      commodityBoxSizes: c.commodityBoxSizes,
      pendingOcr: c.pendingOcr || undefined,
      settled: c.objectivesSettled || undefined,
      shared: c.sharedWithMe ? (c.sharerLeft ? 'with me, sharer left' : 'with me') : c.sharedWith?.length ? `out x${c.sharedWith.length}` : undefined,
      objectives: c.objectives.map((o) => ({
        id: o.id,
        commodity: o.commodity,
        scu: o.scuAmount,
        destination: o.destination,
        pickups: o.pickups,
        boxes: boxes(o.boxes),
        edited: o.originalBoxes ? boxes(o.originalBoxes) : undefined,
        delivered: o.delivered || undefined,
        deliveredScu: o.deliveredScu,
        turnedInScu: o.turnedInScu,
        pickedUpAt: o.pickedUpAt?.length ? o.pickedUpAt : undefined
      }))
    })),
    route: route
      ? {
          method: route.method,
          feasible: route.feasible,
          reason: route.reason,
          totalDistance: route.totalDistance,
          usedRealDistance: route.usedRealDistance,
          trips: route.trips,
          peakLoad: route.peakLoad,
          capacity: route.capacity,
          stops: route.steps.map((step) => ({
            key: step.nodeKey,
            label: step.label,
            trip: step.trip,
            loadAfter: step.loadAfter,
            pick: step.loadRefs.map((r) => `${r.objectiveId}:${r.scu}`),
            drop: step.dropRefs.map((r) => `${r.objectiveId}:${r.scu}`),
            defer: step.deferRefs.length ? step.deferRefs.map((r) => r.objectiveId) : undefined
          }))
        }
      : null,
    stopOrder: st.stopOrder,
    isRouteAuto: st.isRouteAuto,
    startLocation: st.startLocation,
    currentLocation: st.currentLocation,
    deferred: st.deferredObjectives,
    loading: { active: st.loadingActive, idx: st.loadingIdx, steps: st.loadingSteps?.length ?? 0, layoutLocked: !!st.layout?.locked },
    ship: { name: ship, installedModules: installed ?? 'all', capacity, storAlls: st.storAlls[ship]?.length ?? 0 },
    settings: {
      workMode: (s as unknown as Record<string, unknown>).workMode ?? 'haul',
      ocrAutoCapture: s.ocrAutoCapture,
      ocrEngine: s.ocrEngine,
      ocrCaptureTarget: s.ocrCaptureTarget,
      ocrCaptureDelay: s.ocrCaptureDelay,
      spaceDeliveryPiles: s.spaceDeliveryPiles,
      contractsDataPath: s.contractsDataPath ? 'set' : 'auto',
      gameChannel: s.gameChannel
    },
    locationsLoaded: st.locations.length,
    lastRoute: lastRouteStats()
  }
}
