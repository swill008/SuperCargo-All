/**
 * Match memory (pure): what each non-exact stop text resolved to, what the user set, and what the game
 * proved (Objective Complete while a position read showed where you were). Saved by main
 * (other-matches.json); the resolver reads entries through ResolveCtx.memory.
 * Every function returns a new doc; the input is never changed.
 */
import { placeKey } from './otherResolve'

export type MemoryOrigin = 'user' | 'game'

export interface MemoryWhere {
  name: string | null
  meters: number | null
  at: string
}

export interface MemoryEntry {
  /** memoryKey(text, context) */
  key: string
  /** latest raw text seen */
  text: string
  /** generic sites only: placeKey of the place the contract names / the site parent ('' otherwise) */
  context?: string
  /** roster name chosen (user) or last resolved (game); null = no place */
  place: string | null
  /** 'user' once the user set it; else 'game' */
  origin: MemoryOrigin
  /** game proofs that agreed with `place` */
  confirmed: number
  /** game proofs that disagreed */
  wrong: number
  /** last 3 places you actually were when it was wrong, newest first */
  wrongAt?: MemoryWhere[]
  /** origin 'user' && wrong >= 2 */
  disputed?: boolean
  seen: number
  firstAt: string
  lastAt: string
  lastStatus?: string
  lastConfidence?: number
  /** evidence texts, max 8 */
  lastEvidence?: string[]
}

export interface MemoryChange {
  at: string
  key: string
  text: string
  what: 'seen-new' | 'confirm' | 'set' | 'forget' | 'proof' | 'undo'
  by: 'user' | 'game'
  before: MemoryEntry | null
  after: MemoryEntry | null
}

/** changes newest first, max CHANGES_MAX (no 'seen' noise: only new entries, user actions, proofs, undo) */
export interface MemoryDoc {
  entries: MemoryEntry[]
  changes: MemoryChange[]
}

export const MEMORY_MAX = 500
export const CHANGES_MAX = 50
export const PROOF_WINDOW_MS = 600_000
export const PROOF_METERS = 1500
const WRONG_AT_MAX = 3
const EVIDENCE_MAX = 8

export interface SeenInput {
  key: string
  text: string
  context?: string
  place: string | null
  status: string
  confidence: number
  evidence: string[]
}

export interface ProofInput {
  key: string
  text: string
  context?: string
  place: string | null
  ok: boolean
  actual: MemoryWhere
}

export interface SetInput {
  key: string
  text: string
  context?: string
  place: string
  /** KEEP MINE: clear the dispute (wrong 0, no wrongAt); confirmed is kept */
  reset?: boolean
}

export function emptyMemoryDoc(): MemoryDoc {
  return { entries: [], changes: [] }
}

export function memoryKey(text: string, context?: string): string {
  return placeKey(text) + (context ? '@' + placeKey(context) : '')
}

export function lookupMemory(doc: MemoryDoc, key: string): MemoryEntry | undefined {
  return doc.entries.find((e) => e.key === key)
}

const fold = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()
const samePlace = (a: string | null, b: string | null): boolean => fold(a) === fold(b)

function withDisputed(e: MemoryEntry): MemoryEntry {
  const out = { ...e }
  if (out.origin === 'user' && out.wrong >= 2) out.disputed = true
  else delete out.disputed
  return out
}

function newEntry(p: { key: string; text: string; context?: string; place: string | null }, at: string): MemoryEntry {
  const e: MemoryEntry = { key: p.key, text: p.text, place: p.place, origin: 'game', confirmed: 0, wrong: 0, seen: 0, firstAt: at, lastAt: at }
  if (p.context != null) e.context = p.context
  return e
}

/** replace (or add, or with null remove) the entry for key, then apply the cap */
function putEntry(entries: MemoryEntry[], key: string, e: MemoryEntry | null): MemoryEntry[] {
  const i = entries.findIndex((x) => x.key === key)
  const out = entries.slice()
  if (i >= 0) {
    if (e) out[i] = e
    else out.splice(i, 1)
  } else if (e) out.push(e)
  return capEntries(out)
}

/** over MEMORY_MAX: drop the oldest lastAt first; 'user' entries are never dropped */
function capEntries(entries: MemoryEntry[]): MemoryEntry[] {
  let over = entries.length - MEMORY_MAX
  if (over <= 0) return entries
  const drop = new Set(
    entries
      .filter((e) => e.origin !== 'user')
      .sort((a, b) => (a.lastAt < b.lastAt ? -1 : a.lastAt > b.lastAt ? 1 : 0))
      .slice(0, over)
      .map((e) => e.key)
  )
  over = drop.size
  return entries.filter((e) => !drop.has(e.key))
}

function logChange(changes: MemoryChange[], c: MemoryChange): MemoryChange[] {
  return [c, ...changes].slice(0, CHANGES_MAX)
}

/** a non-exact stop was shown: remember it; repeats bump `seen`. Existing user entries keep their place. */
export function recordSeen(doc: MemoryDoc, s: SeenInput, at: string): MemoryDoc {
  if (s.status === 'exact') return doc
  const before = lookupMemory(doc, s.key) ?? null
  const e: MemoryEntry = before ? { ...before } : newEntry(s, at)
  e.text = s.text
  if (s.context != null) e.context = s.context
  if (e.origin === 'game' && !samePlace(e.place, s.place)) {
    // the counts were about the old place
    e.place = s.place
    e.confirmed = 0
    e.wrong = 0
    delete e.wrongAt
  }
  e.seen += 1
  e.lastAt = at
  e.lastStatus = s.status
  e.lastConfidence = s.confidence
  e.lastEvidence = s.evidence.slice(0, EVIDENCE_MAX)
  const after = withDisputed(e)
  const changes = before ? doc.changes : logChange(doc.changes, { at, key: s.key, text: s.text, what: 'seen-new', by: 'game', before: null, after })
  return { entries: putEntry(doc.entries, s.key, after), changes }
}

