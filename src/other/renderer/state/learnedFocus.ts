/** LEARNED DATA tab focus (S7): MatchFix asks the page to open on one memory entry, or a section (batch 16). */
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

/** LEARNED DATA sections marked `data-learned-section` (batch 16: the BLOCKED list) */
export type LearnedSection = 'blocked'

/**
 * open the LEARNED DATA tab scrolled to a section (the grey "blocked" tag). The page marks the section with
 * `data-learned-section="<name>"`; the tab mounts after setView, so retry for about a second.
 */
export function focusLearnedSection(section: LearnedSection): void {
  useStore.getState().setView('learned')
  if (typeof document === 'undefined') return
  let tries = 0
  const go = (): void => {
    const el = document.querySelector(`[data-learned-section="${section}"]`)
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    if (++tries < 20) setTimeout(go, 50)
  }
  setTimeout(go, 0)
}
