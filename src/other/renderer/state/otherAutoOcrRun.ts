/**
 * Single Other auto-OCR shot after Settings capture delay.
 * Empty job → same applyOcrRows fill as Import.
 * Job with steps + Include aUEC → reward only when parsed amount > 0 and job reward is 0.
 */
import { parseOtherOcrText } from '@other/otherOcrParse'
import { useOtherJobs } from './otherJobs'
import { useStore } from '@renderer/state/store'
import { applyOcrRows, applyOcrRewardOnly } from './otherOcr'
import { saveSessionOcrShot } from './otherOcrShot'

export async function runSilentAutoOcr(jobId: string, stillLive?: () => boolean): Promise<void> {
  const live = (): boolean => !stillLive || stillLive()
  const job = useOtherJobs.getState().jobs.find((j) => j.id === jobId)
  if (!job || job.objectivesLocked) return
  const includeAuec = !!useStore.getState().settings.otherOcrIncludeAuec
  const empty = job.steps.length === 0
  if (!empty && !(includeAuec && job.reward === 0)) return
  try {
    const shot = await window.supercargo.ocrPreview?.()
    if (!live()) return
    if (shot) saveSessionOcrShot(jobId, shot)
    const result = await window.supercargo.ocrRun()
    if (!live() || !result?.ok) return
    const parsed = parseOtherOcrText(result.rawText || '')
    const amount = Math.max(0, Number(result.reward) || 0) || parsed.reward || 0
    if (empty) {
      if (parsed.rows.length === 0 && !(amount > 0)) return
      applyOcrRows(jobId, { reward: amount, rows: parsed.rows })
      return
    }
    if (includeAuec && amount > 0) applyOcrRewardOnly(jobId, amount)
  } catch {
    /* manual Import later */
  }
}
