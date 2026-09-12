/**
 * Other-mode OCR review. Does not use CaptureModal or haul box/pickup fields.
 * Engine only: window.supercargo.ocrRun / ocrPreview.
 */
import React, { useMemo, useState } from 'react'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import Typeahead from './Typeahead'
import OcrCalibrator from './OcrCalibrator'
import { useStore } from '../state/store'
import { useOtherJobs } from '../state/otherJobs'
import { useOtherCapture } from '../state/otherCapture'
import { applyOcrRows } from '../state/otherOcr'
import { parseOtherOcrText, type OtherOcrRow } from '@shared/otherOcrParse'
import { miniBtn, outlineBtn } from '../pages/JobsPartsStyles'

type DraftRow = OtherOcrRow & { key: string }

let rowSeq = 0
const newKey = (): string => {
  rowSeq += 1
  return `row-${rowSeq}`
}

export default function OtherCaptureModal(): React.ReactElement | null {
  const open = useOtherCapture((s) => s.open)
  const jobId = useOtherCapture((s) => s.jobId)
  const close = useOtherCapture((s) => s.close)
  const job = useOtherJobs((s) => s.jobs.find((j) => j.id === jobId) ?? null)
  const locs = useStore((s) => s.locations)
  const comms = useStore((s) => s.commodities)
  const locations = useMemo(() => (locs ?? []).map((l) => l.name).filter(Boolean), [locs])
  const items = useMemo(() => (comms ?? []).map((c) => c.name).filter(Boolean), [comms])

  const [status, setStatus] = useState('')
  const [rawText, setRawText] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [reward, setReward] = useState(0)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [busy, setBusy] = useState(false)
  const [calibrating, setCalibrating] = useState(false)

  if (!open || !job) return null

  const locked = !!(job.objectivesLocked || job.steps.length > 0)

  const reset = (): void => {
    setStatus('')
    setRawText('')
    setPreview(null)
    setReward(0)
    setRows([])
    setBusy(false)
    setCalibrating(false)
    close()
  }

  const applyParse = (text: string, payout: number): void => {
    const parsed = parseOtherOcrText(text)
    setRows(parsed.rows.map((r) => ({ ...r, key: newKey() })))
    setReward(payout || parsed.reward || job.reward || 0)
  }

  const capture = async (): Promise<void> => {
    setBusy(true)
    setStatus('Capturing\u2026')
    try {
      const shot = await window.supercargo.ocrPreview?.()
      if (shot) setPreview(shot)
      const result = await window.supercargo.ocrRun()
      if (!result?.ok) {
        setStatus(result?.error || 'OCR failed')
        return
      }
      const text = result.rawText || ''
      setRawText(text)
      applyParse(text, result.reward || 0)
      setStatus(text ? 'Review the steps, then confirm.' : 'No text. Check the capture area in Settings.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'OCR failed')
    } finally {
      setBusy(false)
    }
  }

  const patch = (key: string, part: Partial<DraftRow>): void => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...part } : r)))
  }

  const confirm = (): void => {
    if (locked) {
      reset()
      return
    }
    applyOcrRows(job.id, {
      reward,
      rows: rows.map(({ kind, label, location, item, have, need }) => ({
        kind, label, location, item, have, need
      }))
    })
    reset()
  }

  const field: React.CSSProperties = {
    background: 'rgba(0,0,0,0.4)',
    border: `1px solid ${C.lineStrong}`,
    color: C.text,
    fontFamily: F.body,
    fontSize: 14,
    padding: '6px 8px',
    width: '100%'
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 50 }}>
      <div style={{ width: calibrating ? 940 : 720, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: C.black, border: '1px solid rgba(255,255,255,0.22)', fontFamily: F.body }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>IMPORT FROM OCR</div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{job.ref} \u00b7 {job.title}</div>
          </div>
          <Btn onClick={reset} style={{ ...miniBtn, border: 0 }}>CLOSE</Btn>
        </div>

        <div style={{ padding: 20 }}>
          {locked && (
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.amber, marginBottom: 12 }}>
              This job already has steps or was edited. This pass will not overwrite. Confirm just closes.
            </div>
          )}
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, marginBottom: 12 }}>
            Open the contract on the mobiGlas screen, then capture. Haul box / pickup fields are not used.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <Btn onClick={() => void capture()} style={outlineBtn} disabled={busy}>{busy ? 'WORKING\u2026' : 'CAPTURE'}</Btn>
            <Btn onClick={() => setCalibrating((v) => !v)} style={miniBtn}>{calibrating ? 'DONE, BACK TO CAPTURE' : 'ADJUST CAPTURE AREA'}</Btn>
            <Btn onClick={confirm} style={outlineBtn} disabled={busy || locked || !rows.some((r) => r.label.trim() || r.location.trim() || r.item?.trim())}>CONFIRM</Btn>
            <Btn onClick={reset} style={miniBtn}>CANCEL</Btn>
          </div>
          {calibrating && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.14em', color: C.text, marginBottom: 4 }}>ADJUST CAPTURE AREA</div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 14, lineHeight: 1.5 }}>
                Capture a preview, then drag the box over the contract objectives and resize the corner.
              </div>
              <OcrCalibrator />
            </div>
          )}
          {status && <div style={{ fontFamily: F.body, fontSize: 13, color: C.acc, marginBottom: 12 }}>{status}</div>}
          {preview && (
            <img src={preview} alt="OCR preview" style={{ width: '100%', maxHeight: 180, objectFit: 'contain', marginBottom: 12, border: `1px solid ${C.lineSoft}` }} />
          )}
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 6 }}>Reward</div>
          <input type="number" min={0} value={reward} onChange={(e) => setReward(Number(e.target.value))} style={{ ...field, width: 180, marginBottom: 14 }} />
          {rows.map((row, i) => (
            <div key={row.key} style={{ borderTop: `1px dotted ${C.lineFaint}`, paddingTop: 10, marginTop: 10 }}>
              <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 6 }}>Step {i + 1}</div>
              <div style={{ border: `1px solid ${C.lineStrong}`, background: 'rgba(0,0,0,0.4)', padding: '0 8px', marginBottom: 8 }}>
                <Typeahead
                  value={row.label || (row.location ? `Go to ${row.location}` : '')}
                  options={locations}
                  freeText
                  maxResults={12}
                  menuMinWidth={480}
                  wrapMenu
                  placeholder="Objective"
                  onChange={(v) => {
                    const loc = v.replace(/^Go\\s+to\\s+/i, '').trim()
                    patch(row.key, { label: v, location: loc || v })
                  }}
                  onSelect={(v) => {
                    const loc = v.replace(/^Go\\s+to\\s+/i, '').trim()
                    patch(row.key, { label: /^Go\\s/i.test(v) ? v : (row.kind === 'go' ? `Go to ${v}` : v), location: loc || v })
                  }}
                />
              </div>
              <div style={{ border: `1px solid ${C.lineStrong}`, background: 'rgba(0,0,0,0.4)', padding: '0 8px', marginBottom: 8 }}>
                <Typeahead value={row.item || ''} options={items} freeText maxResults={12} menuMinWidth={480} wrapMenu placeholder="Item" onChange={(v) => patch(row.key, { item: v })} onSelect={(v) => patch(row.key, { item: v })} />
              </div>
              <input type="number" min={1} value={row.need} onChange={(e) => patch(row.key, { need: Number(e.target.value) || 1 })} style={{ ...field, width: 100, marginBottom: 8 }} />
              <Btn onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))} style={miniBtn}>REMOVE</Btn>
            </div>
          ))}
          <Btn
            onClick={() => setRows((list) => [...list, { key: newKey(), kind: 'turnin', label: 'Objective', location: '', item: '', have: 0, need: 1 }])}
            style={{ ...miniBtn, marginTop: 12 }}
          >
            ADD STEP
          </Btn>
          {rawText && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ color: C.dim, fontSize: 12, cursor: 'pointer' }}>Raw OCR text</summary>
              <pre style={{ whiteSpace: 'pre-wrap', color: C.ghost, fontSize: 11, marginTop: 8 }}>{rawText}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
