/** JOB GUI Reskin — compact Edit table (objective / location / item / need). */
import React, { useEffect, useState } from 'react'
import { C, F } from '../theme'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import { type OtherJobEdit } from '../state/otherJobs'
import { OTHER_KIND_LABEL, type OtherJob, type OtherJobKind } from '@shared/otherJob'
import { miniBtn, outlineBtn } from './JobsPartsStyles'
import { OtherOcrShotView } from '../components/OtherOcrShotView'

const KINDS: OtherJobKind[] = ['delivery', 'collection', 'mining', 'salvage', 'hauling']
const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.lineStrong}`, color: C.text,
  fontFamily: F.body, fontSize: 13, padding: '5px 8px', width: '100%'
}
const head: React.CSSProperties = {
  fontFamily: F.display, fontSize: 10, letterSpacing: '0.14em', color: C.dim
}
const cell: React.CSSProperties = { border: `1px solid ${C.lineStrong}`, background: 'rgba(0,0,0,0.4)', padding: '0 6px' }
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '28px minmax(180px, 1.4fr) minmax(140px, 1fr) 130px 64px 78px',
  gap: 8,
  alignItems: 'center'
}

export function EditForm({ job, uex, onCancel, onSave }: {
  job: OtherJob
  uex: { locations: string[]; items: string[] }
  onCancel: () => void
  onSave: (edit: OtherJobEdit) => void
}): React.ReactElement {
  const [title, setTitle] = useState(job.title)
  const [kind, setKind] = useState<OtherJobKind>(job.kind)
  const [reward, setReward] = useState(job.reward)
  const [steps, setSteps] = useState(job.steps.map((s) => ({
    id: s.id, label: s.label || '', location: s.location, item: s.item ?? '', need: s.need || 1
  })))
  const [newLabel, setNewLabel] = useState('')
  const [newLoc, setNewLoc] = useState('')
  const [newItem, setNewItem] = useState('')
  const [newNeed, setNewNeed] = useState(1)
  const [shot, setShot] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.supercargo.getOtherOcrShot?.(job.id).then((url) => {
      if (live) setShot(url || null)
    })
    return () => { live = false }
  }, [job.id])
  const patchStep = (id: string, patch: Partial<(typeof steps)[0]>): void => {
    setSteps((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  const stepsForSave = (): OtherJobEdit['steps'] => {
    if (!newLoc.trim() && !newItem.trim() && !newLabel.trim()) return steps
    return [...steps, { id: `new-${steps.length}-${Date.now()}`, label: newLabel, location: newLoc, item: newItem, need: newNeed }]
  }
  return (
    <div style={{ padding: '0 0 16px 70px', overflow: 'visible' }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.acc, margin: '8px 0 12px' }}>EDIT {job.ref}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, marginBottom: 14, alignItems: 'start' }}>
        <div>
          <div style={{ ...head, marginBottom: 6 }}>OCR CAPTURE</div>
          {shot ? (
            <OtherOcrShotView src={shot} thumbMaxHeight={140} />
          ) : (
            <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>No capture this session.</div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 140px', gap: 10 }}>
          <label style={{ display: 'block' }}>
            <div style={{ ...head, marginBottom: 4 }}>TITLE</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ ...head, marginBottom: 4 }}>KIND</div>
            <select value={kind} onChange={(e) => setKind(e.target.value as OtherJobKind)} style={inputStyle}>
              {KINDS.map((k) => <option key={k} value={k}>{OTHER_KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ ...head, marginBottom: 4 }}>REWARD</div>
            <input type="number" min={0} value={reward} onChange={(e) => setReward(Number(e.target.value))} style={inputStyle} />
          </label>
        </div>
      </div>
      <div style={{ ...grid, marginBottom: 6 }}>
        <span style={head}>#</span>
        <span style={head}>OBJECTIVE</span>
        <span style={head}>LOCATION</span>
        <span style={head}>ITEM</span>
        <span style={head}>NEED</span>
        <span />
      </div>
      {steps.map((row, i) => (
        <div key={row.id} style={{ ...grid, marginBottom: 8 }}>
          <span style={{ fontFamily: F.display, fontSize: 13, color: C.dim }}>{i + 1}</span>
          <input value={row.label} onChange={(e) => patchStep(row.id, { label: e.target.value })} style={inputStyle} />
          <div style={cell}>
            <Typeahead value={row.location} options={uex.locations} freeText maxResults={12} menuMinWidth={480} wrapMenu onChange={(v) => patchStep(row.id, { location: v })} onSelect={(v) => patchStep(row.id, { location: v })} />
          </div>
          <div style={cell}>
            <Typeahead value={row.item} options={uex.items} freeText maxResults={12} menuMinWidth={320} wrapMenu onChange={(v) => patchStep(row.id, { item: v })} onSelect={(v) => patchStep(row.id, { item: v })} />
          </div>
          <input type="number" min={1} value={row.need} onChange={(e) => patchStep(row.id, { need: Number(e.target.value) })} style={inputStyle} />
          <Btn onClick={() => setSteps((rows) => rows.filter((r) => r.id !== row.id))} style={miniBtn}>REMOVE</Btn>
        </div>
      ))}
      <div style={{ ...grid, marginTop: 10 }}>
        <span style={{ fontFamily: F.display, fontSize: 13, color: C.dim }}>+</span>
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Objective" style={inputStyle} />
        <div style={cell}>
          <Typeahead value={newLoc} options={uex.locations} freeText maxResults={12} menuMinWidth={480} wrapMenu placeholder="Location" onChange={setNewLoc} onSelect={setNewLoc} />
        </div>
        <div style={cell}>
          <Typeahead value={newItem} options={uex.items} freeText maxResults={12} menuMinWidth={320} wrapMenu placeholder="Item" onChange={setNewItem} onSelect={setNewItem} />
        </div>
        <input type="number" min={1} value={newNeed} onChange={(e) => setNewNeed(Number(e.target.value))} style={inputStyle} />
        <Btn onClick={() => {
          if (!newLoc.trim() && !newItem.trim() && !newLabel.trim()) return
          setSteps((rows) => [...rows, { id: `new-${rows.length}-${Date.now()}`, label: newLabel, location: newLoc, item: newItem, need: newNeed }])
          setNewLabel(''); setNewLoc(''); setNewItem(''); setNewNeed(1)
        }} style={miniBtn}>ADD</Btn>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <Btn onClick={() => onSave({ title, kind, reward, steps: stepsForSave() })} style={outlineBtn}>SAVE</Btn>
        <Btn onClick={onCancel} style={miniBtn}>CANCEL</Btn>
      </div>
    </div>
  )
}
