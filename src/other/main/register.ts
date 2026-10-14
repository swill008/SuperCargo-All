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
import { logger } from '../../main/logger'

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
  const mode = resolveWorkMode(settings.workMode)
  const route = mode === 'other' ? 'other' : isHauling ? 'haul' : 'none'
  logger.info('other', 'route accepted', { id: e.missionId.slice(0, 8), isHauling, workMode: mode, route })
  if (resolveWorkMode(settings.workMode) === 'other') {
    if (isHauling) sendOtherAccepted(e)
    return 'other'
  }
  return isHauling ? 'haul' : 'none'
}
