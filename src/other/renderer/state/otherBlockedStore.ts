/** BLOCKED list in the renderer (batch 16): loaded from main on start, kept current by evt:other:blocked. */
import { useSyncExternalStore } from 'react'
import type { BlockedDoc, BlockedItem, DeleteReply, DeleteRequest, LearnedKind } from '@other/otherBlocked'
import { dlog } from '@renderer/state/log'

let doc: BlockedDoc = { items: [] }
let started = false
const listeners = new Set<() => void>()

function set(next: BlockedDoc | null | undefined): void {
  if (!next || typeof next !== 'object' || !Array.isArray(next.items)) return
  doc = { items: next.items }
  for (const l of listeners) l()
}

/** load once and subscribe; safe to call more than once (also runs on first use) */
export function startOtherBlocked(): void {
  if (started || typeof window === 'undefined' || !window.supercargo?.otherBlockedGet) return
  started = true
  window.supercargo.onOtherBlocked?.((d) => set(d))
  window.supercargo
    .otherBlockedGet()
    .then((d) => set(d))
    .catch((e: unknown) => dlog.warn('other', 'blocked list load failed', { error: (e as Error)?.message ?? String(e) }))
}

function subscribe(cb: () => void): () => void {
  startOtherBlocked()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useBlocked(): BlockedDoc {
  return useSyncExternalStore(subscribe, () => doc)
}

/** current items for non-React code; empty until main answers */
export function blockedItems(): BlockedItem[] {
  startOtherBlocked()
  return doc.items
}

/** delete (and maybe block) learned entries; main broadcasts the changed docs */
export async function deleteLearned(r: DeleteRequest): Promise<DeleteReply> {
  try {
    const reply = await window.supercargo.otherDataDelete(r)
    if (!reply?.ok) dlog.warn('other', 'learned data delete failed', { kind: r.kind, count: r.keys.length, error: reply?.error })
    return reply
  } catch (e) {
    const error = (e as Error)?.message ?? String(e)
    dlog.warn('other', 'learned data delete failed', { kind: r.kind, count: r.keys.length, error })
    return { ok: false, deleted: 0, blocked: 0, error }
  }
}

export async function unblock(items: { kind: LearnedKind; key: string }[]): Promise<void> {
  if (!items.length) return
  try {
    set(await window.supercargo.otherBlockedUnblock(items))
  } catch (e) {
    dlog.warn('other', 'learned data unblock failed', { count: items.length, error: (e as Error)?.message ?? String(e) })
  }
}

startOtherBlocked()
