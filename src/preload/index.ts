import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { LogEntry, DebugInfo } from '@shared/debugLog'
import type { TraceRecord, DiagExportOptions, DiagExportResult, DiagCopyTextResult, DiagCopyImagesResult } from '@shared/trace'
import { IPC } from '@shared/channels'
import type {
  AppSettings,
  ManifestDoc,
  HistoryDoc,
  WatcherStatus,
  DetectedInstalls,
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  ContractPaidEvent,
  ShareEvent,
  UpdateState,
  ShipRoster,
  LocationRoster,
  CommodityRoster,
  GridFacesRoster,
  SessionScan,
  DisplayInfo,
  OcrEngineInfo,
  OcrResult,
  OcrEditTally,
  OcrWaitState,
  ContractDataStatus,
  DataSyncResult,
  BoxSizeReport,
  CrewSnapshot,
  CrewMirror,
  CrewMember
} from '@shared/types'
import type { OtherJobsDoc } from '@other/otherJob'
import type { OtherLogEvent, OtherScanResult } from '@other/otherEvents'
import type { OtherAction } from '@other/otherActions'
import type { WhereRunResult } from '@other/otherWhere'
import type { AfkState } from '@other/otherAfk'
import type { BodiesDoc, LearnedPlaceReport } from '@other/otherBodies'

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  detectInstalls: (opts?: { force?: boolean }): Promise<{ installs: DetectedInstalls; ordered: string[] }> =>
    ipcRenderer.invoke(IPC.detectInstalls, opts),
  pickLogFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickLogFile),
  exportRunFile: (payload: { defaultName: string; json: string }): Promise<string | null> =>
    ipcRenderer.invoke(IPC.exportRunFile, payload),

  startCrew: (name: string): Promise<string | null> => ipcRenderer.invoke(IPC.crewStart, name),
  joinCrew: (code: string, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.crewJoin, { code, name }),
  leaveCrew: (): Promise<void> => ipcRenderer.invoke(IPC.crewLeave),
  endCrew: (): Promise<void> => ipcRenderer.invoke(IPC.crewEnd),
  publishCrew: (snap: Omit<CrewSnapshot, 'rev'>): Promise<boolean> =>
    ipcRenderer.invoke(IPC.crewPublish, snap),
  onCrewSnapshot: (cb: (s: CrewSnapshot) => void): Unsubscribe => on(IPC.evtCrewSnapshot, cb),
  onCrewStatus: (cb: (s: { up: boolean; error?: string }) => void): Unsubscribe =>
    on(IPC.evtCrewStatus, cb),
  onCrewMembers: (cb: (m: CrewMember[]) => void): Unsubscribe => on(IPC.evtCrewMembers, cb),

  loadManifest: (): Promise<ManifestDoc> => ipcRenderer.invoke(IPC.manifestLoad),
  saveManifest: (doc: ManifestDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.manifestSave, doc),

  loadHistory: (): Promise<HistoryDoc> => ipcRenderer.invoke(IPC.historyLoad),
  saveHistory: (doc: HistoryDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.historySave, doc),

  loadOtherJobs: (): Promise<OtherJobsDoc> => ipcRenderer.invoke(IPC.otherJobsLoad),
  saveOtherJobs: (doc: OtherJobsDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.otherJobsSave, doc),

  getUexShips: (): Promise<ShipRoster | null> => ipcRenderer.invoke(IPC.uexGetShips),
  getUexLocations: (): Promise<LocationRoster | null> => ipcRenderer.invoke(IPC.uexGetLocations),
  getUexCommodities: (): Promise<CommodityRoster | null> => ipcRenderer.invoke(IPC.uexGetCommodities),
  getUexGridFaces: (): Promise<GridFacesRoster | null> => ipcRenderer.invoke(IPC.uexGetGridFaces),
  getOtherPlaces: (): Promise<import('@shared/types').Location[]> => ipcRenderer.invoke(IPC.otherPlacesGet),
  refreshOtherPlaces: (): Promise<import('@shared/types').Location[]> => ipcRenderer.invoke(IPC.otherPlacesRefresh),
  saveOtherOcrShot: (jobId: string, dataUrl: string): Promise<boolean> => ipcRenderer.invoke(IPC.otherOcrShotSave, jobId, dataUrl),
  getOtherOcrShot: (jobId: string): Promise<string | null> => ipcRenderer.invoke(IPC.otherOcrShotGet, jobId),

  getWatcherStatus: (): Promise<WatcherStatus> => ipcRenderer.invoke(IPC.watcherStatus),
  restartWatcher: (): Promise<boolean> => ipcRenderer.invoke(IPC.watcherRestart),
  scanSession: (): Promise<SessionScan> => ipcRenderer.invoke(IPC.scanSession),

  windowControl: (action: 'minimize' | 'maximize' | 'close'): Promise<void> =>
    ipcRenderer.invoke(IPC.windowControl, action),
  setAlwaysOnTop: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setAlwaysOnTop, value),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowState: (cb: (s: { maximized: boolean }) => void): Unsubscribe =>
    on(IPC.evtWindowState, cb),

  compactShow: (): Promise<void> => ipcRenderer.invoke(IPC.compactShow),
  compactHide: (): Promise<void> => ipcRenderer.invoke(IPC.compactHide),
  compactIsOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.compactIsOpen),
  compactResize: (height: number): Promise<void> => ipcRenderer.invoke(IPC.compactResize, height),
  onCompactState: (cb: (s: { open: boolean }) => void): Unsubscribe =>
    on(IPC.evtCompactState, cb),
  setLoadingState: (s: { active: boolean; idx: number }): void =>
    ipcRenderer.send(IPC.loadingStateSet, s),
  onLoadingState: (cb: (s: { active: boolean; idx: number }) => void): Unsubscribe =>
    on(IPC.evtLoadingState, cb),
  mirrorCrew: (m: CrewMirror): void => ipcRenderer.send(IPC.crewMirror, m),
  onCrewMirror: (cb: (m: CrewMirror) => void): Unsubscribe => on(IPC.evtCrewMirror, cb),
  askCrewMirror: (): void => ipcRenderer.send(IPC.crewMirrorAsk),
  onCrewMirrorAsk: (cb: () => void): Unsubscribe => on(IPC.evtCrewMirrorAsk, cb),
  onManifestChanged: (cb: (doc: ManifestDoc) => void): Unsubscribe =>
    on(IPC.evtManifestChanged, cb),
  onSettings: (cb: (s: AppSettings) => void): Unsubscribe => on(IPC.evtSettings, cb),

  setZoom: (factor: number): void => webFrame.setZoomFactor(factor),

  ocrListDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.ocrListDisplays),
  ocrEngineInfo: (): Promise<OcrEngineInfo> => ipcRenderer.invoke(IPC.ocrEngineInfo),
  ocrPreview: (): Promise<string | null> => ipcRenderer.invoke(IPC.ocrPreview),
  ocrRun: (): Promise<OcrResult> => ipcRenderer.invoke(IPC.ocrRun),
  ocrSaveSample: (payload: {
    sampleId: string
    text: string
    fields?: Record<string, unknown>
  }): Promise<boolean> => ipcRenderer.invoke(IPC.ocrSaveSample, payload),
  ocrReportAccuracy: (payload: {
    attempted: number
    edited: number
    byField: OcrEditTally
  }): void => ipcRenderer.send(IPC.ocrReportAccuracy, payload),
  onOcrResult: (cb: (r: OcrResult) => void): Unsubscribe => on(IPC.evtOcrResult, cb),
  onOcrStatus: (cb: (s: string) => void): Unsubscribe => on(IPC.evtOcrStatus, cb),
  onOcrWait: (cb: (w: OcrWaitState) => void): Unsubscribe => on(IPC.evtOcrWait, cb),
  requestOcrCapture: (missionId: string, wait?: Omit<OcrWaitState, 'active'>): void =>
    ipcRenderer.send(IPC.ocrRequestCapture, missionId, wait),

  getContractDataStatus: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataStatus),
  rescanContractData: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataRescan),

  refreshData: (): Promise<DataSyncResult> => ipcRenderer.invoke(IPC.dataRefresh),

  getTelemetryStatus: (): Promise<{ uploaded: number; queued: number }> =>
    ipcRenderer.invoke(IPC.telemetryStatus),
  reportBoxSizes: (report: BoxSizeReport): void =>
    ipcRenderer.send(IPC.telemetryBoxReport, report),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterCheck),
  quitAndInstall: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterQuitAndInstall),

  onWatcherStatus: (cb: (s: WatcherStatus) => void): Unsubscribe =>
    on(IPC.evtWatcherStatus, cb),
  onContractAccepted: (cb: (e: ContractAcceptedEvent) => void): Unsubscribe =>
    on(IPC.evtContractAccepted, cb),
  onOtherJobsChanged: (cb: (p: { rev?: number; sender?: number }) => void): Unsubscribe =>
    on(IPC.evtOtherJobsChanged, cb),
  onOtherLogEvent: (cb: (e: OtherLogEvent) => void): Unsubscribe => on(IPC.evtOtherLogEvent, cb),
  /** overlay: ask the main window to apply a job action (rule 8) */
  otherAction: (a: OtherAction): void => ipcRenderer.send(IPC.otherAction, a),
  onOtherAction: (cb: (a: OtherAction) => void): Unsubscribe => on(IPC.evtOtherAction, cb),
  scanOtherEvents: (since?: string): Promise<OtherScanResult> => ipcRenderer.invoke(IPC.otherJobsScanEvents, since),
  refreshScanOther: (missionIds: string[]): Promise<{ events: OtherLogEvent[]; files: string[]; ms: number }> =>
    ipcRenderer.invoke(IPC.otherJobsRefreshScan, missionIds),
  /** WHERE AM I: read the map screen; the result is also broadcast to every window */
  otherWhereRun: (): Promise<WhereRunResult> => ipcRenderer.invoke(IPC.otherWhereRun),
  otherWhereCalPreview: (): Promise<string | null> => ipcRenderer.invoke(IPC.otherWhereCalPreview),
  otherWhereCalTest: (zone: 1 | 2): Promise<WhereRunResult> => ipcRenderer.invoke(IPC.otherWhereCalTest, zone),
  onOtherWhere: (cb: (r: WhereRunResult) => void): Unsubscribe => on(IPC.evtOtherWhere, cb),
  otherHotkeysPause: (): Promise<boolean> => ipcRenderer.invoke(IPC.otherHotkeysPause),
  otherHotkeysResume: (): Promise<boolean> => ipcRenderer.invoke(IPC.otherHotkeysResume),
  otherHotkeyCheck: (accel: string): Promise<{ ok: boolean; reason?: 'invalid' | 'in-use' }> =>
    ipcRenderer.invoke(IPC.otherHotkeyCheck, accel),
  otherAfkStart: (): Promise<AfkState> => ipcRenderer.invoke(IPC.otherAfkStart),
  otherAfkStop: (): Promise<AfkState> => ipcRenderer.invoke(IPC.otherAfkStop),
  otherAfkGet: (): Promise<AfkState> => ipcRenderer.invoke(IPC.otherAfkGet),
  onOtherAfk: (cb: (s: AfkState) => void): Unsubscribe => on(IPC.evtOtherAfk, cb),
  otherBodiesGet: (): Promise<BodiesDoc> => ipcRenderer.invoke(IPC.otherBodiesGet),
  otherLearnedPlace: (p: LearnedPlaceReport): void => ipcRenderer.send(IPC.otherLearnedPlace, p),
  onOtherBodies: (cb: (d: BodiesDoc) => void): Unsubscribe => on(IPC.evtOtherBodies, cb),
  onObjective: (cb: (e: ObjectiveEvent) => void): Unsubscribe => on(IPC.evtObjective, cb),
  onContractEnded: (cb: (e: ContractEndedEvent) => void): Unsubscribe =>
    on(IPC.evtContractEnded, cb),
  onContractPaid: (cb: (e: ContractPaidEvent) => void): Unsubscribe =>
    on(IPC.evtContractPaid, cb),
  onContractShare: (cb: (e: ShareEvent) => void): Unsubscribe =>
    on(IPC.evtContractShare, cb),
  onUpdate: (cb: (s: UpdateState) => void): Unsubscribe => on(IPC.evtUpdate, cb),
  onOpenCapture: (cb: () => void): Unsubscribe => on(IPC.evtOpenCapture, cb),
  onShips: (cb: (roster: ShipRoster) => void): Unsubscribe => on(IPC.evtShips, cb),
  onLocations: (cb: (roster: LocationRoster) => void): Unsubscribe => on(IPC.evtLocations, cb),
  onCommodities: (cb: (roster: CommodityRoster) => void): Unsubscribe => on(IPC.evtCommodities, cb),
  onGridFaces: (cb: (roster: GridFacesRoster) => void): Unsubscribe => on(IPC.evtGridFaces, cb),

  debugLog: (entries: LogEntry[]): void => ipcRenderer.send(IPC.debugLog, entries),
  debugRecent: (): Promise<LogEntry[]> => ipcRenderer.invoke(IPC.debugRecent),
  debugInfo: (): Promise<DebugInfo> => ipcRenderer.invoke(IPC.debugInfo),
  debugReport: (): Promise<string> => ipcRenderer.invoke(IPC.debugReport),
  debugOpen: (): Promise<void> => ipcRenderer.invoke(IPC.debugOpen),
  debugOpenFolder: (): Promise<void> => ipcRenderer.invoke(IPC.debugOpenFolder),
  debugSetVerbose: (on: boolean): Promise<void> => ipcRenderer.invoke(IPC.debugSetVerbose, on),
  onDebugEntries: (cb: (entries: LogEntry[]) => void): Unsubscribe => on(IPC.evtDebugEntries, cb),
  traceRecords: (recs: TraceRecord[]): void => ipcRenderer.send(IPC.traceRecords, recs),
  diagExport: (opts?: DiagExportOptions): Promise<DiagExportResult> => ipcRenderer.invoke(IPC.diagExport, opts),
  diagCopyText: (): Promise<DiagCopyTextResult> => ipcRenderer.invoke(IPC.diagCopyText),
  diagCopyImages: (): Promise<DiagCopyImagesResult> => ipcRenderer.invoke(IPC.diagCopyImages),
  onDiagSnapshotRequest: (cb: (reqId: string) => void): Unsubscribe => on(IPC.diagSnapshotRequest, cb),
  diagSnapshotReply: (reqId: string, snapshot: Record<string, unknown>): void => ipcRenderer.send(IPC.diagSnapshotReply, reqId, snapshot)
}

export type SuperCargoApi = typeof api

contextBridge.exposeInMainWorld('supercargo', api)
