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
  otherPlacesRefresh: 'otherPlaces:refresh', // REFRESH: re-pull UEX/starmap places -> Location[]
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
  updaterDownload: 'updater:download', // Update Now (installed copy) / Try Again after a failed download
  updaterSkip: 'updater:skip', // Skip This Version (version) -> saves settings.skippedUpdateVersion
  updaterState: 'updater:state', // -> UpdateState | null (last state, for a window opened later)
  updaterUpdatedNotice: 'updater:updatedNotice', // -> UpdatedNotice | null (once per update)
  refDataGet: 'refData:get', // -> RefDataStatus
  refDataCheck: 'refData:check', // check the author's reference data now -> RefDataStatus

  appVersion: 'app:version',

  dataFolderGet: 'dataFolder:get', // -> DataFolderInfo
  dataFolderChoose: 'dataFolder:choose', // folder picker, copy data if the new folder has none, save -> DataFolderChangeResult
  dataFolderReset: 'dataFolder:reset', // back to the default folder -> DataFolderChangeResult
  dataFolderOpen: 'dataFolder:open', // open the folder this run uses
  dataFolderRestart: 'dataFolder:restart', // relaunch so the new folder takes effect
  dataFolderRepair: 'dataFolder:repair', // (target) move damaged SuperCargo files to "Moved for Repair\<date>", then use the folder -> DataFolderChangeResult

  evtWatcherStatus: 'evt:watcher:status',
  evtContractAccepted: 'evt:contract:accepted',
  evtOtherJobsChanged: 'evt:other:jobsChanged',
  evtOtherLogEvent: 'evt:other:logEvent', // main -> main window only, one OtherLogEvent
  otherAction: 'otherJobs:action', // overlay -> main (send), one OtherAction
  evtOtherAction: 'evt:other:action', // main -> main window only, relayed OtherAction
  otherJobsScanEvents: 'otherJobs:scanEvents',
  otherJobsRefreshScan: 'otherJobs:refreshScan', // (missionIds) -> { events: markers + sessions, files, ms }, no watermark
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
  otherBodiesGet: 'otherBodies:get', // -> BodiesDoc (table built from the roster + saved)
  otherLearnedPlace: 'otherBodies:learned', // renderer -> main (send), one LearnedPlaceReport
  evtOtherBodies: 'evt:other:bodies', // main -> all windows, BodiesDoc on every change
  otherMemoryGet: 'otherMemory:get', // -> MemoryDoc (match memory, other-matches.json)
  otherMemorySeen: 'otherMemory:seen', // renderer -> main (send), recordSeen inputs[] (main window only)
  otherMemoryProof: 'otherMemory:proof', // renderer -> main (send), one recordProof input (main window only)
  otherMemorySet: 'otherMemory:set', // ({ key, text, context?, place }) -> MemoryDoc ('user' entry)
  otherMemoryForget: 'otherMemory:forget', // (key) -> MemoryDoc
  otherMemoryUndo: 'otherMemory:undo', // (index into changes) -> MemoryDoc
  evtOtherMemory: 'evt:other:memory', // main -> all windows, MemoryDoc on every change
  otherGameDataGet: 'otherGameData:get', // -> GameDataReply (Star Citizen Wiki game data: counts, source, site table)
  otherGameDataUpdate: 'otherGameData:update', // download + rebuild -> GameDataReply (error? on failure)
  evtOtherGameData: 'evt:other:gameData', // main -> all windows, GameDataReply after every update
  evtObjective: 'evt:objective',
  evtContractEnded: 'evt:contract:ended',
  evtContractPaid: 'evt:contract:paid',
  evtContractShare: 'evt:contract:share',
  evtUpdate: 'evt:update',
  evtRefData: 'evt:refData', // main -> windows, RefDataStatus after every check
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
  diagCopyText: 'diag:copyText', // invoke: copy the last export's saved text to the clipboard
  diagCopyImages: 'diag:copyImages', // invoke: copy the last export's combined picture to the clipboard
  diagSnapshotRequest: 'evt:diag:snapshot', // main -> main window: send your state snapshot
  diagSnapshotReply: 'diag:snapshot' // main window -> main: the snapshot (jobs, distances, store summary)
} as const
