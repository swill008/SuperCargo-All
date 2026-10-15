/**
 * Delete confirm (batch 16): "Delete permanently?" with a preview of what goes (up to 10 labels, then "and N more"),
 * Delete / Delete and block / Cancel. Esc cancels. Used by LEARNED DATA rows and lists, and by MatchFix.
 * Rendered in a portal with data-delete-confirm so outside-click handlers (MatchFix) can ignore it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import type { LearnedKind } from '@other/otherBlocked'
import { deleteLearned } from '../state/otherBlockedStore'

const PREVIEW_MAX = 10

/** same look as MatchFix's fixBtn (kept here: MatchFix imports this file) */
export const actBtn: React.CSSProperties = {
  padding: '4px 10px',
  border: `1px solid ${C.lineStrong}`,
  background: 'transparent',
  color: C.text,
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.08em',
  cursor: 'pointer'
}

export function DeleteConfirm({ open, title, labels, count, onDelete, onCancel }: {
  open: boolean
  /** default: "Delete permanently?" for one entry, "Delete N entries permanently?" for more */
  title?: string
  labels: string[]
  count: number
  onDelete(block: boolean): void
  onCancel(): void
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    // capture: Esc closes this dialog before any panel underneath sees it
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null
  const heading = title ?? (count > 1 ? `Delete ${count} entries permanently?` : 'Delete permanently?')
  const preview = labels.slice(0, PREVIEW_MAX)
  const more = Math.max(0, count - preview.length)

  return createPortal(
    <div
      data-delete-confirm=""
      data-testid="delete-confirm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        style={{
          width: 420, maxWidth: 'calc(100vw - 24px)', background: C.black, border: `1px solid ${C.accBorder}`,
          padding: '16px 18px', fontFamily: F.body, fontSize: 13, color: C.textBody, boxShadow: '0 8px 30px rgba(0,0,0,0.6)'
        }}
      >
        <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.1em', color: C.acc }}>{heading}</div>
        <div style={{ margin: '6px 0 10px', color: C.dim }}>{"This can't be undone."}</div>
        <ul data-testid="delete-confirm-preview" style={{ margin: 0, padding: '0 0 0 18px', maxHeight: 220, overflowY: 'auto' }}>
          {preview.map((l, i) => (
            <li key={i} style={{ color: C.text, wordBreak: 'break-word', padding: '1px 0' }}>{l}</li>
          ))}
        </ul>
        {more ? <div style={{ color: C.dim, marginTop: 4 }}>{`and ${more} more`}</div> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <Btn
            type="button"
            data-testid="delete-confirm-delete"
            onClick={() => onDelete(false)}
            style={{ ...actBtn, color: C.red }}
            hoverStyle={{ border: `1px solid ${C.red}` }}
          >Delete</Btn>
          <Btn
            type="button"
            data-testid="delete-confirm-block"
            title="Delete, and never learn it again until you unblock it"
            onClick={() => onDelete(true)}
            style={{ ...actBtn, color: C.red }}
            hoverStyle={{ border: `1px solid ${C.red}` }}
          >Delete and block</Btn>
          <Btn
            type="button"
            data-testid="delete-confirm-cancel"
            autoFocus
            onClick={onCancel}
            style={actBtn}
            hoverStyle={{ border: `1px solid ${C.acc}` }}
          >Cancel</Btn>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default DeleteConfirm

/** one row a list can delete: its key (contract form) and what the user sees */
export interface DeleteItem {
  key: string
  label: string
}

/** ask -> confirm -> otherDataDelete for one list; render `dialog` once in the list */
export function useDeleteFlow(kind: LearnedKind, onDone?: () => void): { ask(items: DeleteItem[]): void; dialog: React.ReactElement } {
  const [items, setItems] = useState<DeleteItem[] | null>(null)
  const cancel = useCallback(() => setItems(null), [])
  const run = useCallback(
    (block: boolean) => {
      const list = items ?? []
      setItems(null)
      if (!list.length) return
      void deleteLearned({ kind, keys: list.map((i) => i.key), block, labels: Object.fromEntries(list.map((i) => [i.key, i.label])) }).then((r) => {
        if (r.ok) onDone?.()
      })
    },
    [items, kind, onDone]
  )
  const dialog = (
    <DeleteConfirm
      open={!!items?.length}
      labels={(items ?? []).slice(0, PREVIEW_MAX).map((i) => i.label)}
      count={items?.length ?? 0}
      onDelete={run}
      onCancel={cancel}
    />
  )
  return { ask: (list) => setItems(list.length ? list : null), dialog }
}

/** tick-box selection over the keys a list shows; keys that leave the list drop out */
export function useSelection(keys: string[]): {
  sel: Set<string>
  toggle(key: string): void
  setAll(on: boolean): void
  clear(): void
} {
  const [raw, setRaw] = useState<Set<string>>(() => new Set())
  const sel = useMemo(() => {
    const live = new Set(keys)
    return new Set([...raw].filter((k) => live.has(k)))
  }, [raw, keys])
  return {
    sel,
    toggle: (key) =>
      setRaw((s) => {
        const n = new Set(s)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      }),
    setAll: (on) => setRaw(on ? new Set(keys) : new Set()),
    clear: () => setRaw(new Set())
  }
}

export const tickStyle: React.CSSProperties = { accentColor: C.acc, cursor: 'pointer', margin: 0 }

/** DELETE SELECTED (n) and DELETE SHOWN (n) for a list */
export function DeleteBar({ selected, shown, onAsk, testid }: {
  selected: DeleteItem[]
  shown: DeleteItem[]
  onAsk(items: DeleteItem[]): void
  testid: string
}): React.ReactElement {
  const danger = { ...actBtn, color: C.red }
  const off = { ...actBtn, color: C.ghost, cursor: 'default' }
  return (
    <div data-testid={`${testid}-delete-bar`} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
      <Btn
        type="button"
        data-testid={`${testid}-delete-selected`}
        disabled={!selected.length}
        onClick={() => onAsk(selected)}
        style={selected.length ? danger : off}
        hoverStyle={selected.length ? { border: `1px solid ${C.red}` } : undefined}
      >{`DELETE SELECTED (${selected.length})`}</Btn>
      <Btn
        type="button"
        data-testid={`${testid}-delete-shown`}
        title="Delete every row the current filter and search show"
        disabled={!shown.length}
        onClick={() => onAsk(shown)}
        style={shown.length ? danger : off}
        hoverStyle={shown.length ? { border: `1px solid ${C.red}` } : undefined}
      >{`DELETE SHOWN (${shown.length})`}</Btn>
    </div>
  )
}
