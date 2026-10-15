/**
 * LEARNED DATA → Sites and Planets: the planet table doc (other-bodies.json, main owns it).
 * Sites: generic places learned near a known place. Planets: radius from the panel ("exact") or estimated.
 * Batch 16: DELETE per row, tick boxes + DELETE SELECTED, DELETE SHOWN (same confirm). Deleting a planet removes
 * only its panel radius (the roster body stays).
 */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { formatDistance } from '@other/otherNext'
import { bodyKey, learnedKey } from '@other/otherBodies'
import { useBodies } from '../state/otherBodiesStore'
import { ago } from './LearnedPlaces'
import { DeleteBar, actBtn, tickStyle, useDeleteFlow, useSelection, type DeleteItem } from './DeleteConfirm'

const cell: React.CSSProperties = { padding: '7px 8px 7px 0', borderBottom: `1px dotted ${C.lineFaint}`, verticalAlign: 'top' }
const head: React.CSSProperties = {
  ...cell, fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, textAlign: 'left', fontWeight: 'normal',
  borderBottom: `1px solid ${C.lineStrong}`
}
const num: React.CSSProperties = { ...cell, fontFamily: F.mono, fontSize: 12, color: C.dim }
const empty: React.CSSProperties = { fontFamily: F.body, fontSize: 12, color: C.dim, padding: '6px 0' }

const km = (m: number): string => `${Math.round(m / 1000).toLocaleString()} km`

function DeleteBtn({ onClick, testid }: { onClick(): void; testid: string }): React.ReactElement {
  return (
    <Btn type="button" data-testid={testid} onClick={onClick} style={{ ...actBtn, color: C.red }} hoverStyle={{ border: `1px solid ${C.red}` }}>
      DELETE
    </Btn>
  )
}

/** header tick box: all rows on / off */
function TickAll({ on, onChange }: { on: boolean; onChange(): void }): React.ReactElement {
  return <input type="checkbox" aria-label="Select all" checked={on} onChange={onChange} style={tickStyle} />
}

