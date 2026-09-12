/** Other-mode Next page (Manifest analogue). Groups open steps by location. */
import React, { useMemo } from 'react'
import { C, F } from '../theme'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import { useOtherJobs } from '../state/otherJobs'
import { nextOpenStep, type OtherJob, type OtherStep } from '@shared/otherJob'

interface OpenStop { job: OtherJob; step: OtherStep }

export default function NextPage(): React.ReactElement {
  const jobs = useOtherJobs((s) => s.jobs)
  const startLocation = useOtherJobs((s) => s.startLocation)
  const setStartLocation = useOtherJobs((s) => s.setStartLocation)
  const groupBy = useOtherJobs((s) => s.groupBy)
  const setGroupBy = useOtherJobs((s) => s.setGroupBy)
  const toggleStep = useOtherJobs((s) => s.toggleStep)

  const open = useMemo(() => {
    const rows: OpenStop[] = []
    for (const job of jobs) {
      if (job.status !== 'active') continue
      const step = nextOpenStep(job)
      if (step) rows.push({ job, step })
    }
    return rows
  }, [jobs])

  const groups = useMemo(() => {
    const map = new Map<string, OpenStop[]>()
    for (const row of open) {
      const key = groupBy === 'job' ? `${row.job.ref} ${row.job.title}` : row.step.location.trim() || 'Unspecified location'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [open, groupBy])

  const nearest = open[0]
  const activeCount = jobs.filter((j) => j.status === 'active').length

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="NEXT"
        subtitle={`${activeCount} jobs · ${open.length} open stops · Other mode`}
        right={
          <div style={{ display: 'flex', border: `1px solid ${C.lineStrong}` }}>
            {(['location', 'job'] as const).map((id) => {
              const on = groupBy === id
              return (
                <Btn key={id} onClick={() => setGroupBy(id)} style={{
                  border: 0, background: on ? C.accFill : 'transparent', color: on ? C.text : C.ghost,
                  fontFamily: F.display, fontSize: 12, letterSpacing: '0.14em', padding: '7px 12px', cursor: 'pointer'
                }}>{id.toUpperCase()}</Btn>
              )
            })}
          </div>
        }
      />
      <div style={{ display: 'flex', gap: 18, marginBottom: 22 }}>
        <Stat label="JOBS" value={String(activeCount)} />
        <Stat label="STOPS" value={String(open.length)} />
        <Stat label="NEAREST" value={nearest?.step.location || nearest?.step.label || '—'} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim }}>STARTING AT</span>
        <input value={startLocation} onChange={(e) => setStartLocation(e.target.value)} placeholder="where you are now" style={{
          background: 'transparent', border: 0, borderBottom: `1px solid ${C.lineStrong}`,
          color: C.text, fontFamily: F.body, fontSize: 14, padding: '4px 0', minWidth: 220
        }} />
      </div>
      {groups.length === 0 && <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim }}>No open stops. Add a job on the Jobs tab.</div>}
      {groups.map(([heading, rows]) => (
        <div key={heading} style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: F.display, fontSize: 16, color: C.text, marginBottom: 8 }}>{heading}</div>
          {rows.map(({ job, step }) => (
            <div key={step.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.lineFaint}` }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 14, color: C.textBody }}>{step.label}</div>
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, marginTop: 2 }}>{job.ref}</div>
              </div>
              <Btn onClick={() => toggleStep(job.id, step.id)} style={{
                border: `1px solid ${C.accBorder}`, background: 'transparent', color: C.acc,
                fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', padding: '6px 12px', cursor: 'pointer'
              }}>{step.kind === 'go' ? 'GO HERE' : 'TURN IN'}</Btn>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 22, color: C.text, marginTop: 4 }}>{value}</div>
    </div>
  )
}
