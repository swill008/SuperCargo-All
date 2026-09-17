/**
 * StandAlone Other — main-process adapter.
 * Re-tie after an upstream pull:
 *   1. ensureOtherIpc() once at startup (instead of inside haul store.ts)
 *   2. routeAccepted() in the Game.log accepted handler
 */
import type { AppSettings, ContractAcceptedEvent } from '@shared/types'
import { resolveWorkMode } from '../workMode'
import { sendOtherAccepted } from './ipc'
import { ensureOtherJobsIpc } from './jobs'

export { ensureOtherJobsIpc }

export function ensureOtherIpc(): void {
  ensureOtherJobsIpc()
}

/** other = listed on Jobs, skip Manifest. haul = stock Manifest path. none = non-haul. */
export function routeAccepted(
  e: ContractAcceptedEvent,
  isHauling: boolean,
  settings: AppSettings
): 'other' | 'haul' | 'none' {
  if (resolveWorkMode(settings.workMode) === 'other') {
    if (isHauling) sendOtherAccepted(e)
    return 'other'
  }
  return isHauling ? 'haul' : 'none'
}
