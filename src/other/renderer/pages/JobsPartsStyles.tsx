/** Add form and shared styles for Other-mode Jobs. */
import React from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import Typeahead from '@renderer/components/Typeahead'
import { type OtherJobDraft } from '../state/otherJobs'
import { OTHER_KIND_LABEL, type OtherJobKind, type OtherJob, type OtherStep } from '@other/otherJob'
import { otherSetting } from '@other/workMode'
import type { AppSettings } from '@shared/types'

const KINDS: OtherJobKind[] = ['delivery', 'collection', 'mining', 'salvage', 'hauling']

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
/** small inline tag (rep, shared) */
export const smallTag: React.CSSProperties = {
  fontFamily: F.display, fontSize: 10, letterSpacing: '0.1em', color: C.acc,
  border: `1px solid ${C.accBorder}`, padding: '1px 6px', whiteSpace: 'nowrap'
}

/** display options read once per render from settings */
export interface OtherView {
  showRep: boolean
  sharedBadge: boolean
  withdrawn: 'grey' | 'hide'
  shortLoopSec: number
  sessionSummary: boolean
}

export function otherView(settings: AppSettings | undefined): OtherView {
  return {
    showRep: !!otherSetting(settings, 'otherShowRep'),
    sharedBadge: !!otherSetting(settings, 'otherSharedBadge'),
    withdrawn: otherSetting(settings, 'otherWithdrawnSteps') === 'hide' ? 'hide' : 'grey',
    shortLoopSec: Math.max(0, Number(otherSetting(settings, 'otherHideShortLoopsSec')) || 0),
    sessionSummary: !!otherSetting(settings, 'otherSessionSummary')
  }
}

/** "+313 REP", or "+100–500 REP" (en dash) when the contract gives a range (repMax set and above rep) */
export function repText(rep: number, repMax?: number): string {
  const sign = rep > 0 ? '+' : ''
  const high = repMax != null && repMax > rep ? `\u2013${repMax.toLocaleString()}` : ''
  return `${sign}${rep.toLocaleString()}${high} REP`
}

/** rep / shared tags for a job or history entry */
export function JobTags({ rep, repMax, sharedBy, view }: { rep?: number; repMax?: number; sharedBy?: string; view: OtherView }): React.ReactElement | null {
  const showRep = view.showRep && !!rep
  const showShared = view.sharedBadge && !!sharedBy
  if (!showRep && !showShared) return null
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {showRep && <span style={smallTag}>{repText(rep!, repMax)}</span>}
      {showShared && <span style={{ ...smallTag, color: C.dim, borderColor: C.lineStrong }}>SHARED</span>}
    </span>
  )
}

/** steps to list: withdrawn ones dropped in 'hide' mode */
export function shownSteps(steps: OtherStep[], view: OtherView): OtherStep[] {
  return view.withdrawn === 'hide' ? steps.filter((s) => !s.withdrawn) : steps
}

/** same job with withdrawn steps removed, so they are never picked as next */
export function withoutWithdrawn(job: OtherJob): OtherJob {
  return job.steps.some((s) => s.withdrawn) ? { ...job, steps: job.steps.filter((s) => !s.withdrawn) } : job
}

/** abandoned quickly after accept (party accept/drop loop) */
export function isShortLoop(
  row: { acceptedAt?: string; endedAt?: string },
  abandoned: boolean,
  sec: number
): boolean {
  if (!abandoned || sec <= 0 || !row.acceptedAt || !row.endedAt) return false
  const a = Date.parse(row.acceptedAt)
  const e = Date.parse(row.endedAt)
  if (Number.isNaN(a) || Number.isNaN(e)) return false
  return e - a < sec * 1000
}

/** "N hidden (party drops)" toggle */
export function HiddenToggle({ count, shown, onToggle }: { count: number; shown: boolean; onToggle: () => void }): React.ReactElement | null {
  if (count === 0) return null
  return (
    <Btn onClick={onToggle} style={{ ...miniBtn, margin: '10px 0' }}>
      {shown ? `HIDE ${count} PARTY DROPS` : `${count} hidden (party drops)`}
    </Btn>
  )
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
