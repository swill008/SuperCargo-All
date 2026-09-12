/** Other-mode Jobs page (Contracts analogue). Does not touch haul contracts. */
import React, { useMemo, useState } from 'react'
import { C, F } from '../theme'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import { useStore } from '../state/store'
import { useOtherJobs, type OtherJobDraft } from '../state/otherJobs'
import { useOtherHistory } from '../state/otherHistory'
import { useOtherCapture } from '../state/otherCapture'
import { JobRow, AddForm, miniBtn, outlineBtn } from './JobsParts'

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
  const clearFinished = useOtherHistory((s) => s.clearFinished)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<OtherJobDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const active = jobs.filter((j) => j.status === 'active')
  const finished = jobs.filter((j) => j.status !== 'active')
  const uex = useUexNames()
  const openOtherCapture = useOtherCapture((s) => s.openFor)

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="JOBS"
        subtitle={`${active.length} tracked \u00b7 Other mode \u00b7 click a job to expand objectives`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {finished.length > 0 && (
              <Btn onClick={() => void clearFinished()} style={miniBtn}>CLEAR FINISHED JOBS</Btn>
            )}
            <Btn onClick={() => setAdding((v) => !v)} style={outlineBtn}>{adding ? 'CANCEL' : '+ ADD JOB'}</Btn>
          </div>
        }
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
          onImportOcr={() => openOtherCapture(job.id)}
          onStep={(stepId) => toggleStep(job.id, stepId)}
        />
      ))}
    </div>
  )
}
