/**
 * Problem stops, one rule for every screen (Jobs, Next, Learned Data "Needs your eye", overlay): a stop whose place
 * is not found is red; a guess, an unsure pick or a mismatch is amber (same statuses as "Needs your eye").
 * Lists tint the whole row (light background + left stripe); the overlay tints only the words (user, 2026-10-14).
 */
import type React from 'react'
import type { StopPlace } from '@other/otherResolve'
import { C } from '@renderer/theme'

export type IssueLevel = 'red' | 'amber'

export interface StopIssue {
  level: IssueLevel
  /** short reason, e.g. "no place", "not found", "guess" */
  reason: string
}

const AMBER = new Set<StopPlace['status']>(['guess', 'unsure', 'mismatch'])

/** the issue of one stop, or null when its place is fine (exact, corrected, game marker, set by you, learned) */
export function stopIssue(
  match: Pick<StopPlace, 'status'> | null | undefined,
  step?: { location?: string } | null
): StopIssue | null {
  if (!match) return null
  if (match.status === 'none') return { level: 'red', reason: step && !step.location?.trim() ? 'no place' : 'not found' }
  if (AMBER.has(match.status)) {
    return { level: 'amber', reason: match.status === 'mismatch' ? 'mismatch' : match.status === 'guess' ? 'guess' : 'not sure' }
  }
  return null
}

/** the worst of several (red beats amber), with how many stops have an issue */
export function worstIssue(issues: (StopIssue | null | undefined)[]): (StopIssue & { count: number }) | null {
  const found = issues.filter((i): i is StopIssue => !!i)
  if (!found.length) return null
  const red = found.find((i) => i.level === 'red')
  return { ...(red ?? found[0]), count: found.length }
}

export function issueColor(level: IssueLevel): string {
  return level === 'red' ? C.red : C.amber
}

/** lists: light tint across the row and a 3 px stripe on the left */
export function issueRowStyle(level: IssueLevel): React.CSSProperties {
  return {
    background: level === 'red' ? 'rgba(236, 116, 112, 0.10)' : 'rgba(230, 182, 94, 0.09)',
    boxShadow: `inset 3px 0 0 ${issueColor(level)}`
  }
}

/** overlay: only the words */
export function issueTextStyle(level: IssueLevel): React.CSSProperties {
  return { color: level === 'red' ? '#f2a3a0' : '#f0cf8e' }
}
