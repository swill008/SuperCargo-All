/** Job row for Other-mode Jobs page. */
import React from 'react'
import { C, F } from '../theme'
import { Btn } from '../components/ui'
import { type OtherJobEdit } from '../state/otherJobs'
import { OTHER_KIND_LABEL, jobProgress, type OtherJob } from '@shared/otherJob'
import { EditForm } from './JobsPartsUi'
import { miniBtn, tagStyle } from './JobsPartsStyles'
export { AddForm, miniBtn, outlineBtn } from './JobsPartsStyles'

export function JobRow({ job, uex, expanded, editing, onToggle, onEdit, onCancelEdit, onSaveEdit, onAbandon, onComplete, onImportOcr, onStep }: {
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
  onImportOcr: () => void
  onStep: (id: string) => void
}): React.ReactElement {
  const { done, total } = jobProgress(job)
  const statusColor = job.status === 'active' ? C.green : job.status === 'complete' ? C.dim : C.amber
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <Btn onClick={onToggle} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: '14px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '70px 1fr 140px 130px 90px 40px', gap: 12, alignItems: 'center' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: F.display, fontSize: 16, color: C.acc }}>{job.ref}</span>
          {(() => {
            const base = job.source === 'manual' ? 'MANUAL' : job.filledBy === 'ocr' ? 'OCR' : (job.filledBy === 'log' || job.source === 'log') ? 'LOG' : ''
            if (!base) return null
            const text = job.edited ? `${base} (edited)` : base
            return <span style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.08em', color: C.dim }}>{text}</span>
          })()}
        </span>
        <div>
          <div style={{ fontFamily: F.body, fontSize: 15, color: C.text }}>{job.title}</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{done}/{total} objectives</div>
        </div>
        <span style={tagStyle}>{OTHER_KIND_LABEL[job.kind]}</span>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{job.reward ? `${job.reward.toLocaleString()} aUEC` : '\u2014'}</span>
        <span style={{ fontFamily: F.display, fontSize: 12, letterSpacing: '0.12em', color: statusColor }}>{job.status.toUpperCase()}</span>
        <span style={{ color: C.ghost }}>{expanded ? '\u25b2' : '\u25bc'}</span>
      </Btn>
      {expanded && editing && (
        <EditForm job={job} uex={uex} onCancel={onCancelEdit} onSave={onSaveEdit} />
      )}
      {expanded && !editing && (
        <div style={{ padding: '0 0 16px 70px' }}>
          {job.steps.length === 0 && (
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '8px 0' }}>
              No objectives yet. Use EDIT or IMPORT FROM OCR.
            </div>
          )}
          {job.steps.map((step) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px dotted ${C.lineFaint}` }}>
              <span style={{ color: step.done ? C.green : C.acc }}>{step.done ? '\u25c6' : '\u25c7'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: F.body, fontSize: 14, color: step.done ? C.dim : C.textBody }}>{step.label}</span>
                {step.location ? (
                  <span style={{ display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>{step.location}</span>
                ) : null}
              </span>
              {job.status === 'active' && (
                <Btn onClick={() => onStep(step.id)} style={miniBtn}>{step.done ? 'UNDO' : 'DONE'}</Btn>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {job.status === 'active' && (
              <>
                <Btn onClick={onEdit} style={miniBtn}>EDIT</Btn>
                <Btn onClick={onComplete} style={miniBtn}>COMPLETE</Btn>
                <Btn onClick={onAbandon} style={miniBtn}>ABANDON</Btn>
              </>
            )}
            <Btn onClick={onImportOcr} style={miniBtn}>IMPORT FROM OCR</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
