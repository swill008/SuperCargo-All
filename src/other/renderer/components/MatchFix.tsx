/**
 * Fix a stop's match on the spot (M5): evidence lines, ✓ Right, ✗ Wrong → pick a place, Forget.
 * Writes go to main (otherMemorySet/Forget), which owns other-matches.json and broadcasts the new doc,
 * so this works in the overlay window too. DELETE AND BLOCK (batch 16) removes the stop's text from learned data for good. PlacePicker is shared with LEARNED DATA → Places; "Open in Learned Data" jumps there.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { dlog } from '@renderer/state/log'
import { matchWord, placeKey, type StopPlace } from '@other/otherResolve'
import type { Location } from '@shared/types'
import { useMergedLocations } from '../state/otherPlaces'
import { useMemoryLookup } from '../state/otherMemoryStore'
import { focusLearned } from '../state/learnedFocus'
import { DeleteConfirm } from './DeleteConfirm'
import { deleteLearned } from '../state/otherBlockedStore'

/** most picks shown at once */
const PICK_MAX = 30

export const fixBtn: React.CSSProperties = {
  padding: '4px 10px',
  border: `1px solid ${C.lineStrong}`,
  background: 'transparent',
  color: C.text,
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.08em',
  cursor: 'pointer'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.4)',
  border: `1px solid ${C.lineStrong}`,
  color: C.text,
  fontFamily: F.body,
  fontSize: 12,
  padding: '5px 8px'
}

/** main-process writes; log and swallow failures (the doc broadcast is the source of truth) */
export function memorySet(p: { key: string; text: string; context?: string; place: string }): void {
  dlog.info('other', 'match memory set by user', { key: p.key, place: p.place })
  void window.supercargo.otherMemorySet(p).catch((e: unknown) =>
    dlog.warn('other', 'match memory set failed', { error: (e as Error)?.message ?? String(e) })
  )
}

export function memoryForget(key: string): void {
  dlog.info('other', 'match memory forget by user', { key })
  void window.supercargo.otherMemoryForget(key).catch((e: unknown) =>
    dlog.warn('other', 'match memory forget failed', { error: (e as Error)?.message ?? String(e) })
  )
}

/** "Name · Body · System" in dim, for a pick row */
function placeSub(l: Location): string {
  return [l.body, l.system].filter(Boolean).join(' · ')
}

/**
 * Text search over the merged roster; `first` (runner-up candidates) listed before the rest.
 * Max 30 rows. Enter picks the top row, Esc cancels.
 */
