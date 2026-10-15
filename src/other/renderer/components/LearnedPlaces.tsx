/**
 * LEARNED DATA → Places (M6/M7, S1/S3/S4): summary bar (each count a filter), "Needs your eye",
 * disputed entries pinned on top of the table with KEEP MINE / USE WHERE I WAS, then every remembered game text with its
 * place and how it was learned: sortable, searchable, with Change (same picker as MatchFix) and Forget;
 * DELETE per row, tick boxes + DELETE SELECTED, DELETE SHOWN (batch 16; same confirm, optional block);
 * then the last 50 changes with Undo. Main owns other-matches.json; every write comes back as evt:other:memory.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { dlog } from '@renderer/state/log'
import { useStore } from '@renderer/state/store'
import { learnedPlace, memoryLabel, type MemoryChange, type MemoryEntry, type SetInput } from '@other/otherMemory'
import { formatDistance, formatPlaceWithBodySystem } from '@other/otherNext'
import { placeKey } from '@other/otherResolve'
import { useMemory } from '../state/otherMemoryStore'
import { offSourcePlaces, useMergedLocations } from '../state/otherPlaces'
import { clearLearnedFocus, useLearnedFocus } from '../state/learnedFocus'
import NeedsYourEye from './NeedsYourEye'
import { PlacePicker, fixBtn, memoryForget, memorySet } from './MatchFix'
import { DeleteBar, tickStyle, useDeleteFlow, useSelection, type DeleteItem } from './DeleteConfirm'

export type Kind = 'user' | 'learned' | 'unproven' | 'disputed'
type Filter = 'all' | 'game' | Kind
type SortCol = 'text' | 'place' | 'how' | 'seen' | 'last'

const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all', label: 'ALL' },
  { v: 'user', label: 'YOU SET' },
  { v: 'game', label: 'GAME' },
  { v: 'learned', label: 'LEARNED' },
  { v: 'unproven', label: 'UNPROVEN' },
  { v: 'disputed', label: 'DISPUTED' }
]
/** rows drawn at once; the rest are reached with search */
const ROWS_MAX = 100
/** how long a focused row stays lit */
const FLASH_MS = 4000

const WHAT: Record<MemoryChange['what'], string> = {
  'seen-new': 'new',
  confirm: 'confirmed',
  set: 'set',
  forget: 'forgot',
  proof: 'game proof',
  undo: 'undo'
}

