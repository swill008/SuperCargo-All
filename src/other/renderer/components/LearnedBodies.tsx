/**
 * LEARNED DATA → Sites and Planets (read-only): the planet table doc (other-bodies.json, main owns it).
 * Sites: generic places learned near a known place. Planets: radius from the panel ("exact") or estimated.
 */
import React, { useMemo } from 'react'
import { C, F } from '@renderer/theme'
import { formatDistance } from '@other/otherNext'
import { useBodies } from '../state/otherBodiesStore'
import { ago } from './LearnedPlaces'

const cell: React.CSSProperties = { padding: '7px 8px 7px 0', borderBottom: `1px dotted ${C.lineFaint}`, verticalAlign: 'top' }
const head: React.CSSProperties = {
  ...cell, fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, textAlign: 'left', fontWeight: 'normal',
  borderBottom: `1px solid ${C.lineStrong}`
}
const num: React.CSSProperties = { ...cell, fontFamily: F.mono, fontSize: 12, color: C.dim }
const empty: React.CSSProperties = { fontFamily: F.body, fontSize: 12, color: C.dim, padding: '6px 0' }

const km = (m: number): string => `${Math.round(m / 1000).toLocaleString()} km`

export function LearnedSites(): React.ReactElement {
  const { learned } = useBodies()
  const now = Date.now()
  const rows = useMemo(() => [...learned].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '')), [learned])
  if (!rows.length) return <div style={empty}>No sites learned yet.</div>
  return (
    <table data-testid="learned-sites" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: F.body, fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ ...head, width: '22%' }}>SITE</th>
          <th style={{ ...head, width: '36%' }}>AT</th>
          <th style={{ ...head, width: '20%' }}>BODY</th>
          <th style={{ ...head, width: '8%', textAlign: 'right' }}>SEEN</th>
          <th style={{ ...head, width: '14%', paddingLeft: 10 }}>LAST SEEN</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={`${s.name}|${s.near}|${i}`} data-testid="learned-site">
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
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function LearnedPlanets(): React.ReactElement {
  const { bodies } = useBodies()
  const now = Date.now()
  const rows = useMemo(
    () => Object.values(bodies).sort((a, b) => (a.system || '').localeCompare(b.system || '') || a.name.localeCompare(b.name)),
    [bodies]
  )
  if (!rows.length) return <div style={empty}>No planets yet.</div>
  return (
    <table data-testid="learned-planets" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: F.body, fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ ...head, width: '24%' }}>PLANET</th>
          <th style={{ ...head, width: '18%' }}>SYSTEM</th>
          <th style={{ ...head, width: '30%' }}>RADIUS</th>
          <th style={{ ...head, width: '10%', textAlign: 'right' }}>SEEN</th>
          <th style={{ ...head, width: '18%', paddingLeft: 10 }}>LAST SEEN</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const exact = b.radiusSource === 'panel' && b.radiusM != null
          const r = exact ? b.radiusM : b.radiusEstM
          return (
            <tr key={`${b.system}|${b.name}`} data-testid="learned-planet">
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
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
