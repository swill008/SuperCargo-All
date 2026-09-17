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
  const sorted = useMemo(
    () => [...history].sort((a, b) => b.archivedAt - a.archivedAt),
    [history]
  )
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
      {sorted.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </div>
  )
}

function Row({ row }: { row: OtherHistoryEntry }): React.ReactElement {
  const when = new Date(row.archivedAt)
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}`, padding: '14px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 140px 160px 140px', gap: 12, alignItems: 'center' }}>
        <span style={{ fontFamily: F.display, fontSize: 16, color: C.acc }}>{row.ref}</span>
        <div>
          <div style={{ fontFamily: F.body, fontSize: 15, color: C.text }}>{row.title}</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{stamp}</div>
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
      {row.steps.map((step) => (
        <div key={step.id} style={{ padding: '4px 0 4px 70px', fontFamily: F.body, fontSize: 13, color: C.dim }}>
          {step.done ? '\u25c6' : '\u25c7'} {step.label}
        </div>
      ))}
    </div>
  )
}
