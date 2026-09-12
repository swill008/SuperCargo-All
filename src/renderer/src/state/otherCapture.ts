/**
 * Other-mode OCR modal state. Separate from haul openCapture / CaptureModal.
 */
import { create } from 'zustand'

interface OtherCaptureState {
  open: boolean
  jobId: string | null
  openFor: (jobId: string) => void
  close: () => void
}

export const useOtherCapture = create<OtherCaptureState>((set) => ({
  open: false,
  jobId: null,
  openFor: (jobId) => set({ open: true, jobId }),
  close: () => set({ open: false, jobId: null })
}))
