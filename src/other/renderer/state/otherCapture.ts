/**
 * Other-mode OCR modal state. Separate from haul openCapture / CaptureModal.
 * Auto-capture uses Settings ocrAutoCapture + ocrCaptureDelay (one engine).
 */
import { create } from 'zustand'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { resolveWorkMode } from '@other/workMode'
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
  openFor: (jobId, autoRun = false) => {
    dlog.info('other', 'capture modal open', { jobId, autoRun })
    set({ open: true, jobId, autoRun })
  },
  close: () => {
    dlog.debug('other', 'capture modal close')
    set({ open: false, jobId: null, autoRun: false })
  },
  beginAuto: () => {
    const autoToken = get().autoToken + 1
    set({ autoBusy: true, autoToken })
    return autoToken
  },
  cancelAuto: () => {
    dlog.info('other', 'auto-ocr cancel', { token: get().autoToken, wasBusy: get().autoBusy })
    set({ autoBusy: false, autoToken: get().autoToken + 1 })
  },
  finishAuto: (token) => {
    if (get().autoToken === token) set({ autoBusy: false })
  }
}))

/** Live log accept. One delayed ocrRun; write path decided at fire time. */
export function requestAutoOcrIfEnabled(jobId: string): void {
  const settings = useStore.getState().settings
  if (resolveWorkMode(settings.workMode) !== 'other' || !settings.ocrAutoCapture) {
    dlog.debug('other', 'auto-ocr not requested', { jobId, workMode: resolveWorkMode(settings.workMode), auto: !!settings.ocrAutoCapture })
  }
  if (resolveWorkMode(settings.workMode) !== 'other') return
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, Number(settings.ocrCaptureDelay) || 0) * 1000
  const token = useOtherCapture.getState().beginAuto()
  dlog.info('other', 'auto-ocr scheduled', { jobId, token, delayMs })
  window.setTimeout(() => {
    if (useOtherCapture.getState().autoToken !== token) dlog.info('other', 'auto-ocr superseded before fire', { jobId, token })
    if (useOtherCapture.getState().autoToken !== token) return
    dlog.info('other', 'auto-ocr begin', { jobId, token })
    void runSilentAutoOcr(jobId, () => useOtherCapture.getState().autoToken === token).finally(() => {
      useOtherCapture.getState().finishAuto(token)
    })
  }, delayMs)
}
