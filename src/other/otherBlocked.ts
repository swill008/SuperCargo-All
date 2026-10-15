/**
 * Learned-data delete and block (batch 16): what the user deleted and blocked, so the game never learns it again
 * until UNBLOCK. Pure types and helpers; the main side (src/other/main/blocked.ts) saves other-blocked.json.
 */

/** which learned list an item came from */
export type LearnedKind = 'place' | 'site' | 'planet'

export interface BlockedItem {
  kind: LearnedKind
  /** place: memoryKey (otherMemory.ts); site: `${bodyKey(name)}|${bodyKey(near)}`; planet: bodyKey(name) */
  key: string
  /** what the user sees: the text as read, the site name (near place), or the planet name */
  label: string
  /** ISO time it was blocked */
  at: string
}

export interface BlockedDoc {
  items: BlockedItem[]
}

/** one delete request from the LEARNED DATA tab or the fix panel */
export interface DeleteRequest {
  kind: LearnedKind
  /** same key forms as BlockedItem.key */
  keys: string[]
  /** true = also add each key to the BLOCKED list */
  block: boolean
  /** optional label per key (the text as read), used when the key has no learned entry to take it from */
  labels?: Record<string, string>
}

export interface DeleteReply {
  ok: boolean
  /** how many entries were removed */
  deleted: number
  /** how many were added to the BLOCKED list */
  blocked: number
  error?: string
}

export const LEARNED_KINDS: readonly LearnedKind[] = ['place', 'site', 'planet']
/** cap on keys in one delete request */
export const DELETE_KEYS_MAX = 5000

const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function isLearnedKind(v: unknown): v is LearnedKind {
  return v === 'place' || v === 'site' || v === 'planet'
}

const itemId = (kind: LearnedKind, key: string): string => `${kind}\u0000${key}`

export function emptyBlockedDoc(): BlockedDoc {
  return { items: [] }
}

/** validate a file's doc: bad items dropped, duplicates (kind+key) keep the newest, newest first (no cap: blocks are never dropped) */
export function normalizeBlockedDoc(raw: unknown): BlockedDoc {
  if (!isObj(raw) || !Array.isArray(raw.items)) return emptyBlockedDoc()
  const byId = new Map<string, BlockedItem>()
  for (const v of raw.items) {
    if (!isObj(v) || !isLearnedKind(v.kind) || !isStr(v.key) || !v.key || !isStr(v.at) || !v.at) continue
    const item: BlockedItem = { kind: v.kind, key: v.key, label: isStr(v.label) && v.label ? v.label : v.key, at: v.at }
    const id = itemId(item.kind, item.key)
    const had = byId.get(id)
    if (!had || had.at < item.at) byId.set(id, item)
  }
  const items = [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return { items }
}

/** add (or refresh: new label + at) each item; newest first; same doc back when nothing given */
export function addBlocked(doc: BlockedDoc, add: BlockedItem[]): BlockedDoc {
  const fresh = add.filter((i) => isLearnedKind(i.kind) && isStr(i.key) && i.key)
  if (!fresh.length) return doc
  const ids = new Set(fresh.map((i) => itemId(i.kind, i.key)))
  const seen = new Set<string>()
  const front: BlockedItem[] = []
  for (const i of fresh) {
    const id = itemId(i.kind, i.key)
    if (seen.has(id)) continue
    seen.add(id)
    front.push({ kind: i.kind, key: i.key, label: i.label || i.key, at: i.at })
  }
  const rest = doc.items.filter((i) => !ids.has(itemId(i.kind, i.key)))
  return { items: [...front, ...rest] }
}

/** remove items by kind+key; same doc back when none matched */
export function removeBlocked(doc: BlockedDoc, remove: { kind: LearnedKind; key: string }[]): BlockedDoc {
  const ids = new Set(remove.filter((r) => isObj(r) && isLearnedKind(r.kind) && isStr(r.key)).map((r) => itemId(r.kind, r.key)))
  if (!ids.size) return doc
  const items = doc.items.filter((i) => !ids.has(itemId(i.kind, i.key)))
  return items.length === doc.items.length ? doc : { items }
}

export function isBlockedIn(doc: BlockedDoc, kind: LearnedKind, key: string): boolean {
  return doc.items.some((i) => i.kind === kind && i.key === key)
}

/** validate a delete request from IPC; keys deduped, empty / non-string keys dropped; null when unusable */
export function cleanDeleteRequest(raw: unknown): DeleteRequest | null {
  if (!isObj(raw) || !isLearnedKind(raw.kind) || !Array.isArray(raw.keys)) return null
  const keys = [...new Set(raw.keys.filter((k): k is string => isStr(k) && k.length > 0))]
  if (!keys.length || keys.length > DELETE_KEYS_MAX) return null
  const req: DeleteRequest = { kind: raw.kind, keys, block: raw.block === true }
  if (isObj(raw.labels)) {
    const labels: Record<string, string> = {}
    for (const k of keys) {
      const v = Object.prototype.hasOwnProperty.call(raw.labels, k) ? raw.labels[k] : undefined
      if (isStr(v) && v.trim()) labels[k] = v.trim()
    }
    if (Object.keys(labels).length) req.labels = labels
  }
  return req
}

/** validate an unblock list from IPC */
export function cleanUnblockList(raw: unknown): { kind: LearnedKind; key: string }[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is { kind: LearnedKind; key: string } => isObj(r) && isLearnedKind(r.kind) && isStr(r.key) && r.key.length > 0).map((r) => ({ kind: r.kind, key: r.key }))
}

export interface DeleteDeps {
  /** label per key, read before the delete (missing keys fall back to the key) */
  labels: (kind: LearnedKind, keys: string[]) => Map<string, string>
  /** removes the entries; returns how many went */
  remove: (kind: LearnedKind, keys: string[]) => number
}

/**
 * Delete (+ block) orchestration: labels are read first (the entries are gone after the delete),
 * then the delete, then the blocks. Label order: the learned entry's, then the request's, then the key.
 * reply.blocked counts keys newly added (already-blocked keys are refreshed, not counted).
 * Returns the reply and the next BLOCKED doc (same doc when nothing was blocked).
 */
export function runDelete(doc: BlockedDoc, raw: unknown, deps: DeleteDeps, at: string): { reply: DeleteReply; doc: BlockedDoc } {
  const req = cleanDeleteRequest(raw)
  if (!req) return { reply: { ok: false, deleted: 0, blocked: 0, error: 'bad request' }, doc }
  const labels = req.block ? deps.labels(req.kind, req.keys) : new Map<string, string>()
  const deleted = deps.remove(req.kind, req.keys)
  if (!req.block) return { reply: { ok: true, deleted, blocked: 0 }, doc }
  const added = req.keys.filter((key) => !isBlockedIn(doc, req.kind, key)).length
  const next = addBlocked(
    doc,
    req.keys.map((key) => ({ kind: req.kind, key, label: labels.get(key) || req.labels?.[key] || key, at }))
  )
  return { reply: { ok: true, deleted, blocked: added }, doc: next }
}

/** diagnostics '## BLOCKED' section */
export function blockedDiag(doc: BlockedDoc): { counts: Record<LearnedKind, number>; items: BlockedItem[] } {
  const counts: Record<LearnedKind, number> = { place: 0, site: 0, planet: 0 }
  for (const i of doc.items) counts[i.kind]++
  return { counts, items: doc.items }
}