export function PlacePicker({ first = [], initial = '', onPick, onCancel }: {
  first?: string[]
  initial?: string
  onPick: (name: string) => void
  onCancel: () => void
}): React.ReactElement {
  const locations = useMergedLocations()
  const [q, setQ] = useState(initial)
  const rows = useMemo(() => {
    const byKey = new Map<string, Location>()
    for (const l of locations) if (l.name && !byKey.has(placeKey(l.name))) byKey.set(placeKey(l.name), l)
    const words = placeKey(q).split(' ').filter(Boolean)
    const hit = (l: Location): boolean => {
      const hay = placeKey([l.name, l.code, l.body, l.system].filter(Boolean).join(' '))
      return words.every((w) => hay.includes(w))
    }
    const out: Location[] = []
    const seen = new Set<string>()
    for (const n of first) {
      const l = byKey.get(placeKey(n))
      if (l && !seen.has(placeKey(l.name)) && (!words.length || hit(l))) {
        seen.add(placeKey(l.name))
        out.push(l)
      }
    }
    for (const l of byKey.values()) {
      if (out.length >= PICK_MAX) break
      if (seen.has(placeKey(l.name)) || (words.length && !hit(l))) continue
      seen.add(placeKey(l.name))
      out.push(l)
    }
    return out.slice(0, PICK_MAX)
  }, [locations, first, q])
  const firstKeys = useMemo(() => new Set(first.map(placeKey)), [first])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        autoFocus
        value={q}
        placeholder="Search places"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && rows[0]) onPick(rows[0].name)
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        style={inputStyle}
      />
      <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.lineSoft}` }}>
        {rows.length ? rows.map((l) => (
          <Btn
            key={l.name}
            type="button"
            onClick={() => onPick(l.name)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 0,
              borderBottom: `1px dotted ${C.lineFaint}`, padding: '4px 8px', cursor: 'pointer', color: C.textBody,
              fontFamily: F.body, fontSize: 12
            }}
            hoverStyle={{ background: C.accFill, color: C.text }}
          >
            {firstKeys.has(placeKey(l.name)) ? <span style={{ color: C.acc, marginRight: 6 }}>{'★'}</span> : null}
            {l.name}
            {placeSub(l) ? <span style={{ color: C.dim, marginLeft: 6, fontSize: 11 }}>{placeSub(l)}</span> : null}
          </Btn>
        )) : (
          <div style={{ padding: '6px 8px', fontFamily: F.body, fontSize: 12, color: C.dim }}>No place matches.</div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn type="button" onClick={onCancel} style={fixBtn} hoverStyle={{ border: `1px solid ${C.acc}` }}>CANCEL</Btn>
      </div>
    </div>
  )
}

/** the place ✓ Right confirms: the generic site's parent, else the roster winner */
function chosenPlace(match: StopPlace): string | null {
  return match.site?.name || match.match?.name || null
}

/** generic sites remember per parent place (contract key) */
function contextOf(match: StopPlace): string | undefined {
  return match.site ? match.site.name : undefined
}

export function MatchFix({ match, anchor, onClose }: {
  match: StopPlace
  anchor: HTMLElement | null
  onClose: () => void
}): React.ReactElement | null {
  const lookup = useMemoryLookup()
  const entry = match.memoryKey ? lookup(match.memoryKey) : undefined
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // the confirm dialog sits outside this box: its clicks and Esc must not close the panel
  const confirmingRef = useRef(false)
  confirmingRef.current = confirming
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // below the tag, kept inside the window
  useLayoutEffect(() => {
    if (!anchor) return
    const place = (): void => {
      const r = anchor.getBoundingClientRect()
      const w = box.current?.offsetWidth ?? 320
      const h = box.current?.offsetHeight ?? 200
      const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4))
      const below = r.bottom + 4
      const top = below + h > window.innerHeight - 4 ? Math.max(4, r.top - h - 4) : below
      setPos({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, picking])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !confirmingRef.current) onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (confirmingRef.current) return
      const t = e.target as Node | null
      if (t && (box.current?.contains(t) || anchor?.contains(t))) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [anchor, onClose])

  const right = chosenPlace(match)
  const base = { key: match.memoryKey, text: match.text, context: contextOf(match) }
  const candidates = useMemo(
    () => [...new Set(match.candidates.map((c) => c.name).filter((n) => n && n !== right))],
    [match.candidates, right]
  )
  const canWrite = !!match.memoryKey && !!match.text
  /** the key FORGET uses: the stored entry's, else the stop's */
  const delKey = entry?.key ?? match.memoryKey

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Fix this match"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 1000, width: 340, maxWidth: 'calc(100vw - 8px)',
        maxHeight: 'calc(100vh - 8px)', overflowY: 'auto', boxSizing: 'border-box',
        background: C.black, border: '1px solid rgba(255,255,255,0.22)', padding: 10,
        fontFamily: F.body, fontSize: 12, color: C.textBody, textTransform: 'none', letterSpacing: 'normal',
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}
    >
      <div style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.08em', color: C.text, marginBottom: 4 }}>
        {matchWord(match.status)} {'·'} confidence {Math.round(match.confidence)}/10
      </div>
      <div style={{ color: C.dim, marginBottom: 6, wordBreak: 'break-word' }}>
        {'“'}{match.text}{'”'}{right ? ` → ${right}` : ' → no place'}
      </div>
      {match.evidence.length ? (
        <div style={{ marginBottom: 8 }}>
          {match.evidence.map((e, i) => (
            <div key={i} style={{ color: e.ok ? C.textBody : C.amber, lineHeight: 1.4 }}>
              {e.ok ? '+' : '−'} {e.text}
            </div>
          ))}
        </div>
      ) : null}
      {picking ? (
        <PlacePicker
          first={candidates}
          onPick={(name) => {
            memorySet({ ...base, place: name })
            onClose()
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn
            type="button"
            disabled={!canWrite || !right}
            title={right ? `Remember: this text means ${right}` : 'No place to confirm; pick one with Wrong'}
            onClick={() => {
              if (!right) return
              memorySet({ ...base, place: right })
              onClose()
            }}
            style={{ ...fixBtn, color: C.green, opacity: canWrite && right ? 1 : 0.45 }}
            hoverStyle={{ border: `1px solid ${C.green}` }}
          >{'✓'} RIGHT</Btn>
          <Btn
            type="button"
            disabled={!canWrite}
            onClick={() => setPicking(true)}
            style={{ ...fixBtn, color: C.amber, opacity: canWrite ? 1 : 0.45 }}
            hoverStyle={{ border: `1px solid ${C.amber}` }}
          >{'✗'} WRONG</Btn>
          {entry ? (
            <Btn
              type="button"
              onClick={() => {
                memoryForget(entry.key)
                onClose()
              }}
              style={fixBtn}
              hoverStyle={{ border: `1px solid ${C.acc}` }}
            >FORGET</Btn>
          ) : null}
          {delKey && match.text ? (
            <Btn
              type="button"
              data-testid="matchfix-delete-block"
              title="Delete this text from learned data for good, and block it so it is not learned again"
              onClick={() => setConfirming(true)}
              style={{ ...fixBtn, color: C.red }}
              hoverStyle={{ border: `1px solid ${C.red}` }}
            >DELETE AND BLOCK</Btn>
          ) : null}
        </div>
      )}
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <button
          type="button"
          data-testid="matchfix-open-learned"
          title={entry ? 'Show this entry on the LEARNED DATA tab' : 'Open the LEARNED DATA tab'}
          onClick={() => {
            focusLearned(entry?.key ?? match.memoryKey)
            onClose()
          }}
          style={{
            background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: C.acc,
            fontFamily: F.body, fontSize: 11, textDecoration: 'underline'
          }}
        >Open in Learned Data</button>
      </div>
      {confirming && delKey ? (
        <DeleteConfirm
          open
          labels={[match.text]}
          count={1}
          onDelete={(block) => {
            void deleteLearned({ kind: 'place', keys: [delKey], block, labels: { [delKey]: match.text } })
            setConfirming(false)
            onClose()
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>,
    document.body
  )
}
