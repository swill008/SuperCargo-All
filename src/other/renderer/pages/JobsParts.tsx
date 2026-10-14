/** Job row for Other-mode Jobs page. */
import React from 'react'
import { C, F } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { useStore } from '@renderer/state/store'
import { type OtherJobEdit } from '../state/otherJobs'
import { useMergedLocations } from '../state/otherPlaces'
import { formatPlaceWithBodySystem, stepIsPickup } from '@other/otherNext'
import { placeKey, resolveStopPlace, type StopPlace } from '@other/otherResolve'
import { otherSetting } from '@other/workMode'
import { MatchTag, stopPlaceText } from '../components/MatchTag'
import { useMemoryLookup } from '../state/otherMemoryStore'
import { OTHER_KIND_LABEL, type OtherJob } from '@other/otherJob'
import type { Location } from '@shared/types'
import { EditForm } from './JobsPartsUi'
import { stopIssue, worstIssue, issueRowStyle, issueColor } from '../stopIssue'
import { miniBtn, tagStyle, otherView, shownSteps, JobTags } from './JobsPartsStyles'
export { AddForm, miniBtn, outlineBtn } from './JobsPartsStyles'

/**
 * One stop place: the text as read (log or scan), then the place it resolved to with its MatchTag.
 * The roster name alone when the two read the same; a done/inactive step (no live match) shows the import's sure rename untagged.
 */