export function LearnedSites(): React.ReactElement {
  const { learned } = useBodies()
  const now = Date.now()
  const rows = useMemo(() => [...learned].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')), [learned])
  const items = useMemo<DeleteItem[]>(() => rows.map((s) => ({ key: learnedKey(s.name, s.near), label: `${s.name} (near ${s.near})` })), [rows])
  const keys = useMemo(() => items.map((i) => i.key), [items])
  const { sel, toggle, setAll, clear } = useSelection(keys)
  const { ask, dialog } = useDeleteFlow('site', clear)
  if (!rows.length) return <div style={empty}>No sites learned yet.</div>
  const picked = items.filter((i) => sel.has(i.key))
  return (
    <>
      <DeleteBar selected={picked} shown={items} onAsk={ask} testid="learned-sites" />
      <table data-testid="learned-sites" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: F.body, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 26 }}><TickAll on={picked.length === items.length} onChange={() => setAll(picked.length !== items.length)} /></th>
            <th style={{ ...head, width: '20%' }}>SITE</th>
            <th style={{ ...head, width: '30%' }}>AT</th>
            <th style={{ ...head, width: '18%' }}>BODY</th>
            <th style={{ ...head, width: '7%', textAlign: 'right' }}>SEEN</th>
            <th style={{ ...head, width: '12%', paddingLeft: 10 }}>LAST SEEN</th>
            <th style={{ ...head }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const it = items[i]
            return (
              <tr key={`${s.name}|${s.near}|${i}`} data-testid="learned-site" data-key={it.key}>
                <td style={cell}>
                  <input type="checkbox" aria-label={`Select ${it.label}`} checked={sel.has(it.key)} onChange={() => toggle(it.key)} style={tickStyle} />
                </td>
                <td style={{ ...cell, color: C.text, wordBreak: 'break-word' }}>{s.name}</td>
                <td style={{ ...cell, color: C.textBody, wordBreak: 'break-word' }}>
                  {s.near}
                  <span style={{ color: C.dim, fontFamily: F.mono, fontSize: 12 }}>{` (${formatDistance(s.nearMeters)})`}</span>
                </td>
                <td style={{ ...cell, color: C.textBody }}>
                  {s.body ?? '—'}
                  {s.system ? <div style={{ color: C.dim, fontSize: 11 }}>{s.system}</div> : null}
                </td>
                <td style={{ ...num, textAlign: 'right' }}>{s.seen}</td>
                <td style={{ ...num, paddingLeft: 10 }} title={s.lastSeen}>{ago(s.lastSeen, now)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <DeleteBtn testid="learned-site-delete" onClick={() => ask([it])} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {dialog}
    </>
  )
}

export function LearnedPlanets(): React.ReactElement {
  const { bodies } = useBodies()
  const now = Date.now()
  const rows = useMemo(
    () => Object.values(bodies).sort((a, b) => (a.system || '').localeCompare(b.system || '') || a.name.localeCompare(b.name)),
    [bodies]
  )
  const items = useMemo<DeleteItem[]>(() => rows.map((b) => ({ key: bodyKey(b.name), label: b.name })), [rows])
  const keys = useMemo(() => items.map((i) => i.key), [items])
  const { sel, toggle, setAll, clear } = useSelection(keys)
  const { ask, dialog } = useDeleteFlow('planet', clear)
  if (!rows.length) return <div style={empty}>No planets yet.</div>
  const picked = items.filter((i) => sel.has(i.key))
  return (
    <>
      <DeleteBar selected={picked} shown={items} onAsk={ask} testid="learned-planets" />
      <table data-testid="learned-planets" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: F.body, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 26 }}><TickAll on={picked.length === items.length} onChange={() => setAll(picked.length !== items.length)} /></th>
            <th style={{ ...head, width: '22%' }}>PLANET</th>
            <th style={{ ...head, width: '16%' }}>SYSTEM</th>
            <th style={{ ...head, width: '27%' }}>RADIUS</th>
            <th style={{ ...head, width: '8%', textAlign: 'right' }}>SEEN</th>
            <th style={{ ...head, width: '14%', paddingLeft: 10 }}>LAST SEEN</th>
            <th style={{ ...head }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => {
            const it = items[i]
            const exact = b.radiusSource === 'panel' && b.radiusM != null
            const r = exact ? b.radiusM : b.radiusEstM
            return (
              <tr key={`${b.system}|${b.name}`} data-testid="learned-planet" data-key={it.key}>
                <td style={cell}>
                  <input type="checkbox" aria-label={`Select ${b.name}`} checked={sel.has(it.key)} onChange={() => toggle(it.key)} style={tickStyle} />
                </td>
                <td style={{ ...cell, color: C.text }}>
                  {b.name}
                  {b.type || b.parent ? (
                    <div style={{ color: C.dim, fontSize: 11 }}>{[b.type, b.parent ? `of ${b.parent}` : ''].filter(Boolean).join(' ')}</div>
                  ) : null}
                </td>
                <td style={{ ...cell, color: C.textBody }}>{b.system || '—'}</td>
                <td style={{ ...cell }}>
                  {r != null ? <span style={{ fontFamily: F.mono, fontSize: 12, color: C.text }}>{km(r)}</span> : <span style={{ color: C.dim }}>unknown</span>}
                  {r != null ? (
                    <span style={{ marginLeft: 8, fontSize: 12, color: exact ? C.green : C.dim }}>{exact ? 'exact (panel)' : 'estimated'}</span>
                  ) : null}
                </td>
                <td style={{ ...num, textAlign: 'right' }}>{b.seen}</td>
                <td style={{ ...num, paddingLeft: 10 }} title={b.lastSeen}>{b.lastSeen ? ago(b.lastSeen, now) : '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <DeleteBtn testid="learned-planet-delete" onClick={() => ask([it])} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {dialog}
    </>
  )
}
