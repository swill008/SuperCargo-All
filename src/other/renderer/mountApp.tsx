/**
 * StandAlone Other — renderer adapter.
 * Re-tie after an upstream pull: render <OtherMount view={view} /> and call bootOther().
 */
import React, { useEffect } from 'react'
import { useStore } from '../../renderer/src/state/store'
import { resolveWorkMode } from '../workMode'
import { useOtherJobs } from './state/otherJobs'
import { bindOtherAutoOcr } from './state/otherAutoOcrBind'
import { bindHaulModeSwitch } from './state/haulModeSwitch'
import { loadOtherPlacesFromMain } from './state/otherPlaces'
import { useOtherCapture } from './state/otherCapture'
import { useHaulModeSwitch } from './state/haulModeSwitch'
import JobsPage from './pages/JobsPage'
import NextPage from './pages/NextPage'
import OtherHistoryPage from './pages/OtherHistoryPage'
import WorkModeSection from './components/WorkModeSection'
import OtherCaptureModal from './components/OtherCaptureModal'
import OtherAutoOcrVeil from './components/OtherAutoOcrVeil'
import HaulModeSwitchModal from './components/HaulModeSwitchModal'

export function bootOther(): void {
  void useOtherJobs.getState().init()
  bindOtherAutoOcr()
  bindHaulModeSwitch()
  void loadOtherPlacesFromMain()
}

export function OtherWorkModeBlock(): React.ReactElement {
  return <WorkModeSection />
}

export function OtherPages({ view }: { view: string }): React.ReactElement | null {
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))
  if (workMode !== 'other') return null
  if (view === 'next') return <NextPage />
  if (view === 'jobs') return <JobsPage />
  if (view === 'history') return <OtherHistoryPage />
  if (view === 'settings') return <WorkModeSection />
  return null
}

export function OtherModals(): React.ReactElement {
  return (
    <>
      <OtherCaptureModal />
      <OtherAutoOcrVeil />
      <HaulModeSwitchModal />
    </>
  )
}

export function useOtherEscape(): void {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const otherCap = useOtherCapture.getState()
      if (otherCap.autoBusy) {
        e.preventDefault()
        otherCap.cancelAuto()
        return
      }
      if (otherCap.open) {
        e.preventDefault()
        otherCap.close()
        return
      }
      const haulSwitch = useHaulModeSwitch.getState()
      if (haulSwitch.pending.length > 0) {
        e.preventDefault()
        haulSwitch.stayInOther()
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])
}

export function OtherMount({ view }: { view: string }): React.ReactElement {
  useOtherEscape()
  return (
    <>
      <OtherPages view={view} />
      <OtherModals />
    </>
  )
}
