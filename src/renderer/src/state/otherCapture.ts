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
  autoBusy: boolean
  autoToken: number
  openFor: (jobId: string, autoRun?: boolean) => void
  close: () => void
  beginAuto: () => number
  cancelAuto: () => void
  finishAuto: (token: number) => void
}

export const useOtherCapture = create<OtherCaptureState>((set, get) => ({
  open: false,
  jobId: null,
  autoRun: false,
  autoBusy: false,
  autoToken: 0,
  openFor: (jobId, autoRun = false) => set({ open: true, jobId, autoRun }),
  close: () => set({ open: false, jobId: null, autoRun: false }),
  beginAuto: () => {
    const autoToken = get().autoToken + 1
    set({ autoBusy: true, autoToken })
    return autoToken
  },
  cancelAuto: () => set({ autoBusy: false, autoToken: get().autoToken + 1 }),
  finishAuto: (token) => {
    if (get().autoToken === token) set({ autoBusy: false })
  }
}))

/** Live log accept. One delayed ocrRun; write path decided at fire time. */
export function requestAutoOcrIfEnabled(jobId: string): void {
  const settings = useStore.getState().settings
  if (resolveWorkMode(settings.workMode) !== 'other') return
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, Number(settings.ocrCaptureDelay) || 0) * 1000
  const token = useOtherCapture.getState().beginAuto()
  window.setTimeout(() => {
    if (useOtherCapture.getState().autoToken !== token) return
    void runSilentAutoOcr(jobId, () => useOtherCapture.getState().autoToken === token).finally(() => {
      useOtherCapture.getState().finishAuto(token)
    })
  }, delayMs)
}
