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
  otherJobsScan: 'otherJobs:scan',

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
  compactResize: 'compact:resize',
  loadingStateSet: 'loading:set',

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
  evtOtherAccepted: 'evt:other:accepted',
  evtOtherSessionDrop: 'evt:other:sessionDrop',
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
  evtManifestChanged: 'evt:manifest:changed',
  evtCompactState: 'evt:compact:state',
  evtLoadingState: 'evt:loading:state',
  evtSettings: 'evt:settings'
} as const
