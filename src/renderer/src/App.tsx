import React, { Profiler, useCallback, useEffect, useRef } from 'react'
import { useStore } from './state/store'
import { resolveWorkMode } from '@other/workMode'
import { bootOther, OtherPages, OtherModals, OtherWorkModeBlock, useOtherEscape } from '@other/renderer/mountApp'
import { C, ZOOM_STEP, ZOOM_DEFAULT, clampZoom } from './theme'
import TopBar from './components/TopBar'
import BottomNav from './components/BottomNav'
import ManifestPage from './pages/ManifestPage'
import ContractsPage from './pages/ContractsPage'
import CargoGridPage from './pages/CargoGridPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import CaptureModal from './components/CaptureModal'
import ScanReviewModal from './components/ScanReviewModal'
import CompactGate from './components/CompactGate'
import Onboarding from './components/Onboarding'
import UpdateBanner from './components/UpdateBanner'
import UpdateWindow from './components/UpdateWindow'
import Toast from './components/Toast'
import CrashGuard from './components/CrashGuard'
import DebugPage from './pages/DebugPage'
import { trace, setTraceEnabled } from './state/trace'
import { otherDiagSnapshot } from '@other/renderer/state/otherDiag'
import { haulDiagSnapshot } from './state/haulDiag'

const HASH = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''
const STARTED = Date.now()
const PERF_EVERY_MS = 5000
const PERF_SLOW_MS = 50

export default function App(): React.ReactElement {
  if (HASH === 'debug') return <DebugPage />
  if (HASH === 'compact') return <CompactGate />
  return (
    <CrashGuard>
      <MainApp />
    </CrashGuard>
  )
}

function MainApp(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view) as string
  const init = useStore((s) => s.init)
  const workMode = resolveWorkMode(useStore((s) => s.settings.workMode))
  const uiZoom = useStore((s) => s.settings.uiZoom)
  const onboarded = useStore((s) => s.settings.onboarded)
  const updateSettings = useStore((s) => s.updateSettings)
  const traceOn = useStore((s) => s.settings.traceInterpretation)

  useEffect(() => setTraceEnabled(traceOn), [traceOn])

  // EXPORT DIAGNOSTICS asks the main window for a state snapshot
  useEffect(
    () =>
      window.supercargo.onDiagSnapshotRequest((reqId) => {
        const st = useStore.getState()
        const base = {
          view: st.view,
          workMode: resolveWorkMode(st.settings.workMode),
          windowSize: { w: window.innerWidth, h: window.innerHeight },
          uptimeMs: Date.now() - STARTED
        }
        try {
          window.supercargo.diagSnapshotReply(reqId, { ...base, other: otherDiagSnapshot(), haul: haulDiagSnapshot() })
        } catch (e) {
          window.supercargo.diagSnapshotReply(reqId, { ...base, error: e instanceof Error ? e.message : String(e) })
        }
      }),
    []
  )

  // render timings: at most one per view every 5 s, plus every slow render
  const lastPerf = useRef<Record<string, number>>({})
  const onRender = useCallback<React.ProfilerOnRenderCallback>((id, _phase, actualDuration) => {
    const now = Date.now()
    if (actualDuration <= PERF_SLOW_MS && now - (lastPerf.current[id] ?? 0) < PERF_EVERY_MS) return
    lastPerf.current[id] = now
    trace({ area: 'perf', what: 'render', ms: Math.round(actualDuration * 10) / 10, data: { view: id } })
  }, [])

  useEffect(() => {
    void (async () => {
      await init()
      bootOther()
    })()
  }, [init])

  useEffect(() => {
    window.supercargo.setZoom(uiZoom || 1)
  }, [uiZoom])

  useEffect(() => {
    const haulOnly = view === 'manifest' || view === 'contracts' || view === 'grid'
    const otherOnly = view === 'jobs' || view === 'next' || view === 'learned'
    if (workMode === 'other' && haulOnly) useStore.getState().setView('jobs' as 'manifest')
    if (workMode === 'haul' && otherOnly) useStore.getState().setView('manifest')
  }, [workMode, view])

  useOtherEscape()
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
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
          <Profiler id={view} onRender={onRender}>
            {workMode === 'haul' && view === 'manifest' && <ManifestPage />}
            {workMode === 'haul' && view === 'contracts' && <ContractsPage />}
            {workMode === 'haul' && view === 'grid' && <CargoGridPage />}
            {workMode === 'other' && <OtherPages view={view} />}
            {view === 'history' && workMode === 'haul' && <HistoryPage />}
            {view === 'settings' && (
              <>
                {workMode === 'haul' && <OtherWorkModeBlock />}
                <SettingsPage />
              </>
            )}
          </Profiler>
        )}
      </div>
      <BottomNav />
      <Toast />
      <CaptureModal />
      <OtherModals />
      <ScanReviewModal />
      <UpdateWindow />
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
