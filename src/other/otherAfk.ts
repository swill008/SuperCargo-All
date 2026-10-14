/**
 * AFK button: shared state type + pure helpers (key names -> scan codes, the press cycle as pure steps).
 * Main process side (timer, PowerShell key sender) is src/other/main/afk.ts.
 */

export interface AfkState {
  on: boolean
  startedAt?: string
  nextAt?: string
  endsAt?: string
  presses: number
  /** newest last, at most AFK_LAST_KEYS_MAX */
  lastKeys?: string[]
  lastError?: string
  dryRun?: boolean
}

export const AFK_LAST_KEYS_MAX = 5
export const AFK_INTERVAL_MIN_SEC = 5
export const AFK_INTERVAL_MAX_SEC = 600
/** a WHERE AM I read about once a minute while AFK is on */
export const AFK_WHERE_EVERY_MS = 60_000
/** ...taken this long after a key press, so the game has settled */
export const AFK_WHERE_DELAY_MS = 2_000
/** focus failures in a row before AFK gives up */
export const AFK_MAX_FOCUS_FAILS = 3

/** PS/2 set 1 scan code; ext = needs KEYEVENTF_EXTENDEDKEY */
export interface ScanCode {
  scan: number
  ext: boolean
}

const FKEYS: Record<string, number> = {
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40,
  F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58
}

const LETTERS: Record<string, number> = {
  Q: 0x10, W: 0x11, E: 0x12, R: 0x13, T: 0x14, Y: 0x15, U: 0x16, I: 0x17, O: 0x18, P: 0x19,
  A: 0x1e, S: 0x1f, D: 0x20, F: 0x21, G: 0x22, H: 0x23, J: 0x24, K: 0x25, L: 0x26,
  Z: 0x2c, X: 0x2d, C: 0x2e, V: 0x2f, B: 0x30, N: 0x31, M: 0x32
}

const DIGITS: Record<string, number> = {
  '1': 0x02, '2': 0x03, '3': 0x04, '4': 0x05, '5': 0x06,
  '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0a, '0': 0x0b
}

const OTHERS: Record<string, number> = { Escape: 0x01, Tab: 0x0f, Space: 0x39, Enter: 0x1c, Backspace: 0x0e }

const ALIASES: Record<string, string> = {
  ESC: 'Escape', ESCAPE: 'Escape', TAB: 'Tab', SPACE: 'Space', ENTER: 'Enter', RETURN: 'Enter', BACKSPACE: 'Backspace'
}

/** every key name the AFK settings accept, canonical spelling */
export const AFK_KEY_NAMES: readonly string[] = [
  ...Object.keys(FKEYS),
  ...Object.keys(OTHERS),
  ...Object.keys(LETTERS).sort(),
  ...Object.keys(DIGITS).sort()
]

/** 'f2' / ' F2 ' / 'esc' / 'm' -> canonical name ('F2', 'Escape', 'M'), or null when unknown */
export function normaliseAfkKey(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const t = name.trim()
  if (!t) return null
  const up = t.toUpperCase()
  if (up in FKEYS || up in LETTERS || up in DIGITS) return up
  if (up in ALIASES) return ALIASES[up]
  return null
}

/** scan code for a key name, or null when unknown */
export function afkScanCode(name: unknown): ScanCode | null {
  const k = normaliseAfkKey(name)
  if (!k) return null
  const scan = FKEYS[k] ?? LETTERS[k] ?? DIGITS[k] ?? OTHERS[k]
  return scan === undefined ? null : { scan, ext: false }
}

/** key for press number `index` (0-based): the first key once, then the cycle key */
export function afkKeyForPress(index: number, firstKey: string, cycleKey: string): string {
  return index <= 0 ? firstKey : cycleKey
}

export interface AfkConfig {
  intervalMs: number
  firstKey: string
  cycleKey: string
  /** 0 = no limit */
  maxMs: number
  whereRead: boolean
}

export interface AfkSettingsIn {
  otherAfkIntervalSec?: unknown
  otherAfkFirstKey?: unknown
  otherAfkCycleKey?: unknown
  otherAfkMaxMin?: unknown
  otherAfkWhereRead?: unknown
}

function num(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : dflt
}

/** settings -> config; unknown keys fall back to F2 / F1; intervalMsOverride (tests) skips the clamp */
export function afkConfig(s: AfkSettingsIn, intervalMsOverride?: number): AfkConfig {
  const sec = Math.min(AFK_INTERVAL_MAX_SEC, Math.max(AFK_INTERVAL_MIN_SEC, num(s.otherAfkIntervalSec, 15)))
  const maxMin = Math.max(0, num(s.otherAfkMaxMin, 120))
  return {
    intervalMs: intervalMsOverride !== undefined && intervalMsOverride > 0 ? intervalMsOverride : sec * 1000,
    firstKey: normaliseAfkKey(s.otherAfkFirstKey) ?? 'F2',
    cycleKey: normaliseAfkKey(s.otherAfkCycleKey) ?? 'F1',
    maxMs: maxMin * 60_000,
    whereRead: s.otherAfkWhereRead !== false
  }
}

export function afkOff(): AfkState {
  return { on: false, presses: 0 }
}

/** started now; the first press is due straight away */
export function afkStart(now: number, cfg: AfkConfig, dryRun: boolean): AfkState {
  const s: AfkState = {
    on: true,
    startedAt: new Date(now).toISOString(),
    nextAt: new Date(now).toISOString(),
    presses: 0,
    lastKeys: []
  }
  if (cfg.maxMs > 0) s.endsAt = new Date(now + cfg.maxMs).toISOString()
  if (dryRun) s.dryRun = true
  return s
}

/** the key the next press sends */
export function afkNextKey(s: AfkState, cfg: AfkConfig): string {
  return afkKeyForPress(s.presses, cfg.firstKey, cfg.cycleKey)
}

/** a key was sent at `now`: count it, next press one interval later */
export function afkPressed(s: AfkState, now: number, cfg: AfkConfig, key: string): AfkState {
  const lastKeys = [...(s.lastKeys ?? []), key].slice(-AFK_LAST_KEYS_MAX)
  const out: AfkState = { ...s, presses: s.presses + 1, lastKeys, nextAt: new Date(now + cfg.intervalMs).toISOString() }
  delete out.lastError
  return out
}

/** this cycle's press was skipped (focus failed): keep the count, try again next interval */
export function afkSkipped(s: AfkState, now: number, cfg: AfkConfig, error: string): AfkState {
  return { ...s, lastError: error, nextAt: new Date(now + cfg.intervalMs).toISOString() }
}

/** why AFK must stop at `now` before pressing, or null to carry on */
export function afkStopReason(s: AfkState, now: number): string | null {
  if (!s.on) return 'off'
  if (s.endsAt && now >= Date.parse(s.endsAt)) return 'time limit'
  return null
}

/** stopped; error (if any) kept as lastError so the UI can say why */
export function afkStopped(s: AfkState, error?: string): AfkState {
  const out: AfkState = { ...s, on: false }
  delete out.nextAt
  if (error) out.lastError = error
  return out
}

/** a WHERE AM I read is due after the press at `now` (none yet this AFK run, or a minute since the last) */
export function afkWhereDue(lastReadAt: number | null, now: number): boolean {
  return lastReadAt === null || now - lastReadAt >= AFK_WHERE_EVERY_MS
}

/** ms until the next press, never negative (for "next key in 12 s") */
export function afkMsToNext(s: AfkState, now: number): number | null {
  if (!s.on || !s.nextAt) return null
  return Math.max(0, Date.parse(s.nextAt) - now)
}
