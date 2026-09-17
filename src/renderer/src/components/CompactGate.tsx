/** Overlay entry: Other mode uses the checklist card, Haul mode keeps stock SuperCargo. */
import React, { useEffect } from 'react'
import { useStore } from '../state/store'
import { useOtherJobs } from '@other/renderer/state/otherJobs'
import { useOtherHistory } from '@other/renderer/state/otherHistory'
import { resolveWorkMode } from '@other/workMode'
import CompactWindowApp from './CompactWindowApp'
import OtherOverlay from '@other/renderer/components/OtherOverlay'
import { loadOtherPlacesFromMain } from '@other/renderer/state/otherPlaces'

let jobsChangedBound = false

export default function CompactGate(): React.ReactElement {
  const initOther = useOtherJobs((s) => s.init)
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))

  const initHaul = useStore((s) => s.init)

  useEffect(() => {
    void initHaul()
    void initOther()
    void loadOtherPlacesFromMain()
    if (jobsChangedBound) return
    jobsChangedBound = true
    window.supercargo.onOtherJobsChanged?.(() => {
      void window.supercargo.loadOtherJobs?.().then((doc) => {
        useOtherJobs.setState({
          jobs: doc.jobs ?? [],
          startLocation: typeof doc.startLocation === 'string' ? doc.startLocation : useOtherJobs.getState().startLocation
        })
        useOtherHistory.getState().load(doc)
      })
    })
  }, [initOther, initHaul])

  if (workMode === 'other') return <OtherOverlay />
  return <CompactWindowApp />
}
