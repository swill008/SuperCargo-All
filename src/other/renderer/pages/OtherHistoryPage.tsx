/** Other-mode History. Does not read haul history.json. */
import React, { useEffect, useMemo, useState } from 'react'
import { useOtherHistory } from '../state/otherHistory'
import { Btn } from '@renderer/components/ui'
import {
  OTHER_KIND_LABEL,
  OTHER_MOVED_LABEL,
  OTHER_OUTCOME_LABEL,
  type OtherHistoryEntry
} from '@other/otherJob'
import { C, F } from '@renderer/theme'
import PageHeader, { PAGE_PADDING } from '@renderer/components/PageHeader'
import { useStore } from '@renderer/state/store'
import { otherView, isShortLoop, shownSteps, HiddenToggle, JobTags, type OtherView } from './JobsPartsStyles'

interface Session { key: string; label: string; rows: OtherHistoryEntry[] }

function fmtStamp(t: number): string {
  const d = new Date(t)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** group by game session, newest first; entries without sessionAt go last under "Earlier" */
function bySession(rows: OtherHistoryEntry[]): Session[] {
  const map = new Map<string, OtherHistoryEntry[]>()
  for (const r of rows) {
    const k = r.sessionAt ?? ''
    map.set(k, [...(map.get(k) ?? []), r])
  }
  const keys = [...map.keys()].filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))
  if (map.has('')) keys.push('')
  return keys.map((k) => ({
    key: k || 'earlier',
    label: k ? (fmtStamp(Date.parse(k)) || k) : 'Earlier',
    rows: map.get(k)!
  }))
}

export default function OtherHistoryPage(): React.ReactElement {
  const history = useOtherHistory((s) => s.history)
  const clearAll = useOtherHistory((s) => s.clearAll)
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => {
    void window.supercargo.loadOtherJobs?.().then((doc) => useOtherHistory.getState().load(doc))
  }, [])
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !confirmClear) return
      e.preventDefault()
      setConfirmClear(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [confirmClear])
  const view = otherView(useStore((s) => s.settings))
  const [showDrops, setShowDrops] = useState(false)
  const sorted = useMemo(
    () => [...history].sort((a, b) => b.archivedAt - a.archivedAt),
    [history]
  )
  const drops = sorted.filter((r) => isShortLoop(r, r.outcome === 'abandoned', view.shortLoopSec))
  const listed = showDrops ? sorted : sorted.filter((r) => !drops.includes(r))
  const sessions = useMemo(() => (view.sessionSummary ? bySession(listed) : null), [listed, view.sessionSummary])
  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="HISTORY"
        subtitle={`${sorted.length} archived Other jobs \u00b7 haul history stays in Haul mode`}
        right={
          sorted.length > 0 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true)
                    return
                  }
                  clearAll()
                  setConfirmClear(false)
                }}
                style={{
                  fontFamily: F.display,
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  border: `1px solid ${C.accBorder}`,
                  color: C.acc,
                  background: 'transparent',
                  padding: '8px 12px'
                }}
              >
                {confirmClear ? 'CONFIRM CLEAR' : 'CLEAR HISTORY'}
              </Btn>
            </div>
          ) : null
        }
      />
      {sorted.length === 0 && (
        <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, padding: '24px 0' }}>
          Finished Other jobs land here after a log scan or Clear Finished Jobs.
        </div>
      )}
      {sessions
        ? sessions.map((g) => (
          <div key={g.key} style={{ marginBottom: 18 }}>
            <SessionHeader session={g} />
            {g.rows.map((row) => <Row key={row.id} row={row} view={view} />)}
          </div>
        ))
        : listed.map((row) => <Row key={row.id} row={row} view={view} />)}
      <HiddenToggle count={drops.length} shown={showDrops} onToggle={() => setShowDrops((v) => !v)} />
    </div>
  )
}

function SessionHeader({ session }: { session: Session }): React.ReactElement {
  const done = session.rows.filter((r) => r.outcome === 'completed')
  const dropped = session.rows.length - done.length
  const rep = done.reduce((n, r) => n + (r.rep ?? 0), 0)
  const stat = { fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em' }
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${C.accBorder}` }}>
      <span style={{ fontFamily: F.display, fontSize: 14, letterSpacing: '0.12em', color: C.acc }}>
        {session.key === 'earlier' ? 'EARLIER' : `SESSION \u00b7 ${session.label}`}
      </span>
      <span style={{ ...stat, color: C.green }}>{done.length} COMPLETED</span>
      <span style={{ ...stat, color: C.amber }}>{dropped} ABANDONED</span>
      {rep !== 0 && <span style={{ ...stat, color: C.text }}>{`${rep > 0 ? '+' : ''}${rep.toLocaleString()} REP`}</span>}
    </div>
  )
}

function Row({ row, view }: { row: OtherHistoryEntry; view: OtherView }): React.ReactElement {
  const stamp = fmtStamp(row.archivedAt)
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}`, padding: '14px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 140px 160px 140px', gap: 12, alignItems: 'center' }}>
        <span style={{ fontFamily: F.display, fontSize: 16, color: C.acc }}>{row.ref}</span>
        <div>
          <div style={{ fontFamily: F.body, fontSize: 15, color: C.text }}>{row.title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{stamp}</span>
            <JobTags rep={row.rep} sharedBy={row.sharedBy} view={view} />
          </div>
        </div>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.acc, border: `1px solid ${C.accBorder}`, padding: '3px 8px', textAlign: 'center' }}>
          {OTHER_KIND_LABEL[row.kind]}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: row.outcome === 'completed' ? C.green : C.amber }}>
          {OTHER_OUTCOME_LABEL[row.outcome]}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.dim }}>
          {OTHER_MOVED_LABEL[row.movedBy]}
        </span>
      </div>
      {shownSteps(row.steps, view).map((step) => (
        <div key={step.id} style={{ padding: '4px 0 4px 70px', fontFamily: F.body, fontSize: 13, color: C.dim, opacity: step.withdrawn ? 0.5 : 1 }}>
          {step.done ? '\u25c6' : '\u25c7'}{' '}
          <span style={{ textDecoration: step.withdrawn ? 'line-through' : undefined }}>{step.label}</span>
          {step.withdrawn && <span style={{ marginLeft: 8, fontFamily: F.display, fontSize: 10, letterSpacing: '0.12em', color: C.ghost }}>WITHDRAWN</span>}
        </div>
      ))}
    </div>
  )
}
