/**
 * LEARNED DATA → Blocked (batch 16): what the user deleted and blocked, so the game doesn't learn it again.
 * UNBLOCK per row, or tick boxes + UNBLOCK SELECTED. Unblocking doesn't bring data back; it can be learned again.
 */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import type { BlockedItem, LearnedKind } from '@other/otherBlocked'
import { unblock, useBlocked } from '../state/otherBlockedStore'
import { actBtn, tickStyle, useSelection } from './DeleteConfirm'
import { ago } from './LearnedPlaces'

const LIST: Record<LearnedKind, string> = { place: 'Places', site: 'Sites', planet: 'Planets' }

const cell: React.CSSProperties = { padding: '7px 8px 7px 0', borderBottom: `1px dotted ${C.lineFaint}`, verticalAlign: 'top' }
const head: React.CSSProperties = {
  ...cell, fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, textAlign: 'left', fontWeight: 'normal',
  borderBottom: `1px solid ${C.lineStrong}`
}
const num: React.CSSProperties = { ...cell, fontFamily: F.mono, fontSize: 12, color: C.dim }

const idOf = (b: Pick<BlockedItem, 'kind' | 'key'>): string => `${b.kind}:${b.key}`

export default function BlockedList(): React.ReactElement {
  const { items } = useBlocked()
  const now = Date.now()
  const rows = useMemo(() => [...items].sort((a, b) => (b.at || '').localeCompare(a.at || '')), [items])
  const ids = useMemo(() => rows.map(idOf), [rows])
  const { sel, toggle, setAll, clear } = useSelection(ids)
  if (!rows.length) return <div data-testid="learned-blocked-empty" style={{ fontFamily: F.body, fontSize: 12, color: C.dim, padding: '6px 0' }}>Nothing blocked.</div>
  const picked = rows.filter((b) => sel.has(idOf(b)))
  const allOn = picked.length === rows.length
  return (
    <div style={{ fontFamily: F.body, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
        <Btn
          type="button"
          data-testid="learned-blocked-unblock-selected"
          disabled={!picked.length}
          onClick={() => {
            void unblock(picked.map(({ kind, key }) => ({ kind, key })))
            clear()
          }}
          style={picked.length ? actBtn : { ...actBtn, color: C.ghost, cursor: 'default' }}
          hoverStyle={picked.length ? { border: `1px solid ${C.acc}` } : undefined}
        >{`UNBLOCK SELECTED (${picked.length})`}</Btn>
      </div>
      <table data-testid="learned-blocked" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 26 }}>
              <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setAll(!allOn)} style={tickStyle} />
            </th>
            <th style={{ ...head, width: '46%' }}>BLOCKED</th>
            <th style={{ ...head, width: '16%' }}>LIST</th>
            <th style={{ ...head, width: '18%' }}>BLOCKED AT</th>
            <th style={{ ...head }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const id = idOf(b)
            return (
              <tr key={id} data-testid="learned-blocked-row" data-kind={b.kind} data-key={b.key}>
                <td style={cell}>
                  <input type="checkbox" aria-label={`Select ${b.label}`} checked={sel.has(id)} onChange={() => toggle(id)} style={tickStyle} />
                </td>
                <td style={{ ...cell, color: C.text, wordBreak: 'break-word' }}>{b.label || b.key}</td>
                <td style={{ ...cell, color: C.textBody }}>{LIST[b.kind] ?? b.kind}</td>
                <td style={num} title={b.at}>{ago(b.at, now)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <Btn
                    type="button"
                    data-testid="learned-blocked-unblock"
                    title="Unblock: it can be learned again (nothing comes back)"
                    onClick={() => void unblock([{ kind: b.kind, key: b.key }])}
                    style={actBtn}
                    hoverStyle={{ border: `1px solid ${C.acc}` }}
                  >UNBLOCK</Btn>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
