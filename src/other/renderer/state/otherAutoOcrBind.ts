/**
 * Live accept auto-OCR is requested by the otherJobs reducer (main window only).
 * Here: cancel pending shots when the user switches to Haul.
 */
import { useStore } from '@renderer/state/store'
import { resolveWorkMode } from '@other/workMode'
import { cancelPendingAutoOcr } from './otherCapture'

let bound = false

export function bindOtherAutoOcr(): void {
  if (bound || window.location.hash.replace(/^#\/?/, '') === 'compact') return
  bound = true
  useStore.subscribe((s, prev) => {
    if (s.settings.workMode === prev.settings.workMode) return
    if (resolveWorkMode(s.settings.workMode) !== 'other') cancelPendingAutoOcr('switched to Haul')
  })
}
