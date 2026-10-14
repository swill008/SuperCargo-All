/** Planet table in the renderer: loaded from main on start, kept current by evt:other:bodies. */
import { useSyncExternalStore } from 'react'
import { emptyBodiesDoc, type BodiesDoc, type BodyInfo } from '@other/otherBodies'
import { dlog } from '@renderer/state/log'

let doc: BodiesDoc = emptyBodiesDoc()
let started = false
const listeners = new Set<() => void>()

function set(next: BodiesDoc | null | undefined): void {
  if (!next || typeof next !== 'object' || !next.bodies) return
  doc = { bodies: next.bodies, learned: Array.isArray(next.learned) ? next.learned : [] }
  for (const l of listeners) l()
}

/** load once and subscribe; safe to call more than once (also runs on first use) */
export function startOtherBodies(): void {
  if (started || typeof window === 'undefined' || !window.supercargo?.otherBodiesGet) return
  started = true
  window.supercargo.onOtherBodies?.((d) => set(d))
  window.supercargo
    .otherBodiesGet()
    .then((d) => {
      set(d)
      dlog.debug('other', 'bodies loaded from main', { bodies: Object.keys(d?.bodies ?? {}).length, learned: d?.learned?.length ?? 0 })
    })
    .catch((e: unknown) => dlog.warn('other', 'bodies load failed', { error: (e as Error)?.message ?? String(e) }))
}

function subscribe(cb: () => void): () => void {
  startOtherBodies()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** current table for non-React code (keys: bodyKey(name)); empty until main answers */
export function bodiesTable(): Record<string, BodyInfo> {
  startOtherBodies()
  return doc.bodies
}

export function bodiesDoc(): BodiesDoc {
  startOtherBodies()
  return doc
}

export function useBodies(): BodiesDoc {
  return useSyncExternalStore(subscribe, () => doc)
}

startOtherBodies()
