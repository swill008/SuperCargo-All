import React, { useEffect, useState } from 'react'
import type { RefDataFileState, RefDataStatus } from '@shared/types'
import { C, F } from '../theme'
import { Btn } from './ui'

const WORDS: Record<RefDataFileState, string> = {
  upToDate: 'Up to date',
  updated: 'Updated',
  downloadFailed: "Couldn't download",
  hashMismatch: "Fingerprint didn't match (kept the old copy)",
  badFormat: 'Format not understood (kept the old copy)',
  notChecked: 'Not checked yet'
}

const TONE: Record<RefDataFileState, string> = {
  upToDate: C.green,
  updated: C.green,
  downloadFailed: C.red,
  hashMismatch: C.amber,
  badFormat: C.amber,
  notChecked: C.dim
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "14 Oct 2026 21:05" in local time
export function fmtWhen(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// reference data panel in the Check for Updates window
export default function RefDataStatusPanel(): React.ReactElement {
  const [status, setStatus] = useState<RefDataStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.supercargo.getRefDataStatus().then((s) => {
      if (live) setStatus(s)
    })
    const off = window.supercargo.onRefData((s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])

  const check = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      setStatus(await window.supercargo.checkRefData())
    } finally {
      setBusy(false)
    }
  }

  const small: React.CSSProperties = { fontFamily: F.body, fontSize: 12, color: C.dim, lineHeight: 1.6 }
  return (
    <div data-testid="refdata-status" style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 12 }}>
      <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.12em', color: C.text }}>
        Reference data (ships, places, cargo grids)
      </div>
      {(status?.files ?? []).map((f) => (
        <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, alignItems: 'baseline' }} title={f.detail ?? ''}>
          <span style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>{f.label}</span>
          <span style={{ fontFamily: F.body, fontSize: 13, color: TONE[f.state] }}>{WORDS[f.state]}</span>
          <span style={{ ...small, fontFamily: F.mono }}>{f.state !== 'notChecked' && f.at ? fmtWhen(f.at) : ''}</span>
        </div>
      ))}
      <span style={small}>{status?.checkedAt ? `Last checked ${fmtWhen(status.checkedAt)}` : 'Last checked: never'}</span>
      <span style={small}>From the original SuperCargo author's data</span>
      <div>
        <Btn
          onClick={() => void check()}
          disabled={busy}
          style={{
            border: `1px solid ${C.lineStrong}`,
            background: 'transparent',
            color: busy ? C.dim : C.text,
            fontFamily: F.display,
            fontSize: 11,
            letterSpacing: '0.12em',
            padding: '6px 12px',
            cursor: busy ? 'default' : 'pointer'
          }}
          hoverStyle={busy ? {} : { borderColor: C.acc, color: C.acc }}
        >
          {busy ? 'CHECKING…' : 'CHECK NOW'}
        </Btn>
      </div>
    </div>
  )
}