/** one bucket per entry, matching its HOW LEARNED label: the four summary counts add up to the total */
export function kindOf(e: MemoryEntry): Kind {
  if (memoryLabel(e).startsWith('⚠')) return 'disputed'
  if (e.origin === 'user') return 'user'
  if (learnedPlace(e)) return 'learned'
  return 'unproven'
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
export function ago(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

const rowId = (key: string): string => `learned-row-${placeKey(key).replace(/[^a-z0-9]+/g, '-')}`

function labelColor(k: Kind): string {
  if (k === 'disputed') return C.amber
  if (k === 'user' || k === 'learned') return C.green
  return C.dim
}

function undo(index: number): void {
  dlog.info('other', 'match memory undo by user', { index })
  void window.supercargo.otherMemoryUndo(index).catch((e: unknown) =>
    dlog.warn('other', 'match memory undo failed', { error: (e as Error)?.message ?? String(e) })
  )
}

/** KEEP MINE: keep the user's place and clear the dispute (wrong 0, no wrongAt) */
function keepMine(e: MemoryEntry): void {
  if (!e.place) return
  const p: SetInput = { key: e.key, text: e.text, context: e.context || undefined, place: e.place, reset: true }
  dlog.info('other', 'match memory keep mine by user', { key: e.key, place: e.place })
  void window.supercargo.otherMemorySet(p).catch((err: unknown) =>
    dlog.warn('other', 'match memory keep mine failed', { error: (err as Error)?.message ?? String(err) })
  )
}

function changeText(c: MemoryChange): string {
  const before = c.before ? c.before.place ?? 'no place' : 'nothing'
  const after = c.after ? c.after.place ?? 'no place' : 'removed'
  return before === after ? after : `${before} → ${after}`
}

/** "you were at X (2 d ago)" / "you were 4 km from X (2 d ago)" */
function whereLine(e: MemoryEntry, now: number): string | null {
  const w = e.wrongAt?.[0]
  if (!w?.name) return null
  const at = w.meters != null && w.meters > 1000 ? `${formatDistance(w.meters)} from ${w.name}` : `at ${w.name}`
  return `you were ${at} (${ago(w.at, now)})`
}

function compare(col: SortCol, a: MemoryEntry, b: MemoryEntry): number {
  switch (col) {
    case 'text': return a.text.localeCompare(b.text, undefined, { sensitivity: 'base' })
    case 'place': return (a.place ?? '￿').localeCompare(b.place ?? '￿', undefined, { sensitivity: 'base' })
    case 'how': return memoryLabel(a).localeCompare(memoryLabel(b))
    case 'seen': return (a.seen ?? 0) - (b.seen ?? 0)
    case 'last': return (a.lastAt || '').localeCompare(b.lastAt || '')
  }
}

const COLS: { col: SortCol | null; label: string; width: string; align?: 'right' }[] = [
  { col: 'text', label: 'TEXT AS READ', width: '20%' },
  { col: 'place', label: 'PLACE', width: '25%' },
  { col: 'how', label: 'HOW LEARNED', width: '14%' },
  { col: 'seen', label: 'SEEN', width: '6%', align: 'right' },
  { col: 'last', label: 'LAST USED', width: '10%' },
  { col: null, label: '', width: '22%' }
]

/** what the delete confirm lists for an entry */
const deleteLabel = (e: MemoryEntry): string => (e.context ? `${e.text} (at ${e.context})` : e.text)

export default function LearnedPlaces(): React.ReactElement {
  const doc = useMemory()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ col: SortCol; desc: boolean }>({ col: 'last', desc: true })
  const [changing, setChanging] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const now = Date.now()
  const locations = useMergedLocations()
  // places a switched-off data source took away: the resolver can't use them, so say so on the row
  const haul = useStore((s) => s.locations)
  const off = useMemo(() => offSourcePlaces(haul ?? []), [haul, locations])

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { user: 0, learned: 0, unproven: 0, disputed: 0 }
    for (const e of doc.entries) c[kindOf(e)]++
    return c
  }, [doc.entries])

  // S7: MatchFix "Open in Learned Data" lands here on that entry; no entry → "Needs your eye"
  const focus = useLearnedFocus()
  useEffect(() => {
    if (focus === null) return
    const hit = focus ? doc.entries.some((e) => e.key === focus) : false
    clearLearnedFocus()
    if (hit) {
      setFilter('all')
      setQ('')
      setFlash(focus)
    } else setFlash('')
    // after the filter/search reset has rendered
    const id = hit ? rowId(focus) : 'learned-needs'
    // not cancelled on cleanup: clearing the focus re-runs this effect before the timer fires
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
    dlog.debug('other', 'learned data focus', { key: focus, hit })
  }, [focus, doc.entries])
  useEffect(() => {
    if (flash === null) return
    const t = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(t)
  }, [flash])

  const rows = useMemo(() => {
    const words = placeKey(q).split(' ').filter(Boolean)
    const keep = (e: MemoryEntry): boolean => {
      if (filter === 'game' && e.origin !== 'game') return false
      if (filter !== 'all' && filter !== 'game' && kindOf(e) !== filter) return false
      if (!words.length) return true
      const hay = placeKey(`${e.text} ${e.place ?? ''} ${e.context ?? ''}`)
      return words.every((w) => hay.includes(w))
    }
    const dir = sort.desc ? -1 : 1
    // disputed pinned on top, then the chosen column
    return doc.entries.filter(keep).sort((a, b) => {
      const pa = kindOf(a) === 'disputed' ? 0 : 1
      const pb = kindOf(b) === 'disputed' ? 0 : 1
      if (pa !== pb) return pa - pb
      return dir * compare(sort.col, a, b) || (b.lastAt || '').localeCompare(a.lastAt || '')
    })
  }, [doc.entries, filter, q, sort])

  const shown = useMemo(() => {
    const head = rows.slice(0, ROWS_MAX)
    // a focused row past the cut still shows
    if (flash && !head.some((e) => e.key === flash)) {
      const e = rows.find((x) => x.key === flash)
      if (e) head.push(e)
    }
    return head
  }, [rows, flash])

  // batch 16: tick boxes over every row the filter/search shows; DELETE SHOWN takes them all
  const shownItems = useMemo<DeleteItem[]>(() => rows.map((e) => ({ key: e.key, label: deleteLabel(e) })), [rows])
  const shownKeys = useMemo(() => shownItems.map((i) => i.key), [shownItems])
  const { sel, toggle, setAll, clear } = useSelection(shownKeys)
  const { ask, dialog } = useDeleteFlow('place', clear)
  const picked = shownItems.filter((i) => sel.has(i.key))
  const drawnAllOn = shown.length > 0 && shown.every((e) => sel.has(e.key))

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
  const cell: React.CSSProperties = { padding: '7px 8px 7px 0', borderBottom: `1px dotted ${C.lineFaint}`, verticalAlign: 'top' }
  const head: React.CSSProperties = {
    ...cell, fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim, textAlign: 'left', fontWeight: 'normal',
    borderBottom: `1px solid ${C.lineStrong}`
  }
  const SUMMARY: { k: Kind; label: string; color: string }[] = [
    { k: 'user', label: 'you set', color: C.green },
    { k: 'learned', label: 'learned', color: C.green },
    { k: 'unproven', label: 'unproven', color: C.dim },
    { k: 'disputed', label: '⚠ disputed', color: C.amber }
  ]

  return (
    <div style={{ fontFamily: F.body, fontSize: 13, color: C.textBody, padding: '8px 0 4px' }}>
      <div data-testid="learned-summary" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '6px 0 2px' }}>
        {SUMMARY.map((s, i) => (
          <React.Fragment key={s.k}>
            {i ? <span style={{ color: C.ghost }}>{'·'}</span> : null}
            <button
              type="button"
              data-testid={`learned-count-${s.k}`}
              title={filter === s.k ? 'Show all' : `Show only: ${s.label}`}
              onClick={() => setFilter(filter === s.k ? 'all' : s.k)}
              style={{
                background: filter === s.k ? C.accFill : 'transparent',
                border: `1px solid ${filter === s.k ? C.accBorder : 'transparent'}`,
                padding: '3px 8px', cursor: 'pointer', fontFamily: F.body, fontSize: 14, color: C.textBody
              }}
            >
              <span style={{ fontFamily: F.mono, fontSize: 16, color: counts[s.k] ? s.color : C.ghost, marginRight: 6 }}>{counts[s.k]}</span>
              {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <NeedsYourEye highlight={flash === ''} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 8px' }}>
        <input
          value={q}
          placeholder="Search text or place"
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
      {rows.length ? <DeleteBar selected={picked} shown={shownItems} onAsk={ask} testid="learned-places" /> : null}
      {rows.length ? (
        <table data-testid="learned-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: 26, paddingLeft: 4 }}>
                <input
                  type="checkbox"
                  aria-label="Select all drawn rows"
                  checked={drawnAllOn}
                  onChange={() => {
                    // header box ticks the drawn rows (up to 100); DELETE SHOWN covers the rest
                    if (drawnAllOn) setAll(false)
                    else for (const e of shown) if (!sel.has(e.key)) toggle(e.key)
                  }}
                  style={tickStyle}
                />
              </th>
              {COLS.map((c, i) => (
                <th
                  key={i}
                  style={{ ...head, width: c.width, textAlign: c.align ?? 'left', cursor: c.col ? 'pointer' : 'default', color: c.col && sort.col === c.col ? C.acc : C.dim }}
                  data-sort={c.col ?? undefined}
                  title={c.col ? 'Sort by this column' : undefined}
                  onClick={() => {
                    const col = c.col
                    if (!col) return
                    setSort((s) => (s.col === col ? { col, desc: !s.desc } : { col, desc: col === 'seen' || col === 'last' }))
                  }}
                >
                  {c.label}
                  {c.col && sort.col === c.col ? (sort.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const k = kindOf(e)
              const disputed = k === 'disputed'
              const where = disputed ? whereLine(e, now) : null
              const whereName = e.wrongAt?.[0]?.name
              const [placeName, ...chips] = e.place ? formatPlaceWithBodySystem(e.place, locations).split(' · ') : []
              const lit = flash === e.key
              return (
                <tr
                  key={e.key}
                  id={rowId(e.key)}
                  data-testid="learned-row"
                  data-key={e.key}
                  data-kind={k}
                  style={{
                    background: lit ? C.accFillStrong : disputed ? 'rgba(230,182,94,0.07)' : 'transparent',
                    outline: lit ? `1px solid ${C.acc}` : 'none',
                    transition: 'background 0.6s'
                  }}
                >
                  <td style={{ ...cell, paddingLeft: 4 }}>
                    <input
                      type="checkbox"
                      data-testid="learned-row-tick"
                      aria-label={`Select ${e.text}`}
                      checked={sel.has(e.key)}
                      onChange={() => toggle(e.key)}
                      style={tickStyle}
                    />
                  </td>
                  <td style={{ ...cell, wordBreak: 'break-word' }}>
                    <span style={{ color: C.text }}>{e.text}</span>
                    {e.context ? <div style={{ color: C.dim, fontSize: 11 }}>{`at ${e.context}`}</div> : null}
                  </td>
                  <td style={{ ...cell, wordBreak: 'break-word' }}>
                    {e.place ? (
                      <>
                        <span style={{ color: C.text }}>{placeName}</span>
                        {chips.length ? <div style={{ color: C.dim, fontSize: 11 }}>{chips.join(' · ')}</div> : null}
                      </>
                    ) : <span style={{ color: C.dim }}>no place</span>}
                    {e.place && off.has(e.place.toLowerCase()) ? (
                      <div
                        style={{ color: C.amber, fontSize: 11 }}
                        title={
                          off.get(e.place.toLowerCase()) === 'coords'
                            ? 'its coordinates come from a data source that is off; not used until it is back on'
                            : 'it comes from a data source that is off; not used until it is back on'
                        }
                      >{"place's source is off"}</div>
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
                  <td style={{ ...cell, color: labelColor(k) }}>
                    {memoryLabel(e)}
                    {where ? <div data-testid="learned-where" style={{ fontSize: 11, color: C.amber }}>{where}</div> : null}
                  </td>
                  <td style={{ ...cell, fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }}>{e.seen ?? 0}</td>
                  <td style={{ ...cell, paddingLeft: 10, fontFamily: F.mono, fontSize: 12, color: C.dim }} title={e.lastAt}>
                    {ago(e.lastAt, now)}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {disputed && e.place ? (
                        <Btn
                          type="button"
                          title={`Keep ${e.place} and clear the dispute`}
                          onClick={() => keepMine(e)}
                          style={{ ...fixBtn, color: C.green }}
                          hoverStyle={{ border: `1px solid ${C.green}` }}
                        >KEEP MINE</Btn>
                      ) : null}
                      {disputed && whereName ? (
                        <Btn
                          type="button"
                          title={`Set this text to mean ${whereName}`}
                          onClick={() => memorySet({ key: e.key, text: e.text, context: e.context || undefined, place: whereName })}
                          style={{ ...fixBtn, color: C.amber }}
                          hoverStyle={{ border: `1px solid ${C.amber}` }}
                        >USE WHERE I WAS</Btn>
                      ) : null}
                      <Btn
                        type="button"
                        onClick={() => setChanging(changing === e.key ? null : e.key)}
                        style={fixBtn}
                        hoverStyle={{ border: `1px solid ${C.acc}` }}
                      >CHANGE</Btn>
                      <Btn type="button" onClick={() => memoryForget(e.key)} style={fixBtn} hoverStyle={{ border: `1px solid ${C.acc}` }}>
                        FORGET
                      </Btn>
                      <Btn
                        type="button"
                        data-testid="learned-row-delete"
                        title="Delete permanently (no undo)"
                        onClick={() => ask([{ key: e.key, label: deleteLabel(e) }])}
                        style={{ ...fixBtn, color: C.red }}
                        hoverStyle={{ border: `1px solid ${C.red}` }}
                      >DELETE</Btn>
                    </div>
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
      {dialog}
      {rows.length > ROWS_MAX ? (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{`Showing ${ROWS_MAX}; search to find the rest.`}</div>
      ) : null}

      <div style={{ fontFamily: F.display, fontSize: 14, letterSpacing: '0.14em', color: C.text, margin: '22px 0 4px', paddingBottom: 6, borderBottom: `1px solid ${C.lineStrong}` }}>
        RECENT CHANGES
      </div>
      {doc.changes.length ? (
        doc.changes.map((c, i) => (
          <div
            key={`${c.at}-${i}`}
            data-testid="learned-change"
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
