/** Other-mode Jobs page (Contracts analogue). Does not touch haul contracts. */
import React, { useMemo, useState } from 'react'
import { C, F, GLOW } from '../theme'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import { useStore } from '../state/store'
import { useOtherJobs, type OtherJobDraft, type OtherJobEdit } from '../state/otherJobs'
import { OTHER_KIND_LABEL, jobProgress, type OtherJob, type OtherJobKind } from '@shared/otherJob'

const KINDS: OtherJobKind[] = ['delivery', 'collection', 'mining', 'salvage']
const emptyDraft = (): OtherJobDraft => ({
  title: '', kind: 'delivery', reward: 0, location: '', item: '', need: 1
})

function useUexNames(): { locations: string[]; items: string[] } {
  const locs = useStore((s) => s.locations)
  const comms = useStore((s) => s.commodities)
  return useMemo(() => ({
    locations: (locs ?? []).map((l) => l.name).filter(Boolean),
    items: (comms ?? []).map((c) => c.name).filter(Boolean)
  }), [locs, comms])
}

export default function JobsPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const expandedId = useOtherJobs((s) => s.expandedId)
  const setExpanded = useOtherJobs((s) => s.setExpanded)
  const addJob = useOtherJobs((s) => s.addJob)
  const applyEdit = useOtherJobs((s) => s.applyEdit)
  const abandonJob = useOtherJobs((s) => s.abandonJob)
  const completeJob = useOtherJobs((s) => s.completeJob)
  const toggleStep = useOtherJobs((s) => s.toggleStep)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<OtherJobDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const active = jobs.filter((j) => j.status === 'active')
  const uex = useUexNames()

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="JOBS"
        subtitle={`${active.length} tracked · Other mode · click a job to expand objectives`}
        right={<Btn onClick={() => setAdding((v) => !v)} style={outlineBtn}>{adding ? 'CANCEL' : '+ ADD JOB'}</Btn>}
      />
      {adding && (
        <AddForm draft={draft} uex={uex} onChange={setDraft} onSave={() => { addJob(draft); setDraft(emptyDraft()); setAdding(false) }} />
      )}
      {jobs.length === 0 && !adding && (
        <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, padding: '24px 0' }}>
          No Other-mode jobs yet. Add one by hand. Haul contracts stay on Haul work mode.
        </div>
      )}
      {jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          uex={uex}
          expanded={expandedId === job.id}
          editing={editingId === job.id}
          onToggle={() => setExpanded(expandedId === job.id ? null : job.id)}
          onEdit={() => setEditingId(job.id)}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={(edit) => { applyEdit(job.id, edit); setEditingId(null) }}
          onAbandon={() => abandonJob(job.id)}
          onComplete={() => completeJob(job.id)}
          onStep={(stepId) => toggleStep(job.id, stepId)}
        />
      ))}
    </div>
  )
}

