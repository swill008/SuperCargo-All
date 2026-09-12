/** Overlay entry: Other mode uses the checklist card, Haul mode keeps stock SuperCargo. */
import React, { useEffect } from 'react'
import { useStore } from '../state/store'
import { useOtherJobs } from '../state/otherJobs'
import { useOtherHistory } from '../state/otherHistory'
import { resolveWorkMode } from '@shared/workMode'
import CompactWindowApp from './CompactWindowApp'
import OtherOverlay from './OtherOverlay'

let jobsChangedBound = false

export default function CompactGate(): React.ReactElement {
  const initOther = useOtherJobs((s) => s.init)
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))

  useEffect(() => {
    void initOther()
    if (jobsChangedBound) return
    jobsChangedBound = true
    window.supercargo.onOtherJobsChanged?.(() => {
      void window.supercargo.loadOtherJobs?.().then((doc) => {
        useOtherJobs.setState({ jobs: doc.jobs ?? [] })
        useOtherHistory.getState().load(doc)
      })
    })
  }, [initOther])

  if (workMode === 'other') return <OtherOverlay />
  return <CompactWindowApp />
}
