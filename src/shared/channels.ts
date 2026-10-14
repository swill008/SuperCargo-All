// shared between main and preload

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  detectInstalls: 'installs:detect',
  pickLogFile: 'dialog:pickLogFile',
  exportRunFile: 'dialog:exportRunFile',

  manifestLoad: 'manifest:load',
  manifestSave: 'manifest:save',

  historyLoad: 'history:load',
  historySave: 'history:save',

  // fork: Other-mode checklist (not the haul manifest)
  otherJobsLoad: 'otherJobs:load',
  otherJobsSave: 'otherJobs:save',
  otherPlacesGet: 'otherPlaces:get',
  otherOcrShotSave: 'otherOcrShot:save',
  otherOcrShotGet: 'otherOcrShot:get',

  uexGetShips: 'uex:getShips',
  uexGetLocations: 'uex:getLocations',
  uexGetCommodities: 'uex:getCommodities',
  uexGetGridFaces: 'uex:getGridFaces',

  watcherStatus: 'watcher:status',
  watcherRestart: 'watcher:restart',
  scanSession: 'watcher:scanSession',

  windowControl: 'window:control',
  setAlwaysOnTop: 'window:setAlwaysOnTop',
  windowIsMaximized: 'window:isMaximized',

  compactShow: 'compact:show',
  compactHide: 'compact:hide',
  compactIsOpen: 'compact:isOpen',
  compactResize: 'compact:resize',
  loadingStateSet: 'loading:set',
  crewMirror: 'crew:mirror',
  crewMirrorAsk: 'crew:mirrorAsk',

  ocrListDisplays: 'ocr:listDisplays',
  ocrEngineInfo: 'ocr:engineInfo',
  ocrPreview: 'ocr:preview',
  ocrRun: 'ocr:run',
  ocrSaveSample: 'ocr:saveSample',
  ocrReportAccuracy: 'ocr:reportAccuracy',
  ocrRequestCapture: 'ocr:requestCapture',

  contractDataStatus: 'contractData:status',
  contractDataRescan: 'contractData:rescan',

  dataRefresh: 'data:refresh',

  telemetryStatus: 'telemetry:status',
  telemetryBoxReport: 'telemetry:boxReport',

  updaterCheck: 'updater:check',
  updaterQuitAndInstall: 'updater:quitAndInstall',

  appVersion: 'app:version',

  evtWatcherStatus: 'evt:watcher:status',
  evtContractAccepted: 'evt:contract:accepted',
  evtOtherJobsChanged: 'evt:other:jobsChanged',
  evtOtherLogEvent: 'evt:other:logEvent', // main -> main window only, one OtherLogEvent
  otherAction: 'otherJobs:action', // overlay -> main (send), one OtherAction
  evtOtherAction: 'evt:other:action', // main -> main window only, relayed OtherAction
  otherJobsScanEvents: 'otherJobs:scanEvents',
  otherWhereRun: 'otherWhere:run', // WHERE AM I: capture + read, result also broadcast on evtOtherWhere
  otherWhereCalPreview: 'otherWhere:calPreview', // fresh screenshot data URL for the zone calibrator
  otherWhereCalTest: 'otherWhere:calTest', // read one zone (1 | 2), not broadcast
  evtOtherWhere: 'evt:other:where', // main -> all windows, one WhereRunResult
  otherHotkeysPause: 'otherHotkeys:pause', // hotkey recorder listening: unregister all app global shortcuts
  otherHotkeysResume: 'otherHotkeys:resume', // re-register (upstream registerHotkey path)
  otherHotkeyCheck: 'otherHotkeys:check', // (accelerator) -> { ok, reason?: 'invalid' | 'in-use' }
  otherAfkStart: 'otherAfk:start', // -> AfkState
  otherAfkStop: 'otherAfk:stop', // -> AfkState
  otherAfkGet: 'otherAfk:get', // -> AfkState
  evtOtherAfk: 'evt:other:afk', // main -> all windows, one AfkState on every change
  evtObjective: 'evt:objective',
  evtContractEnded: 'evt:contract:ended',
  evtContractPaid: 'evt:contract:paid',
  evtContractShare: 'evt:contract:share',
  evtUpdate: 'evt:update',
  evtOpenCapture: 'evt:openCapture',
  evtShips: 'evt:ships',
  evtLocations: 'evt:locations',
  evtCommodities: 'evt:commodities',
  evtGridFaces: 'evt:gridFaces',
  evtWindowState: 'evt:window:state',
  evtOcrResult: 'evt:ocr:result',
  evtOcrStatus: 'evt:ocr:status',
  evtOcrWait: 'evt:ocr:wait', // shared-accept capture waiting for the contract screen
  crewStart: 'crew:start',
  crewJoin: 'crew:join',
  crewLeave: 'crew:leave',
  crewEnd: 'crew:end',
  crewPublish: 'crew:publish',

  evtManifestChanged: 'evt:manifest:changed', // saved by another window
  evtCompactState: 'evt:compact:state',
  evtLoadingState: 'evt:loading:state', // main window's loading-mode step
  evtCrewMirror: 'evt:crew:mirror', // what a crew member's main window shows
  evtCrewMirrorAsk: 'evt:crew:mirrorAsk', // overlay just opened
  evtCrewSnapshot: 'evt:crew:snapshot', // leader's run, for a crew member to render
  evtCrewStatus: 'evt:crew:status', // crew link up/down
  evtCrewMembers: 'evt:crew:members', // who's actually on the channel
  evtSettings: 'evt:settings', // settings changed, keep the overlay in sync

  debugLog: 'debug:log', // window -> main, batch of LogEntry
  debugRecent: 'debug:recent',
  debugInfo: 'debug:info',
  debugReport: 'debug:report',
  debugOpen: 'debug:open',
  debugOpenFolder: 'debug:openFolder',
  debugSetVerbose: 'debug:setVerbose',
  evtDebugEntries: 'evt:debug:entries', // main -> debug window, batch of LogEntry
  traceRecords: 'trace:records', // window -> main, batch of TraceRecord
  diagExport: 'diag:export', // invoke: build and save the diagnostics file
  diagSnapshotRequest: 'evt:diag:snapshot', // main -> main window: send your state snapshot
  diagSnapshotReply: 'diag:snapshot' // main window -> main: the snapshot (jobs, distances, store summary)
} as const
