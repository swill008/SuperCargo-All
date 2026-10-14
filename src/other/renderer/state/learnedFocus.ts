/** LEARNED DATA tab focus (S7): MatchFix asks the page to open on one memory entry. */
import { useSyncExternalStore } from 'react'
import { useStore } from '@renderer/state/store'

let pending: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** open the LEARNED DATA tab; with a key the page scrolls to that entry, else to "Needs your eye" */
export function focusLearned(key?: string): void {
  pending = key && key.trim() ? key : ''
  emit()
  useStore.getState().setView('learned')
}

/** pending focus: a memory key, '' for "Needs your eye", null for none */
export function useLearnedFocus(): string | null {
  return useSyncExternalStore(subscribe, () => pending)
}

export function clearLearnedFocus(): void {
  if (pending === null) return
  pending = null
  emit()
}
