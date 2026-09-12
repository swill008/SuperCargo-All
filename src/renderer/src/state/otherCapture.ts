/**
 * Other-mode OCR modal state. Separate from haul openCapture / CaptureModal.
 */
import { create } from 'zustand'
import { useStore } from './store'
import { resolveWorkMode } from '@shared/workMode'

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

/** Call after a live add. Do not use from init log replay. */
export function requestAutoOcrIfEnabled(jobId: string, stepsLength: number, locked?: boolean): void {
  if (stepsLength > 0 || locked) return
  const settings = useStore.getState().settings
  if (resolveWorkMode(settings.workMode) !== 'other') return
  if (!settings.otherAutoOcrOnImport) return
  useOtherCapture.getState().openFor(jobId, true)
}
