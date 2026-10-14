/**
 * Settings → LEARNED PLACES (M6/M7): what each remembered game text resolves to and how that was learned,
 * with Change (same picker as MatchFix), Forget, search and filter; then the last 50 changes with Undo.
 * Main owns other-matches.json; every write comes back as the evt:other:memory broadcast.
 */
import React, { useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { dlog } from '@renderer/state/log'
import { useStore } from '@renderer/state/store'
import { memoryLabel, type MemoryChange, type MemoryEntry } from '@other/otherMemory'
import { placeKey } from '@other/otherResolve'
import { useMemory } from '../state/otherMemoryStore'
import { offSourcePlaces, useMergedLocations } from '../state/otherPlaces'
import { PlacePicker, fixBtn, memoryForget, memorySet } from './MatchFix'

type Filter = 'all' | 'user' | 'game' | 'disputed'
const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all', label: 'ALL' },
  { v: 'user', label: 'YOU SET' },
  { v: 'game', label: 'GAME' },
  { v: 'disputed', label: 'DISPUTED' }
]
/** rows drawn at once; the rest are reached with search */
const ROWS_MAX = 100

const WHAT: Record<MemoryChange['what'], string> = {
  'seen-new': 'new',
  confirm: 'confirmed',
  set: 'set',
  forget: 'forgot',
  proof: 'game proof',
  undo: 'undo'
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
function ago(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

function labelColor(e: MemoryEntry): string {
  if (e.disputed) return C.amber
  if (e.origin === 'user') return C.green
  return e.confirmed >= 2 && e.confirmed > e.wrong ? C.green : C.dim
}

function undo(index: number): void {
  dlog.info('other', 'match memory undo by user', { index })
  void window.supercargo.otherMemoryUndo(index).catch((e: unknown) =>
    dlog.warn('other', 'match memory undo failed', { error: (e as Error)?.message ?? String(e) })
  )
}

function changeText(c: MemoryChange): string {
  const before = c.before ? c.before.place ?? 'no place' : 'nothing'
  const after = c.after ? c.after.place ?? 'no place' : 'removed'
  return before === after ? after : `${before} → ${after}`
}

export default function LearnedPlaces(): React.ReactElement {
  const doc = useMemory()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [changing, setChanging] = useState<string | null>(null)
  const now = Date.now()
  // places a switched-off data source took away: the resolver can't use them, so say so on the row
  const haul = useStore((s) => s.locations)
  const merged = useMergedLocations()
  const off = useMemo(() => offSourcePlaces(haul ?? []), [haul, merged])

  const rows = useMemo(() => {
    const words = placeKey(q).split(' ').filter(Boolean)
    const keep = (e: MemoryEntry): boolean => {
      if (filter === 'user' && e.origin !== 'user') return false
      if (filter === 'game' && e.origin !== 'game') return false
      if (filter === 'disputed' && !e.disputed) return false
      if (!words.length) return true
      const hay = placeKey(`${e.text} ${e.place ?? ''} ${e.context ?? ''}`)
      return words.every((w) => hay.includes(w))
    }
    return doc.entries.filter(keep).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
  }, [doc.entries, filter, q])

  const choiceStyle = (on: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    border: `1px solid ${on ? C.accBorder : C.lineStrong}`,
    background: on ? C.accFill : 'transparent',
    color: on ? C.acc : C.dim,
    fontFamily: F.display,
    fontSize: 11,
    letterSpacing: '0.08em',
    cursor: 'pointer'
  })
  const cell: React.CSSProperties = { padding: '6px 8px 6px 0', borderBottom: `1px dotted ${C.lineFaint}`, verticalAlign: 'top' }
  const head: React.CSSProperties = { ...cell, fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, textAlign: 'left', fontWeight: 'normal' }

  return (
    <div style={{ fontFamily: F.body, fontSize: 13, color: C.textBody, padding: '8px 0 4px' }}>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>
        Game place names the app was not sure about, and what it now takes them to mean. Fix one here or by clicking a
        match tag on a stop.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          value={q}
          placeholder="Search"
          onChange={(e) => setQ(e.target.value)}
          style={{
            width: 220, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.lineStrong}`, color: C.text,
            fontFamily: F.body, fontSize: 12, padding: '5px 8px'
          }}
        />
        {FILTERS.map((f) => (
          <button key={f.v} type="button" onClick={() => setFilter(f.v)} style={choiceStyle(filter === f.v)}>
            {f.label}
          </button>
        ))}
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>
          {rows.length === doc.entries.length ? `${rows.length}` : `${rows.length} of ${doc.entries.length}`}
        </span>
      </div>
      {rows.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: '42%' }}>GAME TEXT {'→'} PLACE</th>
              <th style={{ ...head, width: '24%' }}>HOW LEARNED</th>
              <th style={{ ...head, width: '13%' }}>LAST USED</th>
              <th style={{ ...head, width: '21%' }} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROWS_MAX).map((e) => {
              const where = e.disputed ? e.wrongAt?.[0] : undefined
              return (
                <tr key={e.key}>
                  <td style={{ ...cell, wordBreak: 'break-word' }}>
                    <span style={{ color: C.text }}>{e.text}</span>
                    {e.context ? <span style={{ color: C.dim }}>{` (at ${e.context})`}</span> : null}
                    <span style={{ color: C.dim }}>{' → '}</span>
                    <span style={{ color: e.place ? C.textBody : C.dim }}>{e.place ?? 'no place'}</span>
                    {e.place && off.has(e.place.toLowerCase()) ? (
                      <span
                        style={{ color: C.amber }}
                        title={
                          off.get(e.place.toLowerCase()) === 'coords'
                            ? 'its coordinates come from a data source that is off; not used until it is back on'
                            : 'it comes from a data source that is off; not used until it is back on'
                        }
                      >{" (place's source is off)"}</span>
                    ) : null}
                    {changing === e.key ? (
                      <div style={{ marginTop: 6 }}>
                        <PlacePicker
                          initial={e.text}
                          first={e.place ? [e.place] : []}
                          onPick={(name) => {
                            memorySet({ key: e.key, text: e.text, context: e.context || undefined, place: name })
                            setChanging(null)
                          }}
                          onCancel={() => setChanging(null)}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...cell, color: labelColor(e) }}>
                    {memoryLabel(e)}
                    {where?.name ? (
                      <div style={{ fontSize: 11, color: C.amber }}>{`you were at ${where.name}`}</div>
                    ) : null}
                  </td>
                  <td style={{ ...cell, fontFamily: F.mono, fontSize: 12, color: C.dim }} title={e.lastAt}>
                    {ago(e.lastAt, now)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Btn
                      type="button"
                      onClick={() => setChanging(changing === e.key ? null : e.key)}
                      style={{ ...fixBtn, marginRight: 6 }}
                      hoverStyle={{ border: `1px solid ${C.acc}` }}
                    >CHANGE</Btn>
                    <Btn type="button" onClick={() => memoryForget(e.key)} style={fixBtn} hoverStyle={{ border: `1px solid ${C.acc}` }}>
                      FORGET
                    </Btn>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: C.dim, padding: '6px 0' }}>
          {doc.entries.length ? 'Nothing matches.' : 'Nothing learned yet.'}
        </div>
      )}
      {rows.length > ROWS_MAX ? (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{`Showing ${ROWS_MAX}; search to find the rest.`}</div>
      ) : null}

      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, margin: '16px 0 4px' }}>
        RECENT CHANGES
      </div>
      {doc.changes.length ? (
        doc.changes.map((c, i) => (
          <div
            key={`${c.at}-${i}`}
            style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', borderBottom: `1px dotted ${C.lineFaint}`, fontSize: 12 }}
          >
            <span style={{ fontFamily: F.mono, color: C.dim, flex: 'none', width: 80 }} title={c.at}>{ago(c.at, now)}</span>
            <span style={{ flex: 'none', width: 80, color: c.by === 'user' ? C.acc : C.dim }}>{WHAT[c.what] ?? c.what}</span>
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              <span style={{ color: C.text }}>{c.text}</span>
              <span style={{ color: C.dim }}>{': '}</span>
              {changeText(c)}
            </span>
            <Btn type="button" onClick={() => undo(i)} style={fixBtn} hoverStyle={{ border: `1px solid ${C.acc}` }}>UNDO</Btn>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: C.dim, padding: '6px 0' }}>No changes yet.</div>
      )}
    </div>
  )
}
