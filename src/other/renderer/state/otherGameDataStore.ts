/**
 * Star Citizen Wiki game data in the renderer: the site-code table the resolver reads (otherSiteCodes
 * setSiteCodes), loaded from main on start and replaced by evt:other:gameData after "Update game data".
 * The otherSourceStarmap switch covers it too: off -> an empty table, so the resolver adds no game-data
 * evidence. Each change reloads the Other places, which bumps the places version so views re-resolve.
 */
import { useSyncExternalStore } from 'react'
import { setSiteCodes, type GameDataReply, type SiteCodesDoc } from '@other/otherSiteCodes'
import { otherSetting } from '@other/workMode'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { loadOtherPlacesFromMain } from './otherPlaces'

const EMPTY: SiteCodesDoc = { generatedAt: '', sites: [] }

let reply: GameDataReply | null = null
let updating = false
let started = false
const listeners = new Set<() => void>()
let snapshot: { reply: GameDataReply | null; updating: boolean } = { reply, updating }

const sourceOn = (): boolean => otherSetting(useStore.getState().settings, 'otherSourceStarmap') !== false

function notify(): void {
  snapshot = { reply, updating }
  for (const l of listeners) l()
}

/** put the table (or nothing, when the source is off) in front of the resolver and re-resolve */
function apply(why: string): void {
  const on = sourceOn()
  setSiteCodes(on && reply?.siteCodes ? reply.siteCodes : EMPTY)
  dlog.debug('other', 'game data applied', { why, on, sites: on ? (reply?.siteCodes?.sites?.length ?? 0) : 0 })
  void loadOtherPlacesFromMain().catch(() => undefined)
}

function set(next: GameDataReply | null | undefined, why: string): void {
  if (!next || typeof next !== 'object' || !next.siteCodes || !Array.isArray(next.siteCodes.sites)) return
  reply = next
  apply(why)
  notify()
}

/** load once and subscribe; safe to call more than once (also runs on first use) */
export function startGameData(): void {
  if (started || typeof window === 'undefined' || !window.supercargo?.otherGameDataGet) return
  started = true
  window.supercargo.onOtherGameData?.((d) => set(d, 'update'))
  window.supercargo
    .otherGameDataGet()
    .then((d) => {
      set(d, 'load')
      dlog.debug('other', 'game data loaded from main', { sites: d?.sites ?? 0, positions: d?.positions ?? 0, source: d?.source })
    })
    .catch((e: unknown) => dlog.warn('other', 'game data load failed', { error: (e as Error)?.message ?? String(e) }))
  let last = sourceOn()
  useStore.subscribe(() => {
    const on = sourceOn()
    if (on === last) return
    last = on
    if (reply) apply('switch')
  })
}

/** "Update game data": downloads in main; every window gets the new table via evt:other:gameData */
export async function updateGameData(): Promise<GameDataReply | null> {
  startGameData()
  if (updating || !window.supercargo?.otherGameDataUpdate) return reply
  updating = true
  notify()
  try {
    const d = await window.supercargo.otherGameDataUpdate()
    dlog.info('other', 'game data update', { sites: d?.sites, positions: d?.positions, source: d?.source, error: d?.error })
    set(d, 'update')
    return d
  } catch (e) {
    dlog.warn('other', 'game data update failed', { error: (e as Error)?.message ?? String(e) })
    return reply
  } finally {
    updating = false
    notify()
  }
}

function subscribe(cb: () => void): () => void {
  startGameData()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** status + table (null until main answers) and whether an update is running */
export function useGameData(): { reply: GameDataReply | null; updating: boolean } {
  return useSyncExternalStore(subscribe, () => snapshot)
}

startGameData()
