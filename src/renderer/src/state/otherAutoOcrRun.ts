/**
 * Silent AUTO OCR ON path. No modal. Errors are left for Edit / Import later.
 */
import { parseOtherOcrText } from '@shared/otherOcrParse'
import { useOtherJobs } from './otherJobs'
import { applyOcrRows } from './otherOcr'
import { saveSessionOcrShot } from './otherOcrShot'

export async function runSilentAutoOcr(jobId: string): Promise<void> {
  const job = useOtherJobs.getState().jobs.find((j) => j.id === jobId)
  if (!job || job.objectivesLocked || job.steps.length > 0) return
  try {
    const shot = await window.supercargo.ocrPreview?.()
    if (shot) saveSessionOcrShot(jobId, shot)
    const result = await window.supercargo.ocrRun()
    if (!result?.ok) return
    const parsed = parseOtherOcrText(result.rawText || '')
    if (parsed.rows.length === 0 && !(result.reward > 0)) return
    applyOcrRows(jobId, {
      reward: result.reward || parsed.reward || 0,
      rows: parsed.rows
    })
  } catch {
    /* manual cleanup later */
  }
}
