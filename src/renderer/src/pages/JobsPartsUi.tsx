/** Edit form for Other-mode Jobs. */
import React, { useEffect, useState } from 'react'
import { C, F } from '../theme'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import { type OtherJobEdit } from '../state/otherJobs'
import { OTHER_KIND_LABEL, type OtherJob, type OtherJobKind } from '@shared/otherJob'
import { miniBtn, outlineBtn } from './JobsPartsStyles'
import { OtherOcrShotView } from '../components/OtherOcrShotView'

const KINDS: OtherJobKind[] = ['delivery', 'collection', 'mining', 'salvage']
const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.lineStrong}`, color: C.text,
  fontFamily: F.body, fontSize: 14, padding: '6px 8px', width: '100%'
}
function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{label}</span>
      {children}
    </div>
  )
}
function UexField({ label, value, options, placeholder, onChange }: {
  label: string
  value: string
  options: string[]
  placeholder?: string
  onChange: (v: string) => void
}): React.ReactElement {
  return (
    <Field label={label}>
      <div style={{ border: `1px solid ${C.lineStrong}`, background: 'rgba(0,0,0,0.4)', padding: '0 8px' }}>
        <Typeahead value={value} options={options} freeText maxResults={12} menuMinWidth={520} wrapMenu placeholder={placeholder} onChange={onChange} onSelect={onChange} />
      </div>
    </Field>
  )
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
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, marginBottom: 6 }}>OCR CAPTURE (this session)</div>
        {shot ? (
          <OtherOcrShotView src={shot} />
        ) : (
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>No capture this session. Use Import from OCR.</div>
        )}
      </div>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} /></Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value as OtherJobKind)} style={inputStyle}>
          {KINDS.map((k) => <option key={k} value={k}>{OTHER_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label="Reward"><input type="number" min={0} value={reward} onChange={(e) => setReward(Number(e.target.value))} style={{ ...inputStyle, width: 160 }} /></Field>
      {steps.map((row, i) => (
        <div key={row.id} style={{ borderTop: `1px dotted ${C.lineFaint}`, paddingTop: 8, marginTop: 8 }}>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 6 }}>Step {i + 1}</div>
          <Field label="Objective"><input value={row.label} onChange={(e) => patchStep(row.id, { label: e.target.value })} style={inputStyle} /></Field>
          <UexField label="Location" value={row.location} options={uex.locations} onChange={(v) => patchStep(row.id, { location: v })} />
          <UexField label="Item" value={row.item} options={uex.items} onChange={(v) => patchStep(row.id, { item: v })} />
          <Field label="Need"><input type="number" min={1} value={row.need} onChange={(e) => patchStep(row.id, { need: Number(e.target.value) })} style={{ ...inputStyle, width: 100 }} /></Field>
          <Btn onClick={() => setSteps((rows) => rows.filter((r) => r.id !== row.id))} style={miniBtn}>REMOVE STEP</Btn>
        </div>
      ))}
      <div style={{ borderTop: `1px dotted ${C.lineFaint}`, paddingTop: 8, marginTop: 12 }}>
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 6 }}>Add step (SAVE also keeps these fields)</div>
        <Field label="Objective"><input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={inputStyle} /></Field>
        <UexField label="Location" value={newLoc} options={uex.locations} placeholder="Shubin Mining Facility SAL-5" onChange={setNewLoc} />
        <UexField label="Item" value={newItem} options={uex.items} placeholder="Hadanite" onChange={setNewItem} />
        <Field label="Need"><input type="number" min={1} value={newNeed} onChange={(e) => setNewNeed(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} /></Field>
        <Btn onClick={() => {
          if (!newLoc.trim() && !newItem.trim() && !newLabel.trim()) return
          setSteps((rows) => [...rows, { id: `new-${rows.length}-${Date.now()}`, label: newLabel, location: newLoc, item: newItem, need: newNeed }])
          setNewLabel(''); setNewLoc(''); setNewItem(''); setNewNeed(1)
        }} style={miniBtn}>ADD STEP</Btn>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Btn onClick={() => onSave({ title, kind, reward, steps: stepsForSave() })} style={outlineBtn}>SAVE</Btn>
        <Btn onClick={onCancel} style={miniBtn}>CANCEL</Btn>
      </div>
    </div>
  )
}
