/**
 * Single Other auto-OCR shot after Settings capture delay.
 * Empty job → same applyOcrRows fill as Import.
 * Job with steps + Include aUEC → reward only when parsed amount > 0 and job reward is 0.
 */
import { parseOtherOcrText } from '@other/otherOcrParse'
import { useOtherJobs } from './otherJobs'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { applyOcrRows, applyOcrRewardOnly } from './otherOcr'
import { saveSessionOcrShot } from './otherOcrShot'
import { resolveWorkMode } from '@other/workMode'

export async function runSilentAutoOcr(jobId: string, stillLive?: () => boolean): Promise<void> {
  // Other mode is re-checked at every step: a switch to Haul stops the shot
  const live = (): boolean =>
    resolveWorkMode(useStore.getState().settings.workMode) === 'other' && (!stillLive || stillLive())
  if (!live()) dlog.info('other', 'auto-ocr skip', { jobId, reason: 'not live (mode or cancelled)' })
  if (!live()) return
  const job = useOtherJobs.getState().jobs.find((j) => j.id === jobId)
  if (!job || job.objectivesLocked) dlog.info('other', 'auto-ocr skip', { jobId, reason: !job ? 'job not found' : 'job locked' })
  if (!job || job.objectivesLocked) return
  const includeAuec = !!useStore.getState().settings.otherOcrIncludeAuec
  const empty = job.steps.length === 0
  if (!empty && !(includeAuec && job.reward === 0)) dlog.info('other', 'auto-ocr skip', { ref: job.ref, reason: 'job has steps (and reward or aUEC off)' })
  if (!empty && !(includeAuec && job.reward === 0)) return
  const t0 = Date.now()
  try {
    const shot = await window.supercargo.ocrPreview?.()
    if (!live()) dlog.info('other', 'auto-ocr cancelled after preview', { ref: job.ref })
    if (!live()) return
    if (shot) saveSessionOcrShot(jobId, shot)
    const result = await window.supercargo.ocrRun()
    if (!live() || !result?.ok) {
      dlog.warn('other', 'auto-ocr no result', { ref: job.ref, cancelled: !live(), ok: !!result?.ok, error: result?.error, ms: Date.now() - t0 })
    }
    if (!live() || !result?.ok) return
    const parsed = parseOtherOcrText(result.rawText || '')
    const amount = Math.max(0, Number(result.reward) || 0) || parsed.reward || 0
    dlog.info('other', 'auto-ocr parsed', { ref: job.ref, rows: parsed.rows.length, amount, empty, ms: Date.now() - t0 })
    if (empty) {
      if (parsed.rows.length === 0 && !(amount > 0)) return
      dlog.info('other', 'auto-ocr apply rows', { ref: job.ref, rows: parsed.rows.length })
      applyOcrRows(jobId, { reward: amount, rows: parsed.rows })
      return
    }
    if (includeAuec && amount > 0) applyOcrRewardOnly(jobId, amount)
  } catch (e) {
    dlog.warn('other', 'auto-ocr failed', { ref: job.ref, error: (e as Error)?.message ?? String(e) })
    /* manual Import later */
  }
}
