/**
 * Steady next stop (batch 18, route optimization on): the stop that was first in the last plan,
 * kept per window (module state lives in each renderer window). listOpenStopsWithRoute keeps it
 * first unless a plan without it is at least 20% shorter. Cleared when that stop is no longer open
 * or the order mode (listOrder / switch) changes.
 */
import type { OtherJob } from '@other/otherJob'
import { stopKey } from '@other/otherNext'

interface Pin {
  key: string
  mode: string
}

// one per window scope (the Next page and the overlay may share a window)
const pins = new Map<string, Pin>()

/** the order mode a pin belongs to; a pin from another mode is dropped */
export function routePinMode(listOrder: string, optimise: boolean): string {
  return `${listOrder}|${optimise ? 'opt' : 'off'}`
}

/** true while the stop is still open (active job, step not done) */
function stillOpen(key: string, jobs: readonly OtherJob[]): boolean {
  for (const job of jobs) {
    if (job.status !== 'active') continue
    for (const step of job.steps) if (!step.done && stopKey({ job, step }) === key) return true
  }
  return false
}

/** the pinned stop key for this window and mode, or undefined (stale pins are cleared here) */
export function getRoutePin(windowScope: string, mode: string, jobs: readonly OtherJob[]): string | undefined {
  const pin = pins.get(windowScope)
  if (!pin) return undefined
  if (pin.mode !== mode || !stillOpen(pin.key, jobs)) {
    pins.delete(windowScope)
    return undefined
  }
  return pin.key
}

/** remember the first stop of the plan just shown; undefined clears */
export function noteRouteFirst(key: string | undefined, windowScope: string, mode: string): void {
  if (key) pins.set(windowScope, { key, mode })
  else pins.delete(windowScope)
}

/** forget the pin for one window scope, or all of them */
export function clearRoutePin(windowScope?: string): void {
  if (windowScope == null) pins.clear()
  else pins.delete(windowScope)
}
