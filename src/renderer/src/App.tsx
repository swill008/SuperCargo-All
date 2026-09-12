import React, { useEffect } from 'react'
import { useStore } from './state/store'
import { useOtherJobs } from './state/otherJobs'
import { applyOcrObjectives } from './state/otherOcr'
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
    void init()
    void initOther()
  }, [init, initOther])

  useEffect(() => {
    window.supercargo.setZoom(uiZoom || 1)
  }, [uiZoom])

  // Other-mode: CaptureModal Confirm writes this job, not a haul contract.
  useEffect(() => {
    if (workMode !== 'other') return
    const origAdd = useStore.getState().addObjectivesToContract
    const origReward = useStore.getState().setContractReward
    useStore.setState({
      addObjectivesToContract: (id, objectives, maxBox) => {
        if (applyOcrObjectives(id, { objectives })) return
        origAdd(id, objectives, maxBox)
      },
      setContractReward: (id, reward) => {
        const s = useOtherJobs.getState()
        const job = s.jobs.find((j) => j.id === id)
        if (job && job.reward === 0 && reward > 0 && !job.objectivesLocked) {
          useOtherJobs.setState({
            jobs: s.jobs.map((j) => (j.id === id ? { ...j, reward } : j))
          })
          useOtherJobs.getState().persist()
          return
        }
        origReward(id, reward)
      }
    })
    return () => {
      useStore.setState({
        addObjectivesToContract: origAdd,
        setContractReward: origReward
      })
    }
  }, [workMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: C.black,
        color: C.textBody,
        overflow: 'hidden',
        border: '2px solid rgba(255,210,30,0.6)',
        borderRadius: 18
      }}
    >
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
      <ScanReviewModal />
      {ready && !onboarded && <Onboarding />}
    </div>
  )
}

function Loading(): React.ReactElement {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Rajdhani', sans-serif",
        letterSpacing: '0.2em',
        color: C.faint,
        fontSize: 13
      }}
    >
      INITIALIZING...
    </div>
  )
}
