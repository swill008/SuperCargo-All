import React, { useEffect } from 'react'
import { useStore } from './state/store'
import { useOtherJobs } from './state/otherJobs'
import { bindOtherAutoOcr } from './state/otherAutoOcrBind'
import { bindHaulModeSwitch } from './state/haulModeSwitch'
import { loadOtherPlacesFromMain } from './state/otherPlaces'
import { resolveWorkMode } from '@shared/workMode'
import { C, ZOOM_STEP, ZOOM_DEFAULT, clampZoom } from './theme'
import TopBar from './components/TopBar'
import BottomNav from './components/BottomNav'
import ManifestPage from './pages/ManifestPage'
import ContractsPage from './pages/ContractsPage'
import CargoGridPage from './pages/CargoGridPage'
import HistoryPage from './pages/HistoryPage'
import OtherHistoryPage from './pages/OtherHistoryPage'
import SettingsPage from './pages/SettingsPage'
import JobsPage from './pages/JobsPage'
import NextPage from './pages/NextPage'
import CaptureModal from './components/CaptureModal'
import OtherCaptureModal from './components/OtherCaptureModal'
import OtherAutoOcrVeil from './components/OtherAutoOcrVeil'
import { useOtherCapture } from './state/otherCapture'
import { useHaulModeSwitch } from './state/haulModeSwitch'
import HaulModeSwitchModal from './components/HaulModeSwitchModal'
import ScanReviewModal from './components/ScanReviewModal'
import CompactGate from './components/CompactGate'
import Onboarding from './components/Onboarding'
import UpdateBanner from './components/UpdateBanner'
import Toast from './components/Toast'
import WorkModeSection from './components/WorkModeSection'

const IS_COMPACT = typeof window !== 'undefined' && window.location.hash.replace('#', '') === 'compact'

export default function App(): React.ReactElement {
  if (IS_COMPACT) return <CompactGate />
  return <MainApp />
}

function MainApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view) as string
  const init = useStore((s) => s.init)
  const initOther = useOtherJobs((s) => s.init)
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))
  const uiZoom = useStore((s) => s.settings.uiZoom)
  const onboarded = useStore((s) => s.settings.onboarded)
  const updateSettings = useStore((s) => s.updateSettings)

  useEffect(() => {
    void (async () => {
      await init()
      await initOther()
      bindOtherAutoOcr()
      bindHaulModeSwitch()
      void loadOtherPlacesFromMain()
    })()
  }, [init, initOther])

  useEffect(() => {
    window.supercargo.setZoom(uiZoom || 1)
  }, [uiZoom])

  useEffect(() => {
    const haulOnly = view === 'manifest' || view === 'contracts' || view === 'grid'
    const otherOnly = view === 'jobs' || view === 'next'
    if (workMode === 'other' && haulOnly) useStore.getState().setView('jobs' as 'manifest')
    if (workMode === 'haul' && otherOnly) useStore.getState().setView('manifest')
  }, [workMode, view])

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
        return
      }
      const haul = useStore.getState()
      if (haul.captureOpen) {
        e.preventDefault()
        haul.closeCapture()
        return
      }
      if (haul.scanReviewOpen) {
        e.preventDefault()
        haul.closeScanReview()
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+' ) {
        e.preventDefault()
        void updateSettings({ uiZoom: clampZoom((uiZoom || 1) + ZOOM_STEP) })
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        void updateSettings({ uiZoom: clampZoom((uiZoom || 1) - ZOOM_STEP) })
      } else if (e.key === '0') {
        e.preventDefault()
        void updateSettings({ uiZoom: ZOOM_DEFAULT })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uiZoom, updateSettings])

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: C.black, color: C.textBody, overflow: 'hidden', border: '2px solid rgba(255,210,30,0.6)', borderRadius: 18 }}>
      <TopBar />
      <UpdateBanner />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {!ready ? (
          <Loading />
        ) : (
          <>
            {workMode === 'haul' && view === 'manifest' && <ManifestPage />}
            {workMode === 'haul' && view === 'contracts' && <ContractsPage />}
            {workMode === 'haul' && view === 'grid' && <CargoGridPage />}
            {workMode === 'other' && view === 'next' && <NextPage />}
            {workMode === 'other' && view === 'jobs' && <JobsPage />}
            {view === 'history' && workMode === 'haul' && <HistoryPage />}
            {view === 'history' && workMode === 'other' && <OtherHistoryPage />}
            {view === 'settings' && (
              <>
                <WorkModeSection />
                <SettingsPage />
              </>
            )}
          </>
        )}
      </div>
      <BottomNav />
      <Toast />
      <CaptureModal />
      <OtherCaptureModal />
      <OtherAutoOcrVeil />
      <HaulModeSwitchModal />
      <ScanReviewModal />
      {ready && !onboarded && <Onboarding />}
    </div>
  )
}

function Loading(): React.ReactElement {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.2em', color: C.faint, fontSize: 13 }}>
      INITIALIZING...
    </div>
  )
}