function JobRow({ job, uex, expanded, editing, onToggle, onEdit, onCancelEdit, onSaveEdit, onAbandon, onComplete, onStep }: {
  job: OtherJob
  uex: { locations: string[]; items: string[] }
  expanded: boolean
  editing: boolean
  onToggle: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (edit: OtherJobEdit) => void
  onAbandon: () => void
  onComplete: () => void
  onStep: (id: string) => void
}): React.ReactElement {
  const { done, total } = jobProgress(job)
  const statusColor = job.status === 'active' ? C.green : job.status === 'complete' ? C.dim : C.amber
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <Btn onClick={onToggle} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: '14px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '70px 1fr 140px 130px 90px 40px', gap: 12, alignItems: 'center' }}>
        <span style={{ fontFamily: F.display, fontSize: 16, color: C.acc }}>{job.ref}</span>
        <div>
          <div style={{ fontFamily: F.body, fontSize: 15, color: C.text }}>{job.title}</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{done}/{total} objectives</div>
        </div>
        <span style={tagStyle}>{OTHER_KIND_LABEL[job.kind]}</span>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{job.reward ? `${job.reward.toLocaleString()} aUEC` : '—'}</span>
        <span style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.12em', color: statusColor }}>{job.status.toUpperCase()}</span>
        <span style={{ color: C.ghost }}>{expanded ? '▲' : '▼'}</span>
      </Btn>
      {expanded && editing && (
        <EditForm job={job} uex={uex} onCancel={onCancelEdit} onSave={onSaveEdit} />
      )}
      {expanded && !editing && (
        <div style={{ padding: '0 0 16px 70px' }}>
          {job.steps.length === 0 && (
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '8px 0' }}>
              No objectives yet. Use EDIT to add a location / item.
            </div>
          )}
          {job.steps.map((step) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px dotted ${C.lineFaint}` }}>
              <span style={{ color: step.done ? C.green : C.acc }}>{step.done ? '◆' : '◇'}</span>
              <span style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: step.done ? C.dim : C.textBody }}>{step.label}</span>
              <Btn onClick={() => onStep(step.id)} style={miniBtn}>{step.done ? 'UNDO' : 'DONE'}</Btn>
            </div>
          ))}
          {job.status === 'active' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn onClick={onEdit} style={miniBtn}>EDIT</Btn>
              <Btn onClick={onComplete} style={miniBtn}>COMPLETE</Btn>
              <Btn onClick={onAbandon} style={miniBtn}>ABANDON</Btn>
            </div>
          )}
        </div>
      )}
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
        <Typeahead
          value={value}
          options={options}
          freeText
          maxResults={12}
          menuMinWidth={520}
          wrapMenu
          placeholder={placeholder}
          onChange={onChange}
          onSelect={onChange}
        />
      </div>
    </Field>
  )
}

function EditForm({ job, uex, onCancel, onSave }: {
  job: OtherJob
  uex: { locations: string[]; items: string[] }
  onCancel: () => void
  onSave: (edit: OtherJobEdit) => void
}): React.ReactElement {
  const [title, setTitle] = useState(job.title)
  const [kind, setKind] = useState<OtherJobKind>(job.kind)
  const [reward, setReward] = useState(job.reward)
  const [steps, setSteps] = useState(job.steps.map((s) => ({
    id: s.id, location: s.location, item: s.item ?? '', need: s.need || 1
  })))
  const [newLoc, setNewLoc] = useState('')
  const [newItem, setNewItem] = useState('')
  const [newNeed, setNewNeed] = useState(1)

  const patchStep = (id: string, patch: Partial<(typeof steps)[0]>): void => {
    setSteps((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <div style={{ padding: '0 0 16px 70px', overflow: 'visible' }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.acc, margin: '8px 0 12px' }}>EDIT {job.ref}</div>
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
          <UexField label="Location" value={row.location} options={uex.locations} onChange={(v) => patchStep(row.id, { location: v })} />
          <UexField label="Item" value={row.item} options={uex.items} onChange={(v) => patchStep(row.id, { item: v })} />
          <Field label="Need"><input type="number" min={1} value={row.need} onChange={(e) => patchStep(row.id, { need: Number(e.target.value) })} style={{ ...inputStyle, width: 100 }} /></Field>
          <Btn onClick={() => setSteps((rows) => rows.filter((r) => r.id !== row.id))} style={miniBtn}>REMOVE STEP</Btn>
        </div>
      ))}
      <div style={{ borderTop: `1px dotted ${C.lineFaint}`, paddingTop: 8, marginTop: 12 }}>
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 6 }}>Add step</div>
        <UexField label="Location" value={newLoc} options={uex.locations} placeholder="Shubin Mining Facility SAL-5" onChange={setNewLoc} />
        <UexField label="Item" value={newItem} options={uex.items} placeholder="Hadanite" onChange={setNewItem} />
        <Field label="Need"><input type="number" min={1} value={newNeed} onChange={(e) => setNewNeed(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} /></Field>
        <Btn onClick={() => {
          if (!newLoc.trim() && !newItem.trim()) return
          setSteps((rows) => [...rows, { id: `new-${rows.length}-${Date.now()}`, location: newLoc, item: newItem, need: newNeed }])
          setNewLoc(''); setNewItem(''); setNewNeed(1)
        }} style={miniBtn}>ADD STEP</Btn>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Btn onClick={() => onSave({ title, kind, reward, steps })} style={outlineBtn}>SAVE</Btn>
        <Btn onClick={onCancel} style={miniBtn}>CANCEL</Btn>
      </div>
    </div>
  )
}

function AddForm({ draft, uex, onChange, onSave }: {
  draft: OtherJobDraft
  uex: { locations: string[]; items: string[] }
  onChange: (d: OtherJobDraft) => void
  onSave: () => void
}): React.ReactElement {
  const set = (patch: Partial<OtherJobDraft>): void => onChange({ ...draft, ...patch })
  return (
    <div style={{ border: `1px solid ${C.lineStrong}`, background: C.accFill, padding: 16, marginBottom: 18, overflow: 'visible' }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.acc, marginBottom: 12 }}>NEW JOB</div>
      <Field label="Title"><input value={draft.title} onChange={(e) => set({ title: e.target.value })} style={inputStyle} /></Field>
      <Field label="Kind">
        <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as OtherJobKind })} style={inputStyle}>
          {KINDS.map((k) => <option key={k} value={k}>{OTHER_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <UexField label="Location" value={draft.location} options={uex.locations} placeholder="SMO-18 / wreck / Port Tressler" onChange={(v) => set({ location: v })} />
      <UexField label="Item" value={draft.item} options={uex.items} placeholder="Hadanite / Research Supplies" onChange={(v) => set({ item: v })} />
      <Field label="Need"><input type="number" min={1} value={draft.need} onChange={(e) => set({ need: Number(e.target.value) })} style={{ ...inputStyle, width: 100 }} /></Field>
      <Field label="Reward"><input type="number" min={0} value={draft.reward} onChange={(e) => set({ reward: Number(e.target.value) })} style={{ ...inputStyle, width: 160 }} /></Field>
      <Btn onClick={onSave} style={{ ...outlineBtn, marginTop: 8 }}>SAVE JOB</Btn>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{label}</span>
      {children}
    </div>
  )
}

const outlineBtn: React.CSSProperties = {
  border: `1px solid ${C.accBorder}`, background: 'transparent', color: C.acc,
  fontFamily: F.display, fontSize: 13, letterSpacing: '0.14em', padding: '8px 14px', cursor: 'pointer', textShadow: GLOW
}
const miniBtn: React.CSSProperties = {
  border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim,
  fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', padding: '4px 10px', cursor: 'pointer'
}
const tagStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.acc,
  border: `1px solid ${C.accBorder}`, padding: '3px 8px', textAlign: 'center'
}
const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.lineStrong}`, color: C.text,
  fontFamily: F.body, fontSize: 14, padding: '6px 8px', width: '100%'
}
