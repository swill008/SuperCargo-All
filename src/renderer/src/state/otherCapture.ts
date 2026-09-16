/**
 * Other-mode OCR modal state. Separate from haul openCapture / CaptureModal.
 * Auto-capture uses Settings ocrAutoCapture + ocrCaptureDelay (one engine).
 */
import { create } from 'zustand'
import { useStore } from './store'
import { resolveWorkMode } from '@shared/workMode'
import { runSilentAutoOcr } from './otherAutoOcrRun'

interface OtherCaptureState {
  open: boolean
  jobId: string | null
  autoRun: boolean
  openFor: (jobId: string, autoRun?: boolean) => void
  close: () => void
}

export const useOtherCapture = create<OtherCaptureState>((set) => ({
  open: false,
  jobId: null,
  autoRun: false,
  openFor: (jobId, autoRun = false) => set({ open: true, jobId, autoRun }),
  close: () => set({ open: false, jobId: null, autoRun: false })
}))

/** Live log accept. One delayed ocrRun; write path decided at fire time. */
export function requestAutoOcrIfEnabled(jobId: string): void {
  const settings = useStore.getState().settings
  if (resolveWorkMode(settings.workMode) !== 'other') return
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, Number(settings.ocrCaptureDelay) || 0) * 1000
  window.setTimeout(() => void runSilentAutoOcr(jobId), delayMs)
}
