// cleans personal data out of diagnostics text. TS port of test/replay/make_fixture.py:
// player handle -> PLAYER, own ids -> 1, other players' ids -> OWNER-n (same id, same n),
// network fields removed, IPv4 -> 0.0.0.0, OS username -> %USERNAME% only in home paths
// (\Users\<name>, /Users/<name>, /home/<name>) and as a whole value; never inside words or keys,
// since the name can be a common word (container user "root").

import * as os from 'node:os'

export interface Identity {
  handles: Set<string>
  own: Set<string>
  others: string[] // first-seen order, so OWNER-n is stable
}

const DROP_FIELDS = /\s(?:nickname="[^"]*"|playerGEID=\d+|remoteAddr=\S+|localAddr=\S+|session=\S+|node_id=\S+)/g
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g
const ID_MIN = 5 // shorter numbers are counts, not player ids

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function emptyIdentity(): Identity {
  return { handles: new Set(), own: new Set(), others: [] }
}

// own handle(s)/id(s) and other players' ids, from any lines (Game.log, trace lines)
export function learnIdentity(lines: Iterable<string>, into: Identity = emptyIdentity()): Identity {
  const other = (id: string): void => {
    if (id.length >= ID_MIN && !into.others.includes(id)) into.others.push(id)
  }
  for (const l of lines) {
    if (!l) continue
    for (const m of l.matchAll(/Player\[([^\]]+)\] PlayerId\[(\d+)\]/g)) {
      into.handles.add(m[1])
      into.own.add(m[2])
    }
    let m = /nickname="([^"]+)"/.exec(l)
    if (m) into.handles.add(m[1])
    m = /playerGEID=(\d+)/.exec(l)
    if (m) into.own.add(m[1])
    if (l.includes('<AccountLoginCharacterStatus_Character>')) {
      m = /\bname (\S+)/.exec(l)
      if (m) into.handles.add(m[1])
      m = /\bgeid (\d+)/.exec(l)
      if (m) into.own.add(m[1])
      m = /\baccountId (\d+)/.exec(l)
      if (m) into.own.add(m[1])
    }
    m = /ownerId\[(\d+)\]/.exec(l)
    if (m) other(m[1])
    m = /\bplayer_id\s+(\d+)/.exec(l)
    if (m) other(m[1])
  }
  return into
}

function osUser(): string {
  try {
    return os.userInfo().username
  } catch {
    return ''
  }
}

// OS user names that are ordinary words: never replaced outside home paths / whole values
const COMMON_USER_WORDS = new Set([
  'root', 'admin', 'administrator', 'user', 'users', 'guest', 'test', 'home', 'owner', 'player', 'default', 'public',
  'system', 'local', 'main', 'pc', 'desktop', 'gamer', 'steam', 'windows', 'dev', 'data', 'game', 'games', 'star', 'cargo'
])

// isKey: s is a JSON object key (no whole-value username rule)
export type Clean = (s: string, isKey?: boolean) => string

export function makeSanitizer(id: Identity, user = osUser()): Clean {
  const owner = new Map<string, string>()
  for (const pid of id.others) if (!id.own.has(pid)) owner.set(pid, `OWNER-${owner.size + 1}`)
  const own = [...id.own].filter((p) => p.length >= ID_MIN)
  const ownRe = own.length ? new RegExp(`\\b(?:${own.map(esc).join('|')})\\b`, 'g') : null
  const ownerRe = owner.size ? new RegExp(`\\b(?:${[...owner.keys()].map(esc).join('|')})\\b`, 'g') : null
  // longest first so "Bob" doesn't eat half of "Bobby"
  const handles = [...id.handles].filter((h) => h.length >= 2).sort((a, b) => b.length - a.length)
  const handleRe = handles.length ? new RegExp(handles.map(esc).join('|'), 'gi') : null
  // home-folder path segment; [\\/]+ also covers JSON-escaped backslashes; case-insensitive (Windows)
  const userRe =
    user && user.length >= 2
      ? new RegExp(`([\\\\/]+(?:Users|home|Documents and Settings)[\\\\/]+)${esc(user)}(?![\\w.-])`, 'gi')
      : null
  const userLc = user ? user.toLowerCase() : ''
  // a distinctive name (e.g. "jdoe42") is also cleaned as a whole word in text; a common word ("root", "admin") only in paths
  const wordRe =
    user && user.length >= 3 && !COMMON_USER_WORDS.has(userLc) ? new RegExp(`(?<![\\w.-])${esc(user)}(?![\\w.-])`, 'gi') : null

  return (s: string, isKey = false): string => {
    if (!s) return s
    if (userLc && !isKey && s.trim().toLowerCase() === userLc) return '%USERNAME%'
    let l = s.replace(/Player\[[^\]]+\] PlayerId\[\d+\]/g, 'Player[PLAYER] PlayerId[1]')
    l = l.replace(/ownerId\[(\d+)\]/g, (_m, p: string) => `ownerId[${owner.get(p) ?? '1'}]`)
    l = l.replace(DROP_FIELDS, '')
    l = l.replace(IPV4, '0.0.0.0')
    if (ownRe) l = l.replace(ownRe, '1')
    if (ownerRe) l = l.replace(ownerRe, (p) => owner.get(p) ?? p)
    if (handleRe) l = l.replace(handleRe, 'PLAYER')
    if (userRe) l = l.replace(userRe, '$1%USERNAME%')
    if (wordRe && !isKey) l = l.replace(wordRe, '%USERNAME%')
    return l
  }
}

// cleans every string (and object key) in a JSON-like value
export function sanitizeDeep(v: unknown, clean: Clean): unknown {
  if (typeof v === 'string') return clean(v)
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, clean))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k, true), sanitizeDeep(x, clean)]))
  }
  return v
}

// only the OS username (no game identity known): debug report, settings
export function userOnlySanitizer(): Clean {
  return makeSanitizer(emptyIdentity())
}
