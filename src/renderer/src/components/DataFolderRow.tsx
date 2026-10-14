import React, { useEffect, useState } from 'react'
import type { DataFolderChangeResult, DataFolderCheck, DataFolderInfo } from '@shared/types'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '210px 1fr',
  gap: 16,
  alignItems: 'center',
  padding: '15px 0',
  borderBottom: `1px solid ${C.lineSoft}`
}

const keyStyle: React.CSSProperties = { fontFamily: F.body, fontSize: 14, color: C.body }

// where history, jobs, logs and caches live; a change applies after a restart.
// A picked folder with damaged SuperCargo data shows a warning: RESET AND CONTINUE / CANCEL.
export default function DataFolderRow(): React.ReactElement {
  const [info, setInfo] = useState<DataFolderInfo | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [repair, setRepair] = useState<DataFolderCheck | null>(null)

  useEffect(() => {
    void window.supercargo.getDataFolder().then(setInfo)
  }, [])

  const show = (r: DataFolderChangeResult): void => {
    setInfo(r.info)
    if (r.canceled) return
    if (r.needsRepair) setRepair(r.needsRepair)
    else if (!r.ok) setErr(r.error ?? 'could not change the folder')
    else if (r.movedTo) setMsg(`Moved the old files to ${r.movedTo}. Copied ${r.copied ?? 0} file${r.copied === 1 ? '' : 's'}.`)
    else if (r.usedExisting) setMsg('Folder already has SuperCargo data; nothing copied.')
    else if (r.copied) setMsg(`Copied ${r.copied} file${r.copied === 1 ? '' : 's'}.`)
  }

  const run = async (call: () => Promise<DataFolderChangeResult>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setErr('')
    setMsg('')
    setRepair(null)
    try {
      show(await call())
    } finally {
      setBusy(false)
    }
  }

  const change = (reset: boolean): Promise<void> =>
    run(() => (reset ? window.supercargo.resetDataFolder() : window.supercargo.chooseDataFolder()))

  const note: React.CSSProperties = { fontFamily: F.body, fontSize: 12, color: C.dim, lineHeight: 1.6 }
  return (
    <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
      <span style={keyStyle}>Data folder</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text, wordBreak: 'break-all' }}>
          {info?.folder ?? '-'}
          {info?.isDefault && <span style={{ color: C.dim }}> (default)</span>}
        </span>
        {info?.fallback && (
          <span style={{ ...note, color: C.amber }}>{info.fallback}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <SmallBtn onClick={() => void change(false)}>CHANGE…</SmallBtn>
          <SmallBtn onClick={() => void window.supercargo.openDataFolder()}>OPEN FOLDER</SmallBtn>
          {info && (!info.isDefault || info.pending || info.fallback) && (
            <SmallBtn onClick={() => void change(true)}>RESET TO DEFAULT</SmallBtn>
          )}
        </div>
        {repair && (
          <RepairBox
            check={repair}
            onReset={() => void run(() => window.supercargo.repairDataFolder(repair.folder))}
            onCancel={() => setRepair(null)}
          />
        )}
        {msg && <span style={{ ...note, color: C.green }}>{msg}</span>}
        {err && <span style={{ ...note, color: C.red }}>{err}</span>}
        {info?.pending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={note}>Restart to use {info.pending}</span>
            <SmallBtn onClick={() => void window.supercargo.restartForDataFolder()}>RESTART NOW</SmallBtn>
          </div>
        )}
      </div>
    </div>
  )
}

// the picked folder's SuperCargo files can't be read: nothing is saved until RESET AND CONTINUE
function RepairBox({
  check,
  onReset,
  onCancel
}: {
  check: DataFolderCheck
  onReset: () => void
  onCancel: () => void
}): React.ReactElement {
  const text: React.CSSProperties = { fontFamily: F.body, fontSize: 12, color: C.body, lineHeight: 1.6 }
  return (
    <div
      role="alert"
      data-testid="data-folder-repair"
      style={{ border: `1px solid ${C.amber}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <span style={{ ...text, color: C.amber }}>⚠ This folder has SuperCargo data that can&apos;t be read:</span>
      <ul style={{ ...text, margin: 0, paddingLeft: 18 }}>
        {check.problems.map((p) => (
          <li key={p.file}>
            <span style={{ fontFamily: F.mono }}>{p.file}</span>: {p.reason}
          </li>
        ))}
      </ul>
      <span style={{ ...text, color: C.dim }}>
        Reset moves all SuperCargo files in {check.folder} into &quot;Moved for Repair\&lt;date&gt;&quot; so you can look at
        them. Your settings are kept. The current data is then copied in.
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SmallBtn onClick={onReset}>RESET AND CONTINUE</SmallBtn>
        <SmallBtn onClick={onCancel}>CANCEL</SmallBtn>
      </div>
    </div>
  )
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid rgba(255,255,255,0.18)`,
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.14em',
        padding: '6px 12px',
        cursor: 'pointer',
        flex: 'none'
      }}
      hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {children}
    </Btn>
  )
}
