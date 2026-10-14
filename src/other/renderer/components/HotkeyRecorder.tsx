/**
 * Click-to-record hotkey field. Produces an Electron accelerator ('' = off).
 * While recording, all app global hotkeys are paused so the combo reaches this field.
 */
import React, { useEffect, useRef, useState } from 'react'
import { C, F } from '@renderer/theme'

type HotkeyApi = {
  otherHotkeysPause?: () => Promise<unknown>
  otherHotkeysResume?: () => Promise<unknown>
  otherHotkeyCheck?: (accel: string) => Promise<{ ok: boolean; reason?: 'invalid' | 'in-use' }>
}
// preload methods may be missing in an older build; call them optionally
const api = (): HotkeyApi => (window.supercargo ?? {}) as unknown as HotkeyApi

const PUNCT: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}
const NAMED: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

/** Electron key name for a KeyboardEvent.code, or null when not usable. */
export function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `num${m[1]}`
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (m) return `F${m[1]}`
  return PUNCT[code] ?? NAMED[code] ?? null
}

const isFKey = (k: string): boolean => /^F([1-9]|1[0-9]|2[0-4])$/.test(k)
const MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/

/** Accelerator from a keydown, or null (modifier-only / no modifier / unknown key). */
export function accelFromEvent(e: {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): string | null {
  if (MOD_CODES.test(e.code)) return null
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (mods.length === 0 && !isFKey(key)) return null
  return [...mods, key].join('+')
}

/** Comparable form: case-insensitive, Ctrl/Control/CmdOrCtrl = CommandOrControl, modifier order ignored. */
export function normAccel(a: string): string {
  const parts = a
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => (['ctrl', 'control', 'cmdorctrl', 'commandorcontrol', 'cmd', 'command'].includes(p) ? 'commandorcontrol' : p))
    .map((p) => (p === 'option' ? 'alt' : p))
  const key = parts.pop() ?? ''
  return [...parts.sort(), key].join('+')
}

export default function HotkeyRecorder({
  value,
  onChange,
  conflicts = []
}: {
  value: string
  onChange: (accel: string) => void
  /** other app hotkeys to warn about ('' entries ignored) */
  conflicts?: string[]
}): React.ReactElement {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  const [status, setStatus] = useState<string>('')
  const paused = useRef(false)

  const resume = (): void => {
    if (!paused.current) return
    paused.current = false
    void api().otherHotkeysResume?.()
  }
  const stop = (): void => {
    setRecording(false)
    setHint('')
    resume()
  }

  // resume if unmounted mid-recording
  useEffect(() => () => resume(), [])

  const save = (accel: string): void => {
    setStatus('')
    onChange(accel)
    stop()
    if (!accel) return
    // check after main has re-registered with the new value
    setTimeout(() => {
      const check = api().otherHotkeyCheck
      if (!check) return
      void check(accel)
        .then((r) => {
          if (r && !r.ok) setStatus(r.reason === 'invalid' ? 'not a valid key' : 'in use by another app')
        })
        .catch(() => undefined)
    }, 400)
  }

  const start = (): void => {
    if (recording) return
    setRecording(true)
    setHint('')
    setStatus('')
    paused.current = true
    void api().otherHotkeysPause?.()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!recording) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        start()
      }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
    if (plain && e.key === 'Escape') return stop()
    if (plain && (e.key === 'Backspace' || e.key === 'Delete')) return save('')
    if (MOD_CODES.test(e.code)) return // wait for the main key
    const accel = accelFromEvent(e)
    if (!accel) {
      setHint(keyFromCode(e.code) ? 'add Ctrl, Shift or Alt (F1–F24 work alone)' : 'that key can’t be used')
      return
    }
    save(accel)
  }

  const clash = value ? conflicts.find((c) => c && normAccel(c) === normAccel(value)) : undefined
  const warn = clash ? `also used by another hotkey here (${clash})` : status

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={start}
          onKeyDown={onKeyDown}
          onBlur={() => recording && stop()}
          title={recording ? 'Esc cancels · Backspace clears' : 'Click, then press the keys'}
          style={{
            flex: 1,
            minWidth: 0,
            cursor: 'pointer',
            border: `1px solid ${recording ? C.acc : 'rgba(255,255,255,0.16)'}`,
            color: recording ? C.acc : value ? C.text : C.faint,
            fontFamily: F.mono,
            fontSize: 12,
            padding: '8px 12px',
            outline: 'none',
            userSelect: 'none'
          }}
        >
          {recording ? hint || 'Press keys… (Esc cancels, Backspace clears)' : value || 'off — click to set'}
        </div>
        <span style={{ fontFamily: F.body, fontSize: 11, color: C.faint, flex: 'none' }}>global, Backspace = off</span>
      </div>
      {warn && !recording && <span style={{ fontFamily: F.body, fontSize: 11, color: C.amber }}>{warn}</span>}
    </div>
  )
}
