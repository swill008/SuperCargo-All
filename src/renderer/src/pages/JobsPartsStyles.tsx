/** Add form and shared styles for Other-mode Jobs. */
import React from 'react'
import { C, F } from '../theme'
import { Btn } from '../components/ui'
import Typeahead from '../components/Typeahead'
import { type OtherJobDraft } from '../state/otherJobs'
import { OTHER_KIND_LABEL, type OtherJobKind } from '@shared/otherJob'

const KINDS: OtherJobKind[] = ['delivery', 'collection', 'mining', 'salvage']

export const outlineBtn: React.CSSProperties = {
  border: 0, background: C.acc, color: '#111',
  fontFamily: F.display, fontSize: 13, letterSpacing: '0.14em', fontWeight: 700, padding: '8px 14px', cursor: 'pointer'
}
export const miniBtn: React.CSSProperties = {
  border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim,
  fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', padding: '4px 10px', cursor: 'pointer'
}
export const tagStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.acc,
  border: `1px solid ${C.accBorder}`, padding: '3px 8px', textAlign: 'center'
}
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
      <div style={{ border: `1px solid ${C.lineStrong}`, background: 'rgba(255,255,255,0.02)', padding: '0 8px' }}>
        <Typeahead value={value} options={options} freeText maxResults={12} menuMinWidth={520} wrapMenu placeholder={placeholder} onChange={onChange} onSelect={onChange} />
      </div>
    </Field>
  )
}

export function AddForm({ draft, uex, onChange, onSave }: {
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
