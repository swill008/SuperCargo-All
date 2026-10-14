/**
 * Other-mode OCR modal state. Separate from haul openCapture / CaptureModal.
 * Auto-capture uses Settings ocrAutoCapture + ocrCaptureDelay (one engine).
 * Auto-OCR: one timer per job, shots run one at a time; Esc or a switch to Haul cancels all.
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
  /** an auto shot is pending or running (veil + Esc) */
  autoBusy: boolean
  autoToken: number
  openFor: (jobId: string, autoRun?: boolean) => void
  close: () => void
  cancelAuto: () => void
}

const timers = new Map<string, number>()
const queue: string[] = []
let running = false

const otherMode = (): boolean => resolveWorkMode(useStore.getState().settings.workMode) === 'other'

function syncBusy(): void {
  const busy = running || timers.size > 0 || queue.length > 0
  if (useOtherCapture.getState().autoBusy !== busy) useOtherCapture.setState({ autoBusy: busy })
}

export const useOtherCapture = create<OtherCaptureState>((set) => ({
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
  // token bump stops a running shot at its next check
  cancelAuto: () => cancelPendingAutoOcr('user cancel')
}))

/** drop every pending and running auto shot */
export function cancelPendingAutoOcr(reason: string): void {
  const st = useOtherCapture.getState()
  dlog.info('other', 'auto-ocr cancel', { reason, token: st.autoToken, pending: timers.size + queue.length, running })
  for (const t of timers.values()) window.clearTimeout(t)
  timers.clear()
  queue.length = 0
  useOtherCapture.setState({ autoToken: st.autoToken + 1 })
  syncBusy()
}

async function pump(): Promise<void> {
  if (running) return
  const jobId = queue.shift()
  if (!jobId) return syncBusy()
  running = true
  const token = useOtherCapture.getState().autoToken
  syncBusy()
  dlog.info('other', 'auto-ocr begin', { jobId, token, queued: queue.length })
  try {
    await runSilentAutoOcr(jobId, () => useOtherCapture.getState().autoToken === token && otherMode())
  } finally {
    running = false
    syncBusy()
    void pump()
  }
}

/** Live log accept. One delayed shot per job; queued, never replacing another job's shot. */
export function requestAutoOcrIfEnabled(jobId: string): void {
  const settings = useStore.getState().settings
  if (resolveWorkMode(settings.workMode) !== 'other' || !settings.ocrAutoCapture) {
    dlog.debug('other', 'auto-ocr not requested', { jobId, workMode: resolveWorkMode(settings.workMode), auto: !!settings.ocrAutoCapture })
    return
  }
  if (timers.has(jobId) || queue.includes(jobId)) return
  const delayMs = Math.max(0, Number(settings.ocrCaptureDelay) || 0) * 1000
  dlog.info('other', 'auto-ocr scheduled', { jobId, delayMs, pending: timers.size + queue.length })
  timers.set(
    jobId,
    window.setTimeout(() => {
      timers.delete(jobId)
      if (!otherMode()) {
        dlog.info('other', 'auto-ocr dropped: not in Other mode', { jobId })
        return syncBusy()
      }
      queue.push(jobId)
      void pump()
    }, delayMs)
  )
  syncBusy()
}