/**
 * The game showed where you were when a step completed. ok = you were at `p.place`.
 * Counts are about the entry's place: a game entry follows p.place (counts reset when it changes);
 * a user entry with a different place counts ok as wrong (you were at p.place), and !ok as confirmed
 * only when where you actually were is the user's place.
 */
export function recordProof(doc: MemoryDoc, p: ProofInput, at: string): MemoryDoc {
  const before = lookupMemory(doc, p.key) ?? null
  const e: MemoryEntry = before ? { ...before } : newEntry(p, at)
  e.text = p.text
  if (p.context != null) e.context = p.context
  let agreed: boolean
  if (e.origin === 'user' && !samePlace(e.place, p.place)) {
    agreed = !p.ok && samePlace(p.actual.name, e.place)
  } else {
    if (!samePlace(e.place, p.place)) {
      e.place = p.place
      e.confirmed = 0
      e.wrong = 0
      delete e.wrongAt
    }
    agreed = p.ok
  }
  if (agreed) e.confirmed += 1
  else {
    e.wrong += 1
    e.wrongAt = [{ ...p.actual }, ...(e.wrongAt ?? [])].slice(0, WRONG_AT_MAX)
  }
  e.lastAt = at
  const after = withDisputed(e)
  return {
    entries: putEntry(doc.entries, p.key, after),
    changes: logChange(doc.changes, { at, key: p.key, text: p.text, what: 'proof', by: 'game', before, after })
  }
}

/** ✓ Right / pick: the user decides the place. Counts reset when the place changes; `reset` clears a dispute. */
export function setUserPlace(doc: MemoryDoc, p: SetInput, at: string): MemoryDoc {
  const before = lookupMemory(doc, p.key) ?? null
  const e: MemoryEntry = before ? { ...before } : { ...newEntry(p, at), seen: 1 }
  e.text = p.text
  if (p.context != null) e.context = p.context
  if (!samePlace(e.place, p.place)) {
    e.confirmed = 0
    e.wrong = 0
    delete e.wrongAt
  }
  if (p.reset) {
    e.wrong = 0
    delete e.wrongAt
  }
  e.place = p.place
  e.origin = 'user'
  e.lastAt = at
  const after = withDisputed(e)
  return {
    entries: putEntry(doc.entries, p.key, after),
    changes: logChange(doc.changes, { at, key: p.key, text: p.text, what: 'set', by: 'user', before, after })
  }
}

export function forgetEntry(doc: MemoryDoc, key: string, at: string): MemoryDoc {
  const before = lookupMemory(doc, key)
  if (!before) return doc
  return {
    entries: putEntry(doc.entries, key, null),
    changes: logChange(doc.changes, { at, key, text: before.text, what: 'forget', by: 'user', before, after: null })
  }
}

/** restores `before` of changes[index] (null -> remove); logs 'undo' (before = now, after = restored) */
export function undoChange(doc: MemoryDoc, index: number, at: string): MemoryDoc {
  const c = doc.changes[index]
  if (!c) return doc
  const now = lookupMemory(doc, c.key) ?? null
  const restored = c.before ? { ...c.before } : null
  return {
    entries: putEntry(doc.entries, c.key, restored),
    changes: logChange(doc.changes, { at, key: c.key, text: c.text, what: 'undo', by: 'user', before: now, after: restored })
  }
}

/** user: always (when a place is set); game: confirmed >= 2 && confirmed > wrong */
export function learnedPlace(e: MemoryEntry): { place: string; strength: 'user' | 'learned' } | null {
  if (!e.place) return null
  if (e.origin === 'user') return { place: e.place, strength: 'user' }
  if (e.confirmed >= 2 && e.confirmed > e.wrong) return { place: e.place, strength: 'learned' }
  return null
}

/** "you set it" | "game confirmed ×3" | "unproven" | "⚠ the game disagrees" */
export function memoryLabel(e: MemoryEntry): string {
  if (e.origin === 'user') return e.disputed || e.wrong >= 2 ? '⚠ the game disagrees' : 'you set it'
  if (learnedPlace(e)) return `game confirmed ×${e.confirmed}`
  if (e.wrong >= 2) return '⚠ the game disagrees'
  return 'unproven'
}

/**
 * DELETE (permanent): removes the entries for `keys` and every change with one of those keys, so UNDO
 * can't bring them back. Nothing is logged in changes. `deleted` = entries removed.
 */
export function deleteEntries(doc: MemoryDoc, keys: readonly string[]): { doc: MemoryDoc; deleted: number } {
  const drop = new Set(keys)
  if (!drop.size) return { doc, deleted: 0 }
  const entries = doc.entries.filter((e) => !drop.has(e.key))
  const changes = doc.changes.filter((c) => !drop.has(c.key))
  const deleted = doc.entries.length - entries.length
  if (!deleted && changes.length === doc.changes.length) return { doc, deleted: 0 }
  return { doc: { entries, changes }, deleted }
}

/** the game's inputs (seen / proof) minus the blocked keys; user actions never go through this */
export function withoutBlocked<T extends { key: string }>(list: readonly T[], blocked: (key: string) => boolean): T[] {
  return list.filter((x) => !blocked(x.key))
}