function PlaceLine({ prefix, raw, place, match, roster }: {
  prefix: string
  raw?: string
  place: string
  match: StopPlace | null
  roster: Location[]
}): React.ReactElement {
  const read = (raw ?? place).trim() || place
  const resolved = match ? stopPlaceText(match, place, roster) : formatPlaceWithBodySystem(place, roster)
  const placeName = match ? (match.label || match.text || place) : place
  const same = placeKey(read) === placeKey(placeName)
  return (
    <span
      title={raw && raw !== place ? `As read: ${raw}` : undefined}
      style={{ display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}
    >
      {prefix}
      {same ? resolved : (
        <>
          <span style={{ color: C.textBody }}>{read}</span>
          {match || raw ? <span style={{ color: C.acc }}>{` \u2192 ${resolved}`}</span> : null}
        </>
      )}
      {match ? <span style={{ marginLeft: 8 }}><MatchTag match={match} /></span> : null}
    </span>
  )
}

export function JobRow({ job, uex, expanded, editing, onToggle, onEdit, onCancelEdit, onSaveEdit, onAbandon, onRestore, onComplete, onImportOcr, onStep }: {
  job: OtherJob
  uex: { locations: string[]; items: string[] }
  expanded: boolean
  editing: boolean
  onToggle: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (edit: OtherJobEdit) => void
  onAbandon: () => void
  onRestore: () => void
  onComplete: () => void
  onImportOcr: () => void
  onStep: (id: string) => void
}): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const view = otherView(settings)
  const useMarker = otherSetting(settings, 'otherMarkerDistance')
  // withdrawn steps don't count toward progress
  const live = job.steps.filter((s) => !s.withdrawn)
  const done = live.filter((s) => s.done).length
  const total = live.length
  const steps = shownSteps(job.steps, view)
  const roster = useMergedLocations()
  const memory = useMemoryLookup()
  // how sure each open step's next place is (same resolver as the Next tab and overlay); open steps of active jobs only
  const matches = new Map<string, StopPlace | null>()
  const matchOf = (step: OtherJob['steps'][number]): StopPlace | null => {
    if (job.status !== 'active' || step.done || step.withdrawn) return null
    if (!matches.has(step.id)) matches.set(step.id, resolveStopPlace(step, { locations: roster, useMarker, memory }, job))
    return matches.get(step.id) ?? null
  }
  // problem stops (shared rule in stopIssue.ts): the header shows the worst of the open steps
  const jobIssue = worstIssue(job.steps.map((s) => stopIssue(matchOf(s), s)))
  const redCount = job.steps.filter((s) => stopIssue(matchOf(s), s)?.level === 'red').length
  const chipText = jobIssue
    ? jobIssue.level === 'red'
      ? `\u2717 ${redCount} step${redCount === 1 ? '' : 's'} need${redCount === 1 ? 's' : ''} a place`
      : `? ${jobIssue.count} step${jobIssue.count === 1 ? '' : 's'} to check`
    : ''
  const statusColor = job.status === 'active' ? C.green : job.status === 'complete' ? C.dim : C.amber
  return (
    <div style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <Btn
        onClick={onToggle}
        data-issue={jobIssue?.level}
        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: jobIssue ? '14px 0 14px 8px' : '14px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '70px 1fr 140px 130px 90px 40px', gap: 12, alignItems: 'center', ...(jobIssue ? issueRowStyle(jobIssue.level) : null) }}
      >
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: F.body, fontSize: 15, color: C.text }}>{job.title}</span>
            {jobIssue ? (
              <span
                data-testid="issue-chip"
                data-issue={jobIssue.level}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!expanded) onToggle()
                }}
                style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.08em', color: issueColor(jobIssue.level), border: `1px solid ${issueColor(jobIssue.level)}`, padding: '1px 6px', cursor: 'pointer' }}
              >
                {chipText}
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{done}/{total} objectives</span>
            <JobTags rep={job.rep} repMax={job.repMax} sharedBy={job.sharedBy} view={view} />
          </div>
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
          {steps.length === 0 && (
            <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '8px 0' }}>
              No objectives yet. Use EDIT or IMPORT FROM OCR.
            </div>
          )}
          {steps.map((step) => {
            const match = matchOf(step)
            const issue = stopIssue(match, step)
            const pickupActive = stepIsPickup(step)
            return (
            <div key={step.id} data-issue={issue?.level} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: issue ? '7px 0 7px 8px' : '7px 0', borderBottom: `1px dotted ${C.lineFaint}`, opacity: step.withdrawn ? 0.5 : 1, ...(issue ? issueRowStyle(issue.level) : null) }}>
              <span style={{ color: step.withdrawn ? C.ghost : step.done ? C.green : C.acc }}>{step.done ? '\u25c6' : '\u25c7'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: F.body, fontSize: 14, color: step.done || step.withdrawn ? C.dim : C.textBody, textDecoration: step.withdrawn ? 'line-through' : undefined }}>{step.label}</span>
                {step.pickupLocation ? (
                  <PlaceLine
                    prefix="Collect: "
                    raw={step.pickupLocationRaw}
                    place={step.pickupLocation}
                    match={pickupActive ? match : null}
                    roster={roster}
                  />
                ) : null}
                {step.location ? (
                  <PlaceLine
                    prefix={step.pickupLocation ? 'Deliver: ' : ''}
                    raw={step.locationRaw}
                    place={step.location}
                    match={!pickupActive ? match : null}
                    roster={roster}
                  />
                ) : null}
              </span>
              {step.withdrawn && (
                <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.12em', color: C.ghost }}>WITHDRAWN</span>
              )}
              {job.status === 'active' && !step.withdrawn && (
                <Btn onClick={() => onStep(step.id)} style={miniBtn}>{step.done ? 'UNDO' : step.pickupLocation && !step.pickedUp ? 'GO HERE' : step.kind === 'turnin' ? 'TURN IN' : 'DONE'}</Btn>
              )}
            </div>
            )
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {job.status === 'active' && (
              <>
                <Btn onClick={onEdit} style={miniBtn}>EDIT</Btn>
                <Btn onClick={onComplete} style={miniBtn}>COMPLETE</Btn>
                <Btn onClick={onAbandon} style={miniBtn}>ABANDON</Btn>
              </>
            )}
            {job.status !== 'active' && (
              <Btn onClick={onRestore} style={miniBtn}>RESTORE</Btn>
            )}
            <Btn onClick={onImportOcr} style={miniBtn}>IMPORT FROM OCR</Btn>
          </div>
        </div>
      )}
    </div>
  )
}
