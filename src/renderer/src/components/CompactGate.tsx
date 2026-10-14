/** Overlay entry: Other mode uses the checklist card, Haul mode keeps stock SuperCargo. */
import React, { useEffect } from 'react'
import { useStore } from '../state/store'
import { useOtherJobs } from '@other/renderer/state/otherJobs'
import { resolveWorkMode } from '@other/workMode'
import CompactWindowApp from './CompactWindowApp'
import CrashGuard from './CrashGuard'
import OtherOverlay from '@other/renderer/components/OtherOverlay'
import { loadOtherPlacesFromMain } from '@other/renderer/state/otherPlaces'

export default function CompactGate(): React.ReactElement {
  const initOther = useOtherJobs((s) => s.init)
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))

  const initHaul = useStore((s) => s.init)

  useEffect(() => {
    void initHaul()
    // passive: no log events, no scan, no auto-OCR; reloads every doc field when the main window saves
    void initOther({ passive: true })
    void loadOtherPlacesFromMain()
  }, [initOther, initHaul])

  return <CrashGuard compact>{workMode === 'other' ? <OtherOverlay /> : <CompactWindowApp />}</CrashGuard>
}
