// Replays a made-up Game.log through the real app (watcher -> main -> both windows -> other-jobs.json).
// Each scenario gets a fresh data folder. Expectations are the intended behaviour, so a FAIL is a bug.
// Usage: npm run build && node test/replay/replay.mjs [scenario-name ...]
// Real logs: node test/replay/run_all.mjs (every fixture in test/replay/fixtures, live and scan)
// Linux runs each app on its own Xvfb display when Xvfb is installed; Windows opens real windows.

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
// REPLAY_ROOT=<folder with package.json, out/ and data/> runs another build (e.g. a copy of the old out/ to show a check fails there)
const root = process.env.REPLAY_ROOT ? path.resolve(process.env.REPLAY_ROOT) : here
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-replay-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const useXvfb = process.platform === 'linux' && spawnSync('which', ['Xvfb']).status === 0

let seq = 0
const mission = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
// every builder takes an optional time (ms or Date) so start-up scenarios can sit lines either side of a watermark
const iso = (at) => new Date(at ?? Date.now()).toISOString()
const stamp = (at) => `<${iso(at)}>`
const ago = (s) => Date.now() - s * 1000
const NOTE = '[Notice] <SHUDEvent_OnNotification> Added notification'
const TAGS = '[Team_CoreGameplayFeatures][Missions][Comms]'
// formats copied from real Game.log files (player handle and ids replaced)
const L = {
  logStarted: (at) => {
    // "Mon, 12 Oct 2026 23:13:50 GMT" -> "Mon Oct 12 23:13:50 2026"
    const [wd, day, mon, year, time] = new Date(at ?? Date.now()).toUTCString().replace(',', '').split(' ')
    return `${stamp(at)} Log started on ${wd} ${mon} ${Number(day)} ${time} ${year}`
  },
  accept: (id, title, at) =>
    `${stamp(at)} ${NOTE} "Contract Accepted:  ${title}: " [3] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [] ${TAGS}`,
  objective: (id, text, at) =>
    `${stamp(at)} ${NOTE} "New Objective: ${text}: " [4] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [d19969ff-392e-ae47-918f-62c2022e3139] ${TAGS}`,
  // the game writes Objective Complete over two lines (the text ends in a newline)
  objectiveComplete: (id, text, at) =>
    `${stamp(at)} ${NOTE} "Objective Complete: ${text}\n${stamp(at)} : " [17] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [d19969ff-392e-ae47-918f-62c2022e3139] ${TAGS}`,
  objectiveWithdrawn: (id, text, at) =>
    `${stamp(at)} ${NOTE} "Objective Withdrawn: ${text}: " [40] to queue. New queue size: 3, MissionId: [${id}], ObjectiveId: [2ce15ee2-5fe1-1644-b04a-a1baa852e6a7] ${TAGS}`,
  contractLimit: (at) =>
    `${stamp(at)} ${NOTE} "Contract Not Accepted: Contract Limit Exceeded: " [32] to queue. New queue size: 4, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] ${TAGS}`,
  end: (id, type, at) =>
    `${stamp(at)} [Notice] <EndMission> Ending mission for player. MissionId[${id}] Player[PLAYER] PlayerId[1] CompletionType[${type}] Reason[${type === 'Complete' ? 'Mission Ended' : 'Player left'}] [Team_MissionFeatures][Missions]`,
  shared: (ownerId, id, at) => `${stamp(at)} [Notice] <MissionShared> Received share push message: ownerId[${ownerId}] - missionId[${id}] [Team_GameServices][Missions]`,
  marker: (id, generator, contract, at) =>
    `${stamp(at)} [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [${id}], generator name [${generator}], contract [${contract}], contractDefinitionId[5168b0a5-7816-4c62-9273-7f2c823af115], objectiveId [d19969ff-392e-ae47-918f-62c2022e3139], markerEntityId [14098], zoneHostId [874493856467], position [x: 267369.758029, y: -60808.454505, z: -109494.581748] [Team_MissionFeatures][Missions]`,
  drop: (at) =>
    `${stamp(at)} [Notice] <Channel Disconnected> cause=30016 reason="Remote Disconnect - Player requested disconnect" frame=418017 isRemote=1 viewState=eCVS_InGame map="megamap" gamerules="SC_Default" hostType="Replicant" connection={3, 0} uptime_secs=4036.688477 [Team_Network][Network][Gateway][Disconnection]`,
  // Player[...] is the handle; the diagnostics export must never carry it
  endAs: (id, type, player, playerId, at) =>
    `${stamp(at)} [Notice] <EndMission> Ending mission for player. MissionId[${id}] Player[${player}] PlayerId[${playerId}] CompletionType[${type}] Reason[Player left] [Team_MissionFeatures][Missions]`,
  notice: (text, id, at) =>
    `${stamp(at)} ${NOTE} "${text}: " [9] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [] ${TAGS}`,
  arrive: (hash, player = 'PLAYER', at) =>
    `${stamp(at)} [Notice] <Update Inventory Location> Player [${player}] is changing location. Landing [0] -> [${hash}]. Location [0] -> [${hash}]. Pending [0] [Team_CoreGameplayFeatures][Inventory]`,
  inventory: (code, player = 'PLAYER', at) =>
    `${stamp(at)} [Notice] <RequestLocationInventory> Player[${player}] requested inventory for Location[${code}] [Team_CoreGameplayFeatures][Inventory]`,
  quit: (at) =>
    `${stamp(at)} [Notice] <SystemQuit> CSystem::Quit invoked with - cause=30016, reason=Quit via console command, exitCode=0, thread id=22328, main thread id=22328 [Team_Unknown][System]`
}

// the app's data folder: <HOME>/SuperCargo-OtherModes (%USERPROFILE%\SuperCargo-OtherModes on Windows), settings.json
// included (src/main/paths.ts DATA_FOLDER_NAME). Electron's own userData (Chromium caches, Local Storage, tessdata/ocr-model
// downloads) stays where Electron puts it.
const DATA_FOLDER_NAME = 'SuperCargo-OtherModes'
function dataDir(home) {
  return path.join(home, DATA_FOLDER_NAME)
}
// where the app kept its files before batch 12 (Electron's userData for package name "supercargo"); the app must
// neither read nor write app files there (fresh start, no migration)
function legacyDataDir(home) {
  return process.platform === 'win32' ? path.join(home, 'AppData', 'Roaming', 'supercargo') : path.join(home, '.config', 'supercargo')
}
// a JSON file in a folder, null when missing or not JSON
function readJsonIn(dir, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
  } catch {
    return null
  }
}

function setup(name, settings, jobsDoc) {
  const home = path.join(runRoot, name)
  const data = dataDir(home)
  fs.mkdirSync(data, { recursive: true })
  const gameLog = path.join(home, 'Game.log')
  fs.writeFileSync(gameLog, '')
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      gameLogPath: gameLog,
      onboarded: true,
      workMode: 'other',
      ocrAutoCapture: false,
      shareUsageStats: false,
      contributeTrainingData: false,
      autoCheckUpdates: false,
      overlayStartWithApp: true,
      ...settings
    })
  )
  if (jobsDoc) fs.writeFileSync(path.join(data, 'other-jobs.json'), JSON.stringify(jobsDoc))
  return {
    home,
    data,
    gameLog,
    append: (...lines) => fs.appendFileSync(gameLog, lines.join('\n') + '\n'),
    // a previous game session's log, as the game leaves it in <Game.log dir>/logbackups/
    backup: (lines, name = 'Game Build(12913470) 13 Oct 26 (14 58 34).log') => {
      const dir = path.join(home, 'logbackups')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n')
    },
    jobs: () => readJsonIn(data, 'other-jobs.json'),
    // settings.json always sits in the default data folder, even when the data folder was moved
    settings: () => readJsonIn(data, 'settings.json'),
    log: () => {
      try {
        return fs.readFileSync(path.join(data, 'logs', 'supercargo.log'), 'utf8')
      } catch {
        return ''
      }
    }
  }
}

// every app (and Xvfb) this process started, killed on exit too: a scenario that throws before stop() used to
// leave a detached app + X server running after the suite, holding its display
const live = new Set()
const killGroup = (pid) => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'])
    else process.kill(-pid, 'SIGTERM')
  } catch {
    // already gone
  }
}
process.on('exit', () => {
  for (const pid of live) killGroup(pid)
})
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
// a private X server on a display Xvfb picks itself (-displayfd): fixed -n numbers per pid collided between
// parallel replay processes (run_all), xvfb-run then failed at once and the app never started (app_jobs=0 after 45 s)
function startXvfb() {
  return new Promise((resolve, reject) => {
    const x = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
    live.add(x.pid)
    let out = ''
    let errText = ''
    const timer = setTimeout(() => reject(new Error(`Xvfb gave no display in 10 s ${errText.trim().slice(-200)}`)), 10000)
    x.stderr.on('data', (d) => (errText += d))
    x.stdio[3].on('data', (d) => {
      out += d
      if (!out.includes('\n')) return
      clearTimeout(timer)
      resolve({ pid: x.pid, display: `:${out.trim()}` })
    })
    x.on('exit', (code) => {
      live.delete(x.pid)
      clearTimeout(timer)
      reject(new Error(`Xvfb exited (${code}) ${errText.trim().slice(-200)}`))
    })
  })
}

/** starts the app; resolves to stop(). stop.ready is false when the app never wrote its start-up line (45 s). */
async function launch(env, extraArgs = [], extraEnv = {}) {
  const appEnv = { ...process.env, HOME: env.home, USERPROFILE: env.home, APPDATA: path.join(env.home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(env.home, '.config'), ...extraEnv }
  delete appEnv.ELECTRON_RENDERER_URL
  const args = [root, '--no-sandbox', ...extraArgs]
  const xvfb = useXvfb ? await startXvfb() : null
  if (xvfb) appEnv.DISPLAY = xvfb.display
  const child = spawn(electron, args, { env: appEnv, detached: process.platform !== 'win32', stdio: 'ignore' })
  live.add(child.pid)
  // ready once the main window has bound its listeners (and, in Other mode, run the start-up scan);
  // a fixed wait was flaky with several apps starting at once
  const logFile = path.join(env.data, 'logs', 'supercargo.log')
  const readyRe = /\[main\] (startup scan|init loaded)/
  // a restart on the same data folder: only this run's lines count (the earlier run's ready line is already there)
  let logStart = 0
  try {
    logStart = fs.statSync(logFile).size
  } catch {
    // no log yet
  }
  let ready = false
  const t0 = Date.now()
  while (Date.now() - t0 < 45000) {
    let text = ''
    try {
      text = fs.readFileSync(logFile).subarray(logStart).toString('utf8')
    } catch {
      // not written yet
    }
    if (readyRe.test(text) && (!/workMode=other/.test(text) || /\[main\] startup scan/.test(text) || /startup scan skipped/.test(text))) {
      ready = true
      break
    }
    await sleep(250)
  }
  if (!ready) console.error(`launch: app NOT READY after 45 s (no start-up line in ${logFile}; display ${xvfb?.display ?? 'native'})`)
  await sleep(1000)
  const stop = async () => {
    await sleep(1500) // let saves and the 500 ms log flush land
    killGroup(child.pid)
    live.delete(child.pid)
    await sleep(1500)
    if (xvfb) {
      killGroup(xvfb.pid)
      live.delete(xvfb.pid)
    }
  }
  stop.ready = ready
  return stop
}

// Chrome DevTools Protocol: launch with cdpArgs(port) to run JS in a window (main = index.html, overlay = #compact)
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
const cdpArgs = (port) => [`--remote-debugging-port=${port}`, '--remote-allow-origins=*']
async function cdpTarget(port, which, ms = 15000) {
  const want = (t) => t.type === 'page' && (which === 'overlay' ? /#compact$/.test(t.url) : /index\.html$/.test(t.url) || /^https?:\/\/[^#]*$/.test(t.url))
  for (let t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const t = list.find(want)
      if (t?.webSocketDebuggerUrl) return t
    } catch {
      // not listening yet
    }
  }
  throw new Error(`cdp: no ${which} window on port ${port}`)
}
/** evaluate an expression (promises awaited) in a window; returns its value, throws on a JS exception */
async function cdpEval(port, which, expression, ms = 20000) {
  const t = await cdpTarget(port, which)
  return cdpEvalUrl(t.webSocketDebuggerUrl, expression, ms)
}
async function cdpEvalUrl(wsUrl, expression, ms = 20000) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('cdp: websocket failed'))
  })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`cdp: no answer in ${ms} ms`)), ms)
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data))
        if (msg.id !== 1) return
        clearTimeout(timer)
        const r = msg.result
        if (msg.error) reject(new Error(`cdp: ${msg.error.message}`))
        else if (r?.exceptionDetails) reject(new Error(`js: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`))
        else resolve(r?.result?.value)
      }
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  } finally {
    ws.close()
  }
}
const windowText = (port, which) => cdpEval(port, which, 'document.body.innerText')
// main process: launch with --inspect=<port> to run JS in Electron's main (node inspector, same protocol)
const inspectArgs = (port) => [`--inspect=${port}`]
async function mainEval(port, expression, ms = 20000) {
  let url
  for (let t0 = Date.now(); !url && Date.now() - t0 < 15000; await sleep(250)) {
    try {
      url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]?.webSocketDebuggerUrl
    } catch {
      // not listening yet
    }
  }
  if (!url) throw new Error(`inspect: no main process on port ${port}`)
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('inspect: websocket failed'))
  })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`inspect: no answer in ${ms} ms`)), ms)
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data))
        if (msg.id !== 1) return
        clearTimeout(timer)
        const r = msg.result
        if (msg.error) reject(new Error(`inspect: ${msg.error.message}`))
        else if (r?.exceptionDetails) reject(new Error(`js: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`))
        else resolve(r?.result?.value)
      }
      // includeCommandLineAPI: gives the expression a require()
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } }))
    })
  } finally {
    ws.close()
  }
}
// the Export diagnostics button asks where to save: answer the save dialog with `file` (no OS dialog in tests)
const stubSaveDialog = (port, file) =>
  mainEval(port, `(() => { const { dialog } = require('electron'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(file)} }); return true })()`)
// first value under a key matching re, anywhere in a parsed JSON value
function findKey(v, re, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return undefined
  for (const [k, x] of Object.entries(v)) if (re.test(k)) return x
  for (const x of Object.values(v)) {
    const f = findKey(x, re, depth + 1)
    if (f !== undefined) return f
  }
  return undefined
}
// a section body that is JSON -> value (null when it isn't)
function sectionJson(body) {
  const s = (body ?? '').trim()
  const i = s.search(/[[{]/)
  if (i < 0) return null
  try {
    return JSON.parse(s.slice(i, Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')) + 1))
  } catch {
    return null
  }
}
// poll fn() until it returns truthy (or ms passes); returns the last value
async function until(fn, ms = 12000) {
  let v
  for (let t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    try {
      v = await fn()
    } catch {
      v = undefined
    }
    if (v) return v
  }
  return v
}
// SNAPSHOT section of a diagnostics export -> object
function snapshotJson(text) {
  const snap = diagSections(text)['SNAPSHOT'] ?? ''
  try {
    return JSON.parse(snap.slice(snap.indexOf('{'), snap.lastIndexOf('}') + 1))
  } catch {
    return null
  }
}
// roster coordinates for test maths (straight line, same system)
const ROSTER = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, 'data', 'uex', 'locations.json'), 'utf8'))
    const uex = Object.values(d).flat().filter((l) => l && typeof l === 'object' && l.name)
    // then the non-UEX positions (planet centres, cities): UEX names win where both have one
    let extra = []
    try {
      extra = JSON.parse(fs.readFileSync(path.join(root, 'data', 'uex', 'other-positions.json'), 'utf8')).places ?? []
    } catch {
      // older checkout
    }
    return [...uex, ...extra.filter((l) => l && l.name)]
  } catch {
    return []
  }
})()
const rosterDist = (a, b) => {
  const p = ROSTER.find((l) => l.name === a)
  const q = ROSTER.find((l) => l.name === b)
  return p?.x != null && q?.x != null ? Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) : null
}
// r_DisplayInfo 3 on Hurston's surface (user's screenshot, CONTRACT); 22.8 km from HDRSO-Stott
const DISPLAY_INFO_HURSTON = [
  'Zone: OOC_Stanton_1_Hurston Pos: -663.0188km -725.4411km -190.4883km',
  'Zone: SolarSystem_862399811847 Pos: 12850255.8664km 961.9598km -190.4883km',
  'Current player location : Stanton1',
  'Planet:OOC_Stanton_1_Hurston (working) (Load Complete)',
  'CamPos Planet Zone: -663018.807425 -725441.096333 -190488.315800',
  'Radius: 1000000.000000 ElevationUnderCam: 1064.250000 Altitude 7.436596'
].join('\n')
// the user's real OCR text (CONTRACT2): near Hurston, read as "Open space" / "Stantonl" before the fixes
const OCR_NEAR_HURSTON = [
  'Zone: MISC Hull B 881455961181 Pos: -0.94m 26.39m 0.52m',
  '',
  'Zone: 00C Stanton 1 Hurston Pos: -500.7481km 922.8720km -1516.49m',
  '',
  'Zone: SolarSystem 862321811808 Pos: 12849498.1180km 427.5609km -1516.49m',
  'Zone: Root Pos: 12849498.,1180km 427.5609km -1516.49m',
  '',
  'FPS 82.6 - 12.2ms [11.9ms]'
].join('\n')
// in space, only the top 3 lines read (failed before: no system named)
const OCR_SPACE_TOP3 = [
  'Zone: MISC Hull B 881455961181 Pos: -2.91m 14.90m 0.56m',
  '',
  'Zone: SolarSystem 862321811808 Pos: 12472406.2902km 231654.0157km -233.7724Km',
  '~~ Zone: Root Pos: 12472406.2902km 231654.0157km -233.7724km',
  '',
  'FPS 111.3 - 9.0ms [8.8ms]'
].join('\n')
// the user's real r_DisplayInfo in Seraphim Station's hangar (station over Crusader)
const OCR_SERAPHIM_HANGAR = [
  'Zone: Hangar MediumFront RestStop 878945478212 Pos: 7.42m -125.91m 7.98m',
  'Zone: rs ext cru-leol Pos: -2536.72m -534.32m -51.02m',
  'Zone: 00C Stanton 2 Crusader Pos: 5873.5499km -1384.6519km 5566.0595km',
  'Zone: SolarSystem 874535716059 Pos: -18960653.6168km -2659120.6337km 5566.0595km',
  'Zone: Root Pos: -18960653.6168km -2659120.6337km 5566.0595km',
  'Current player location : RR_CRU LEO (LZ : RR_CRU_LEO)',
  'Planet:00C Stanton 2 Crusader (working) (Load Complete)',
  'CamPos Planet Zone: 5873549.901329 -1384651.879383 5566059.478207',
  'Radius: 7450010.000000 ElevationUnderCam: 2.500000 Altitude 759547.012265'
].join('\n')
// CONTRACT7: the user's real r_DisplayInfo reads at Covalex S1DC06 on Hurston (WHERE AM I HISTORY of the 12:02 export,
// verbatim OCR text, junk included; no player names in them). Before batch 6: RAPPEL read as "Rappel · 46.4 km",
// OPEN1/OPEN2 as "Open space" (body lookup failed, star-frame lines used), PLANET as Covalex 305 m.
const COVALEX_READS = {
  rappel: "-17.32m 6.30m\nkm 671.0478Kkm\nkm 671.0478Km\n\n\\     Zone: int s1 dclcvlx s1dco6 Pos: -41.6\nZon   00C Stanton 1 Hurston Pos: 743.1541km 15.55\n862321811808 Pos: 12850766.4244km -675.89\nZone: Root Pos: 12850766.4244km -675.8950km 671.0478km\nFPS 63.7 - 15.8ms [15.5ms]\n\n=                    Phys: 0.0ms Stall: 390.8fs Event: 0.0ms\n&&rver FPS 5.3 [3,8.)7.6] - 186.9ms [131.7..260%], Hitches: 1\nha-4102-12913470-game-178, restarts 0, pop. [shard 483, srv 80]\nNet: ping 42.5ms, loss 0.0% BwIn 93.684kbps, BwOut 38.536kbps\n2a         RL: eptitfies: 53862, tick: 0.06ms,   Sync: 0.28ms\n\n\\   ServerTime: Wed Oct 14   :58:20 2026\n\n|   UniverseTime: Mon Sep 20 05:50:03 2990\n\nWorking Set (0S): 18.08 GiB Committed (0S)#F 41.14 GiB\nender: MT: 15.5ms RT: 3.8msRGPU: 8.4ms\n\n.                     \\                            Graphics Renderer : Vulkan (DLSS-57%)\n\nt player location :  ——— lb=ne siydys (LZ gS ant nl DistributionCentre Covalex S1DC06)\n\n~ Rlanet:00C Stanton 1 Hurston (working) (Load Complete)\nCamPos Planet Zone: 743154.0 5029 15554.289546 671047 .838195\nRadius: 1000000.000000 ElevationUnder am; 1368.875000 Altitude 42.672056\nXYPos: 20930.101407 902972.696592 Page: 0 (4X)\n\\   Virtual Terrain Cache: Disabled\nEntities: 91612, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\n                                \\       Component updates:   31242, Events handled:     873\nME                                             Game: 0.00ms\nA\n\nog\n> =\n",
  open1: "t player location\n\nZone: int sl dc cvlx sldcO6 Pos: 43.91m 120.61m 4.99m\n\nZone: 00C Stanton 1 Hurston Pos: 743.0986km 15.4152km 671.1105km\n\nZone: SolarSystem 862321811808 Pos: 12850808.5268km -654.9255km 671.1105Kkm\nZone: Root Pos: 12850808.5268km -654.9255km 671.1105km\n\n____eesmem                                     EESTA5.5 - 922 25 Z1=6ms |\n\na                                               Phys: 0.0ms Stall: 0.0ms Event: 0.0ms\nServer FPS 10.6 [10.3..10.8] - 94.1ms [92.4..96.9], Hitches: ©\n\nserver@-useio- sc-stpha-4102-12913470-game 178, restarts 0, pop. [shard 478, srv 78]\nNet: ping 55.3ms, loss 0.0% BwIn 158.132kbps, BwOut 34.775kbps\n\n)                      RL: entities: 53862, tick: 0.07ms, MTSync: 3.14ms\nWEm———                            ServerTime: Wed Oct 14 16:59:50 2026\nUniverseTime: Mon Sep 20 05:59:04 2990\n\nWorking Set (0S): 13.11 GiB Committed (0S): 41.38 GiB\n\nRender: MT: 21.6ms RT: 8.9ms GPU: 11.9ms\n\nGraphics Renderer : Vulkan (DLSS-57%)\n\n: Stantonl DistributionCentre_ Covalex S1DCO6 (LZ : Stantonl DistributionCentre_ Covalex S1DC06)\n\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nCamPos Planet Zone: 743098.607798 15415.178456 671110.471692\n\nRadius: 1000000.000000 ElevationUnderCam: 1380.375000 Altitude 29.847563\n\nXYPos: 20744.459042 903124.343449 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91611, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: ©, QdSOC: ©\nComponent updates:   31374, Events handled:     988\n\nGame: 0.00ms\n",
  open2: "t player location :\n\nZone: 00C Stanton 1 Hurston Pos: 743.1241km 15.3529km 671.0835km\n\nZone: SolarSystem 862321811808 Pos: 12850829.1394km -643.4676km 671.0835km\nZone: Root Pos: 12850829.1394km -643.4676km 671.0835km\n\nEPS OE hms [24 6ms|\n\nEEE                                 Phys: 0,0ms Stall: 176.0ms Event: 0.0ms\n\n‘3                      Servers EERSH Bre ZEn 9B 1155 6ms [[110.9,.122.3], Hitches: ©\n“TH sc-alpha-4102-12913470-game-178, restarts 0, pop. [shard 477, srv 80]\nNet: ping 52.8ms, loss 0.0% BwIn 131.886kbps, BwOut 42.,038kbps\n\nRL: entities: 53837, tick: 0.13ms, MTSync: 1.38ms\n\n|                                   ServerTime: Wed Oct 14 17:00:35 2026\n\nEa                                   UniverseTime: Mon Sep 20 06:03:35 2990\nWorking Set (0S): 13.20 GiB\\ Committed (0S): 41.32 GiB\n\nRender: Mi: 24.7ms RT: 10.7ms GPU: 13.,7ms\n\nGraphics Renderer : Vulkan (DLSS-57%)\n\nStantonl DistributionCentre_ Covalex S1DC06 (LZ : Stantonl DistributionCentre_Covalex S1DCO06)\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nRadius: 1000000.000000 ElevationUnderCam: 1383.937500 Altitude 26.144423\nXYPos: 20659.993258 903057.146818 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91586, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\nComponent updates:   32113, Events handled:     941\n\nGame: 0.00ms\n",
  planet: "Zone: 00C Stanton 1 Hurston Pos: 743.1241km 15.3531km 671.0834km\n\nZone: SolarSystem 862321811808 Pos: 12850849.7228km -631.1189km 671.0834km\n\n~~ Zone: Root Pos: 12850849.7228km -631.1189km 671.0834km\n\nEPSESORAR-m hms: [25 1ms:]\n\neam                               Phys: 0.0ms Stall: 1002.5ms Event: 0.0ms\n\n'7i                      Seve ERS BRORIBE Zr Dad = i2r3ms: [97 5m 1224.5], Hitches: ©\nCE er ng as ome restarts 0, pop. [shard 476, srv 81]\n\nNet: ping 49.5ms, loss 0.0% BwIn 63.834kbps, BwOut 23.749Kkbps\nRL: entities: 53837, tick: 0.09ms, MTSync: 2.45ms\n\nServerTime: Wed Oct 14 17:01:21 2026\n\nUniverseTime: Mon Sep 20 06:08:10 2990\n\nPOET           Working Set (0S): 12.82 GiB Committed (0S): 41.33 GiB\n\nARKEUET                 9            Renders Mis 25L Ams Riz OLw/ms GRU 131, 4ms\n\n=                                             Graphics Renderer : Vulkan (DLSS-57%)\n\nt player location : Stantonl DistributionCentre_Covalex S1DCO6 (LZ : Stantonl DistributionCentre Covalex S1DC06)\nPlanet:00C Stanton 1 Hurston (working) (Load Complete)\n\nRadius: 1000000.000000 ElevationUnderCam: 1383.937500 Altitude 26.144513\n\nXYPos: 20660.172216 903056.989349 Page: 0 (+X)\n\nVirtual Terrain Cache: Disabled\n\nEntities: 91586, PS: 0, QdBatches: 0, LB: 0, QdFinalize: 0, Net-DeferredFinalize: 0, QdSOC: ©\n\nComponent updates:   31523, Events handled:    1712\nGame: 0.00ms\n"
}
const COVALEX = 'Covalex Distribution Centre S1DC06'
// the reads' ServerTime is hours old by test time (accuracy -3, "maybe stale"): set that one line to now, like a live read
const serverTimeNow = (text) => {
  const [wd, day, mon, year, time] = new Date().toUTCString().replace(',', '').split(' ')
  return text.replace(/ServerTime: \w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}/, `ServerTime: ${wd} ${mon} ${Number(day)} ${time} ${year}`)
}
// metres in a "Name · 305 m" / "· 1.2 km" label (null when none)
const labelMeters = (label) => {
  const m = /·\s*([\d.]+)\s*(m|km)\b/.exec(label ?? '')
  return m ? Number(m[1]) * (m[2] === 'km' ? 1000 : 1) : null
}

// --export-diagnostics <file>: the app writes it ~6 s after the main window loads
const DIAG_SECTIONS = ['SUMMARY', 'SETTINGS', 'SNAPSHOT', 'MATCHES', 'MATCH MEMORY', 'UNKNOWN LINES', 'DECISIONS', 'PERF', 'USAGE', 'ERRORS', 'DEBUG LOG', 'LOG EXCERPT']
async function waitForFile(file, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const text = fs.readFileSync(file, 'utf8')
      if (text.length) {
        await sleep(500) // let a write in progress finish
        return fs.readFileSync(file, 'utf8')
      }
    } catch {
      // not written yet
    }
    await sleep(250)
  }
  return null
}
// "## NAME" header -> body text up to the next header
function diagSections(text) {
  const out = {}
  let cur = null
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      cur = m[1].toUpperCase()
      out[cur] = ''
    } else if (cur) out[cur] += line + '\n'
  }
  return out
}

const count = (text, re) => (text.match(re) || []).length
// history entries are flat ({id, ref, outcome, movedBy, steps, archivedAt, ...}); give them a status like a job
const OUTCOME_STATUS = { completed: 'complete', abandoned: 'abandoned' }
const allJobs = (doc) => [...(doc?.jobs ?? []), ...(doc?.history ?? []).map((h) => ({ ...h, status: h.status ?? OUTCOME_STATUS[h.outcome] ?? h.outcome }))]
const findJob = (doc, id) => allJobs(doc).find((j) => j.missionId === id || j.id === id)
const copies = (doc, id) => allJobs(doc).filter((j) => j.missionId === id || j.id === id).length
const logJob = (id, extra = {}) => ({ id, ref: 'J01', title: 'Bounty Hunt', kind: 'delivery', reward: 0, status: 'active', steps: [], createdAt: Date.now(), missionId: id, source: 'log', ...extra })
const histEntry = (id, extra = {}) => ({ id, ref: 'J01', title: 'Bounty Hunt', kind: 'delivery', reward: 0, outcome: 'abandoned', movedBy: 'manual', steps: [], archivedAt: Date.now(), createdAt: Date.now(), missionId: id, source: 'log', ...extra })

// a handle the export must never carry (made up, not a real player)
const DIAG_REAL = 'Zorblax9000'
// fixed start, two steps (same system + through a gateway), a log with the handle in it, two WHERE AM I reads
// (test seam) and a dry-run AFK, then Export diagnostics from the main window with opts
async function diagExportRun(name, opts, after) {
  const step = (id, s) => ({ id, kind: 'go', label: `Go to ${s}`, location: s, have: 0, need: 1, done: false })
  const e = setup(name, { otherStartMode: 'fixed', otherAfkFirstKey: 'F2', otherAfkCycleKey: 'F1' }, {
    jobs: [logJob(mission(), { steps: [step('s1', 'Port Tressler'), step('s2', 'Ruin Station')] })],
    history: [],
    startLocation: 'Seraphim Station',
    startTypedAt: iso(ago(60)),
    listOrder: 'distance'
  })
  const textFile = path.join(e.home, 'where-text.json')
  fs.writeFileSync(textFile, JSON.stringify({ zone2: DISPLAY_INFO_HURSTON, zone1: '' }))
  const out = path.join(e.data, 'export', `${name}.txt`)
  const port = await freePort()
  const iport = await freePort()
  const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], { SC_WHERE_TEXT_FILE: textFile, SC_AFK_DRYRUN: '1', SC_AFK_INTERVAL_MS: '500' })
  let res
  let extra
  let err = ''
  try {
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'), L.endAs(mission(), 'Abandon', DIAG_REAL, '1'), L.arrive('1510935576', DIAG_REAL), L.inventory('RR_CRU_L1', DIAG_REAL))
    await until(() => e.jobs()?.where?.source === 'inventory', 8000)
    await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: '', zone1: 'STANTON SYSTEM > 0.00° 1.06° 12.47GM' }))
    await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
    await cdpEval(port, 'main', 'window.supercargo.otherAfkStart()')
    await until(() => cdpEval(port, 'main', 'window.supercargo.otherAfkGet()').then((s) => (s?.presses >= 2 ? s : null)), 4000)
    await cdpEval(port, 'main', 'window.supercargo.otherAfkStop()')
    await stubSaveDialog(iport, out)
    res = await cdpEval(port, 'main', `window.supercargo.diagExport(${JSON.stringify(opts)})`, 40000)
    if (after) extra = await after({ port, iport })
  } catch (x) {
    err = String(x?.message ?? x)
  }
  await stop()
  let text = null
  try {
    text = fs.readFileSync(res?.path ?? out, 'utf8')
  } catch {
    // checked by the caller
  }
  return { e, res, text, sec: diagSections(text), err, extra }
}

// J74, the user's real courier job (CONTRACT4). Marker line verbatim (time aside); objective texts and ids
// verbatim; the accept title is modelled on the real courier accept lines (the export did not keep it).
const J74 = 'c240a60b-1597-4d36-baf0-98e06dd1fe5c'
const J74_DROP = 'dropoff_f1fc9593-e30c-4303-8a4e-7e1509141107_0'
const J74_PICK = 'pickup_f1fc9593-e30c-4303-8a4e-7e1509141107_0'
const J74_L = {
  // a game launch as the real log opens: build line, then "Log started" (the build is what keys the zone table)
  session: (at) => [`${stamp(at)} BackupNameAttachment=" Build(12913470) 14 Oct 26 (10 12 26)"  -- used by backup system`, L.logStarted(at)],
  marker: (at) =>
    `${stamp(at)} [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [${J74}], generator name [FTL_Courier], contract [FTL_Courier_Stanton_Iron_Rank1], contractDefinitionId[0d41bca1-0bd1-4aad-bf63-9436567a221a], objectiveId [${J74_DROP}], markerEntityId [7145], zoneHostId [862321816216], position [x: -790556.763184, y: 614240.106819, z: -6055.992337] [Team_MissionFeatures][Missions]`,
  accept: (at) =>
    `${stamp(at)} ${NOTE} "Contract Accepted:  Courier Run - from HDPC-Farnesway on Hurston <EM4>[417 Rep]</EM4>: " [47] to queue. New queue size: 5, MissionId: [${J74}], ObjectiveId: [] ${TAGS}`,
  deliver: (at) =>
    `${stamp(at)} ${NOTE} "New Objective: Deliver Iron To Security Compound: " [48] to queue. New queue size: 6, MissionId: [${J74}], ObjectiveId: [${J74_DROP}] ${TAGS}`,
  collect: (at) =>
    `${stamp(at)} ${NOTE} "New Objective: Collect Iron From HDPC-Farnesway on Hurston: " [49] to queue. New queue size: 7, MissionId: [${J74}], ObjectiveId: [${J74_PICK}] ${TAGS}`,
  collected: (at) =>
    `${stamp(at)} ${NOTE} "Objective Complete: Collect Iron From HDPC-Farnesway on Hurston\n${stamp(at)} : " [118] to queue. New queue size: 9, MissionId: [${J74}], ObjectiveId: [${J74_PICK}] ${TAGS}`
}
// typed start Lorville (FIXED); the app starts mid-session (build line above the watermark), then J74 arrives live.
// collected: the Farnesway pickup is done, so the delivery is the next stop. Returns overlay + Next tab text,
// the saved doc and (with exportDiag) the SNAPSHOT of a button-path export.
async function j74Run(name, { collected = false, exportDiag = false } = {}) {
  const e = setup(name, { otherStartMode: 'fixed' }, { jobs: [], history: [], startLocation: 'Lorville', startTypedAt: iso(ago(60)), listOrder: 'distance', lastLogEventAt: iso(ago(30)) })
  e.append(...J74_L.session(ago(120)))
  const port = await freePort()
  const iport = await freePort()
  const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)])
  let overlay = ''
  let next = ''
  let snap = null
  let sec = {}
  let err = ''
  try {
    e.append(J74_L.marker(), J74_L.accept(), J74_L.deliver(), J74_L.collect(), ...(collected ? [J74_L.collected()] : []))
    const want = collected ? /(near|at) HDPC-Cassillo/i : /Farnesway/i
    await until(() => (e.jobs()?.jobs?.[0]?.steps?.length >= 2 ? true : null))
    overlay = (await until(() => windowText(port, 'overlay').then((t) => (want.test(t) ? t : '')), 10000)) || (await windowText(port, 'overlay'))
    await cdpEval(port, 'main', `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'NEXT'); b?.click(); return !!b })()`)
    next = (await until(() => windowText(port, 'main').then((t) => (want.test(t) ? t : '')), 8000)) || (await windowText(port, 'main'))
    if (exportDiag) {
      const out = path.join(e.data, `${name}.txt`)
      await stubSaveDialog(iport, out)
      const res = await cdpEval(port, 'main', `window.supercargo.diagExport({ note: '', includeImages: false })`, 40000)
      const text = fs.readFileSync(res?.path ?? out, 'utf8')
      snap = snapshotJson(text)
      sec = diagSections(text)
    }
  } catch (x) {
    err = String(x?.message ?? x)
  }
  await stop()
  return { e, overlay, next, snap, sec, err, doc: e.jobs() }
}
// "Security Compound" line(s) of a window's text
const lineWith = (text, re) => (text ?? '').split(/\n/).filter((l) => re.test(l)).join(' | ')

// CONTRACT6 REFRESH. Phase A: J74 (and a second job that then ends) arrive live, app quits. The doc is then left as an
// older build would leave it: steps without a position, empty zone table, watermark past the J74 lines (the app's own).
// keepVersion false also drops refreshedForVersion (first start after an update).
const J74_ENDED = '7a1e0d2c-5b6f-4c1e-9a3b-00000000e0e1'
const j74Stripped = (doc, keepVersion) => {
  for (const j of doc.jobs ?? []) for (const s of j.steps ?? []) delete s.position
  delete doc.markerZones
  if (!keepVersion) delete doc.refreshedForVersion
  return doc
}
const j74Drop = (doc) => doc?.jobs?.find((j) => j.missionId === J74)?.steps?.find((s) => s.objectiveId === J74_DROP || /Security Compound/.test(s.label ?? ''))
const traceText = (e) => {
  try {
    return fs.readFileSync(path.join(e.data, 'logs', 'trace.jsonl'), 'utf8')
  } catch {
    return ''
  }
}
const clickButton = (port, which, re) =>
  cdpEval(port, which, `(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.textContent.trim())); b?.click(); return !!b })()`)
async function j74Stale(name, keepVersion) {
  const e = setup(name, { otherStartMode: 'fixed' }, { jobs: [], history: [], startLocation: 'Lorville', startTypedAt: iso(ago(60)), listOrder: 'distance', lastLogEventAt: iso(ago(300)) })
  e.append(...J74_L.session(ago(240)))
  const stop = await launch(e)
  e.append(J74_L.marker(), J74_L.accept(), J74_L.deliver(), J74_L.collect(), J74_L.collected())
  e.append(L.accept(J74_ENDED, 'Bounty Hunt'), L.marker(J74_ENDED, 'Bounty', 'Bounty_Rank1'), L.objective(J74_ENDED, 'Go to Port Tressler'))
  await sleep(1500)
  e.append(L.end(J74_ENDED, 'Complete'))
  await until(() => (e.jobs()?.jobs?.find((j) => j.missionId === J74)?.steps?.length >= 2 && findJob(e.jobs(), J74_ENDED)?.status === 'complete' ? true : null))
  await stop()
  const doc = j74Stripped(e.jobs() ?? { jobs: [], history: [] }, keepVersion)
  fs.writeFileSync(path.join(e.data, 'other-jobs.json'), JSON.stringify(doc))
  return { e, before: doc }
}

// CONTRACT8 (one stop-place resolver): jobs with the given steps, fixed typed start (or a WHERE AM I read when `read`
// is a COVALEX_READS key), Next tab opened, then a button-path export. Returns both windows' text, the SNAPSHOT,
// the export sections and ## MATCHES parsed (null when it isn't JSON, e.g. "(all exact)").
async function matchRun(name, { jobs, read, want = /./, overlayWant = want, typed = 'Lorville' }) {
  const settings = read ? { otherStartMode: 'auto' } : { otherStartMode: 'fixed' }
  const start = read ? {} : { startLocation: typed, startTypedAt: iso(ago(60)) }
  const e = setup(name, settings, { jobs: jobs.map((j) => logJob(mission(), j)), history: [], listOrder: 'distance', ...start })
  const textFile = path.join(e.home, 'where-text.json')
  if (read) fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS[read]), zone1: '' }))
  const port = await freePort()
  const iport = await freePort()
  const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], read ? { SC_WHERE_TEXT_FILE: textFile } : {})
  let w = null
  let overlay = ''
  let next = ''
  let text = null
  let err = ''
  try {
    if (read) {
      await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w = await until(() => (e.jobs()?.where?.name === COVALEX ? e.jobs().where : null))
    }
    overlay = (await until(() => windowText(port, 'overlay').then((t) => (overlayWant.test(t) ? t : '')), 10000)) || (await windowText(port, 'overlay'))
    await clickButton(port, 'main', /^NEXT$/)
    next = (await until(() => windowText(port, 'main').then((t) => (want.test(t) ? t : '')), 8000)) || (await windowText(port, 'main'))
    const out = path.join(e.data, `${name}.txt`)
    await stubSaveDialog(iport, out)
    const res = await cdpEval(port, 'main', `window.supercargo.diagExport({ note: '', includeImages: false })`, 40000)
    text = fs.readFileSync(res?.path ?? out, 'utf8')
  } catch (x) {
    err = String(x?.message ?? x)
  }
  await stop()
  const sec = diagSections(text)
  return { e, w, overlay, next, text, sec, snap: snapshotJson(text), matches: sectionJson(sec['MATCHES']), err }
}
// distanceTable row (SNAPSHOT) whose place matches re
const distRow = (snap, re) => (snap?.other?.distanceTable?.distance ?? []).find((r) => re.test(String(r.place)))
// ## MATCHES entry whose text matches re
const matchEntry = (matches, re) => (Array.isArray(matches) ? matches : []).find((m) => re.test(String(m.text)))
const short = (v, n = 400) => JSON.stringify(v ?? null)?.slice(0, n)
// the matchWord tags, as innerText shows them (the overlay upper-cases some text: match either case)
const TAG = { corrected: /≈\s*corrected/i, marker: /📍\s*game marker/i, none: /✗\s*not found/i, unsure: /\?\s*not sure/i }
const NON_EXACT_TAG = /≈\s*corrected|📍\s*game marker|\?\s*guess|⚠\s*mismatch|\?\s*not sure|✗\s*not found/i

// CONTRACT9 (match memory, M1-M8). The app keeps <data folder>/other-matches.json ({entries, changes}); the main window
// reports non-exact stops ("seen", debounced 5 s), Objective Complete with a fresh read near it is a game proof, the
// tag on a stop opens MatchFix (✓ Right / ✗ Wrong → pick / Forget), the LEARNED DATA tab (CONTRACT12) lists entries + Undo.
const SHUBIN = 'Shubin Mining Facility on Lyria'
const SAL2 = 'Shubin Mining Facility SAL-2'
const memFile = (e) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(e.data, 'other-matches.json'), 'utf8'))
  } catch {
    return null
  }
}
const memEntry = (doc, re) => (doc?.entries ?? []).find((x) => re.test(String(x.text)))
const memGet = (port) => cdpEval(port, 'main', 'window.supercargo.otherMemoryGet()')
// wait for the seen reporter to log the stop, then set its place the way ✓ Right / pick does (IPC, main owns the file)
async function memSetVia(port, re, place) {
  const ent = await until(() => memGet(port).then((d) => memEntry(d, re) ?? null), 15000)
  if (!ent) throw new Error(`memory: no seen entry for ${re}`)
  return cdpEval(port, 'main', `window.supercargo.otherMemorySet(${JSON.stringify({ key: ent.key, text: ent.text, ...(ent.context ? { context: ent.context } : {}), place })})`)
}
const goStep = (id, place) => ({ id, kind: 'go', label: `Deliver Scrap to ${place}`, location: place, have: 0, need: 1, done: false })
// a fixed (Lorville) or read (Covalex 'planet') start; the jobs are seeded, more can arrive through e.append
// `files` ({ 'other-matches.json': doc, ... }) are written into the data folder before the app starts
async function memLaunch(name, { jobs = [], read = false, typed = 'Lorville', files = {}, settings = {} } = {}) {
  const e = setup(name, { otherStartMode: read ? 'auto' : 'fixed', ...settings }, {
    jobs: jobs.map((j) => logJob(mission(), j)),
    history: [],
    listOrder: 'distance',
    ...(read ? { lastLogEventAt: iso(ago(30)) } : { startLocation: typed, startTypedAt: iso(ago(60)) })
  })
  for (const [f, doc] of Object.entries(files)) fs.writeFileSync(path.join(e.data, f), JSON.stringify(doc))
  const textFile = path.join(e.home, 'where-text.json')
  if (read) fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS.planet), zone1: '' }))
  const port = await freePort()
  const iport = await freePort()
  const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], read ? { SC_WHERE_TEXT_FILE: textFile } : {})
  return { e, port, iport, stop, textFile }
}
// a fresh WHERE AM I read (the 'planet' read at Covalex S1DC06, ServerTime now) saved as the doc's where
async function memRead(e, port, textFile) {
  fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS.planet), zone1: '' }))
  const before = e.jobs()?.where?.at
  await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
  return until(() => {
    const w = e.jobs()?.where
    return w?.name === COVALEX && w.source !== 'typed' && w.at !== before ? w : null
  })
}
// Next tab text once it matches re
async function nextText(port, re, ms = 10000) {
  await clickButton(port, 'main', /^NEXT$/)
  return (await until(() => windowText(port, 'main').then((t) => (re.test(t) ? t : '')), ms)) || (await windowText(port, 'main'))
}
async function exportNow(e, port, iport, name) {
  const out = path.join(e.data, `${name}.txt`)
  await stubSaveDialog(iport, out)
  const res = await cdpEval(port, 'main', `window.supercargo.diagExport({ note: '', includeImages: false })`, 40000)
  return fs.readFileSync(res?.path ?? out, 'utf8')
}
// M5 through the real UI in a window: click the stop's tag (a button whose text matches tagRe), then ✗ Wrong, type
// `search` in the picker and click the option naming `place`. Returns which steps found their element.
const uiWrongPick = (port, which, tagRe, search, place) =>
  cdpEval(
    port,
    which,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      const find = (sel, re) => [...document.querySelectorAll(sel)].filter((x) => vis(x) && re.test(x.textContent.trim())).sort((a, b) => a.textContent.length - b.textContent.length)[0]
      const out = {}
      const tag = find('button, [role="button"]', ${tagRe})
      out.tag = !!tag
      if (!tag) return out
      tag.click()
      await sleep(400)
      const wrong = find('button', /Wrong/i)
      out.wrong = !!wrong
      if (!wrong) return out
      wrong.click()
      await sleep(400)
      const inputs = [...document.querySelectorAll('input')].filter(vis)
      const inp = document.activeElement?.tagName === 'INPUT' ? document.activeElement : inputs[inputs.length - 1]
      out.input = !!inp
      if (inp) {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(inp, ${JSON.stringify(search)})
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(400)
      }
      const opt = find('button, [role="option"], li', new RegExp(${JSON.stringify(place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}))
      out.option = !!opt
      if (opt) opt.click()
      await sleep(600)
      return out
    })()`
  )
const MEM_TAG = { user: /✓\s*you set/i, learned: /✓\s*learned/i, disputed: /⚠\s*the game disagrees/i }

// CONTRACT12: the LEARNED DATA tab (Other mode bottom menu: NEXT | JOBS | HISTORY | LEARNED DATA | SETTINGS) holds
// Places (summary, Needs your eye, disputed, table, RECENT CHANGES + UNDO), Sites and Planets. Learned places left
// Settings → OTHER MODE, which keeps one line + OPEN LEARNED DATA. Opens the tab; text once it matches `want`.
async function openLearnedData(port, want = /Needs your eye/i, ms = 10000) {
  const tab = await clickButton(port, 'main', /^LEARNED DATA$/)
  const text = (await until(() => windowText(port, 'main').then((t) => (want.test(t) ? t : '')), ms)) || (await windowText(port, 'main'))
  return { tab, text }
}
// visible button texts of the bottom menu (the last row of buttons in the main window)
const navButtons = (port) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      const bs = [...document.querySelectorAll('button')].filter(vis)
      const bottom = Math.max(...bs.map((b) => b.getBoundingClientRect().top))
      return bs.filter((b) => Math.abs(b.getBoundingClientRect().top - bottom) < 4).map((b) => b.textContent.trim())
    })()`
  )
// the LEARNED DATA page through its test ids: sections, summary counts (learned-count-*), table rows (data-key /
// data-kind, in shown order), Needs your eye rows, Sites / Planets table text, the active sort header
const learnedProbe = (port) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const q = (sel) => [...document.querySelectorAll(sel)]
      const tid = (id) => document.querySelector('[data-testid="' + id + '"]')
      const count = (k) => {
        const b = tid('learned-count-' + k)
        const n = b ? parseInt(b.textContent, 10) : NaN
        return Number.isFinite(n) ? n : null
      }
      return {
        sections: q('[data-testid^="learned-section-"]').map((x) => x.getAttribute('data-testid').replace('learned-section-', '')),
        counts: { user: count('user'), learned: count('learned'), unproven: count('unproven'), disputed: count('disputed') },
        rows: q('tr[data-testid="learned-row"]').map((r) => ({ key: r.getAttribute('data-key'), kind: r.getAttribute('data-kind'), text: r.textContent })),
        needs: q('[data-testid="learned-needs-row"]').map((r) => ({ key: r.getAttribute('data-key'), text: r.textContent })),
        needsText: tid('learned-needs')?.textContent ?? null,
        where: q('[data-testid="learned-where"]').map((x) => x.textContent),
        sites: q('[data-testid="learned-site"]').map((x) => x.textContent),
        planets: q('[data-testid="learned-planet"]').map((x) => x.textContent)
      }
    })()`
  )
// click the button with text btnRe inside the table row for memory key `key`, or the element matching `sel`
const clickRowButton = (port, key, btnRe) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const r = [...document.querySelectorAll('tr[data-testid="learned-row"]')].find((x) => x.getAttribute('data-key') === ${JSON.stringify(key)})
      const b = r && [...r.querySelectorAll('button')].find((x) => ${btnRe}.test(x.textContent.trim()))
      b?.click()
      return { row: !!r, button: !!b }
    })()`
  )
const clickSel = (port, sel) => cdpEval(port, 'main', `(() => { const b = document.querySelector(${JSON.stringify(sel)}); b?.click(); return !!b })()`)
// the focused entry's row: in the window's view and lit (its background differs from the table body's)
const learnedRowView = (port, key) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const r = [...document.querySelectorAll('tr[data-testid="learned-row"]')].find((x) => x.getAttribute('data-key') === ${JSON.stringify(key)})
      if (!r) return null
      const b = r.getBoundingClientRect()
      const bg = getComputedStyle(r).backgroundColor
      return { inView: b.top >= 0 && b.bottom <= window.innerHeight, top: Math.round(b.top), height: window.innerHeight, bg, marked: bg !== getComputedStyle(r.parentElement).backgroundColor && bg !== 'rgba(0, 0, 0, 0)' }
    })()`
  )
// the summary buckets from a memory doc, one per entry (kindOf in LearnedPlaces.tsx: memoryLabel starting with ⚠ ->
// disputed, a game entry with wrong >= 2 too; else user -> you set; else proven (confirmed >= 2 and > wrong) -> learned)
const memCounts = (doc) => {
  const c = { user: 0, learned: 0, unproven: 0, disputed: 0 }
  for (const x of doc?.entries ?? []) {
    const proven = !!x.place && x.origin === 'game' && x.confirmed >= 2 && x.confirmed > x.wrong
    if (x.origin === 'user' ? x.disputed || x.wrong >= 2 : !proven && x.wrong >= 2) c.disputed++
    else if (x.origin === 'user') c.user++
    else if (proven) c.learned++
    else c.unproven++
  }
  return c
}
const sameCounts = (a, b) => !!a && !!b && ['user', 'learned', 'unproven', 'disputed'].every((k) => a[k] === b[k])

// CONTRACT9 ADDENDUM 2 S (data source switches): setting otherSourceStarmap (default on); Settings → OTHER MODE →
// DATA SOURCES has one row per source with its counts and a switch (UEX always on, "base list").
const J82_PICKUP_STEP = {
  id: 's1',
  kind: 'turnin',
  label: 'Collect Scrap from Covalex Distribution Center S1DCO06 on Hurston. Deliver Scrap to Security Compound',
  location: 'Security Compound',
  pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston',
  pickedUp: false,
  item: 'Scrap',
  have: 0,
  need: 1,
  done: false,
  position: { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
}
const settingsGet = (port) => cdpEval(port, 'main', 'window.supercargo.getSettings()')
// CONTRACT11: Settings has a tab bar GENERAL | OTHER MODE; every Other-only row (DATA SOURCES, the LEARNED DATA link, zones,
// hotkey, AFK) lives on OTHER MODE. Opens the Settings page, then that tab; returns which clicks found their button.
async function openSettingsTab(port, tab = 'OTHER MODE') {
  const page = await clickButton(port, 'main', /^SETTINGS$/)
  const re = new RegExp(`^${reEsc(tab)}$`)
  const tabOk = !!(await until(() => clickButton(port, 'main', re).then((ok) => ok || null), 8000))
  return { page, tab: tabOk }
}
// Settings -> OTHER MODE tab text once DATA SOURCES shows
async function sourcesText(port) {
  await openSettingsTab(port, 'OTHER MODE')
  return (await until(() => windowText(port, 'main').then((t) => (/DATA SOURCES/i.test(t) && /starmap/i.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
}
// click the switch in the DATA SOURCES row for the starmap positions (the smallest element naming "Starmap" that holds
// a checkbox / switch / button), then wait for the setting to read `on`. Returns which steps worked.
async function sourcesToggle(port, on) {
  const ui = await cdpEval(
    port,
    'main',
    `(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      const ctl = (el) => el.querySelector('input[type="checkbox"], [role="switch"], button')
      // the DATA SOURCES switch by its accessible name first; else the smallest row naming "Starmap" with a control
      const sw = [...document.querySelectorAll('[role="switch"]')].find((x) => vis(x) && /wiki game data|starmap/i.test(x.getAttribute('aria-label') ?? ''))
      const row = sw ? sw.parentElement : [...document.querySelectorAll('div, li, tr, label, section')].filter((x) => vis(x) && /starmap/i.test(x.textContent) && ctl(x)).sort((a, b) => a.textContent.length - b.textContent.length)[0]
      if (!row) return { row: false }
      const c = sw ?? ctl(row)
      if (c.disabled) return { row: true, control: true, disabled: true }
      c.click()
      return { row: true, control: true, clicked: true }
    })()`
  )
  const s = await until(() => settingsGet(port).then((x) => (x?.otherSourceStarmap === on ? x : null)), 8000)
  return { ...ui, setting: s?.otherSourceStarmap ?? null }
}
// "UEX: 745 places, 610 with coordinates" / "Starmap … adds 312 places, fills coordinates for 128" -> numbers
const sourceCounts = (all) => {
  const t = (all ?? '').slice(Math.max(0, (all ?? '').search(/DATA SOURCES/i)))
  return {
    uex: Number(/UEX[\s\S]{0,120}?([\d,]+)\s*places/i.exec(t)?.[1]?.replace(/,/g, '') ?? NaN),
    uexCoords: Number(/UEX[\s\S]{0,120}?([\d,]+)\s*with coordinates/i.exec(t)?.[1]?.replace(/,/g, '') ?? NaN),
    starmapAdds: Number(/Starmap[\s\S]{0,160}?adds\s*([\d,]+)\s*places/i.exec(t)?.[1]?.replace(/,/g, '') ?? NaN),
    starmapFills: Number(/Starmap[\s\S]{0,160}?fills coordinates for\s*([\d,]+)/i.exec(t)?.[1]?.replace(/,/g, '') ?? NaN)
  }
}
const STARMAP_EV = /from starmap data/i

// CONTRACT10 (one resolver for all of Other mode): a screenshot scan import through the real confirm screen. The
// test seam is main's IPC: ocr:run answers with `rawText` (no capture, no OCR engine), ocr:preview with no picture.
const stubOcr = (iport, rawText) =>
  mainEval(
    iport,
    `(() => {
      const { ipcMain } = require('electron')
      ipcMain.removeHandler('ocr:run')
      ipcMain.removeHandler('ocr:preview')
      ipcMain.handle('ocr:run', async () => (${JSON.stringify({ ok: true, engine: 'tesseract', ms: 1, confidence: 95, rawText, objectives: [], reward: 0 })}))
      ipcMain.handle('ocr:preview', async () => null)
      return true
    })()`
  )
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Jobs tab -> expand the job (by title) -> IMPORT FROM OCR -> CAPTURE; returns the confirm screen's text once it
// matches `want` (the steps are listed with their place tags) and which buttons were found
async function scanToConfirm(port, iport, title, rawText, want) {
  const ui = { stub: await stubOcr(iport, rawText) }
  ui.jobs = await clickButton(port, 'main', /^JOBS$/)
  ui.row = !!(await until(() => clickButton(port, 'main', new RegExp(reEsc(title))).then((ok) => ok || null), 8000))
  ui.import = !!(await until(() => clickButton(port, 'main', /^IMPORT FROM OCR$/).then((ok) => ok || null), 8000))
  ui.capture = !!(await until(() => clickButton(port, 'main', /^CAPTURE$/).then((ok) => ok || null), 8000))
  const text = (await until(() => windowText(port, 'main').then((t) => (/IMPORT FROM OCR/.test(t) && /Step 1/.test(t) && want.test(t) ? t : '')), 12000)) || (await windowText(port, 'main'))
  return { ui, text }
}
// the confirm screen part of the main window's text (from the modal title on)
const confirmPart = (t) => (t ?? '').slice(Math.max(0, (t ?? '').lastIndexOf('IMPORT FROM OCR')))
// the job's step whose text as read (or place) matches re
const stepOf = (e, id, re) => (findJob(e.jobs(), id)?.steps ?? []).find((s) => re.test(String(s.locationRaw ?? s.location ?? '')))
// text right after the Next tab's STARTING AT label (the start line and its tag)
const startPart = (t) => {
  const i = (t ?? '').search(/STARTING AT/i)
  return i < 0 ? '' : t.slice(i, i + 240)
}
const MICROTECH_LOOKALIKE = 'Covalex Distribution Center S1DC06 on microTech'
const SCAN_COVALEX = 'Covalex Distribution Center S1DCO6 on Hurston'

// CONTRACT11 settings-tabs: what the open Settings tab shows. Headings are found by their own text (not a button's),
// so a heading with its one-line description inside still matches; size = computed font-size in px; top = page y.
const OTHER_HEADINGS = [/^jobs\s*&\s*objectives$/i, /^distances\s*&\s*route$/i, /^where am i\b/i, /^places\s*&\s*matching$/i, /^afk$/i]
const settingsProbe = (port) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      const heads = [${OTHER_HEADINGS.join(', ')}]
      const els = [...document.querySelectorAll('body *')].filter((el) => vis(el) && !el.closest('button') && own(el))
      const at = (el) => (el ? { text: own(el), size: parseFloat(getComputedStyle(el).fontSize), top: el.getBoundingClientRect().top + window.scrollY } : null)
      // the biggest match wins (a hint row naming AFK is smaller than the AFK heading); the page's own heading
      // (h2[data-other-section]) is preferred when its text matches
      const best = (re) => at([...document.querySelectorAll('h2[data-other-section]')].find((h) => vis(h) && re.test(own(h))) ?? els.filter((el) => re.test(own(el))).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0])
      const tabs = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim()).filter((t) => /^(GENERAL|OTHER MODE)$/.test(t))
      const ids = [...document.querySelectorAll('[data-other-section]')].filter(vis).map((h) => h.getAttribute('data-other-section'))
      const note = [...document.querySelectorAll('[data-other-settings-note]')].filter(vis).map((n) => n.textContent.trim())
      return { tabs, ids, note, game: best(/^GAME$/), about: best(/^ABOUT$/), headings: heads.map(best), stored: null }
    })()`
  )
// where the AFK heading sits in the window (top/bottom vs innerHeight) and the scrolled amount of every scroller
const afkView = (port) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      const h = document.querySelector('h2[data-other-section="afk"]') ?? [...document.querySelectorAll('body *')].filter((el) => !el.closest('button') && /^afk$/i.test(own(el))).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0]
      if (!h) return null
      const r = h.getBoundingClientRect()
      const scrolled = [document.scrollingElement, ...document.querySelectorAll('body *')].filter((el) => el && el.scrollTop > 0).reduce((n, el) => n + el.scrollTop, 0)
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: window.innerHeight, inView: r.top >= 0 && r.bottom <= window.innerHeight, scrolled }
    })()`
  )
// the jump list's AFK button (nav[data-other-settings-jump]; else the AFK button whose row also names Distances)
const clickJumpAfk = (port) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const nav = document.querySelector('nav[data-other-settings-jump]')
      const b = [...(nav ?? document).querySelectorAll('button')].find((x) => /^afk$/i.test(x.textContent.trim()) && (nav || /distances/i.test(x.parentElement?.textContent ?? '')))
      b?.click()
      return !!b
    })()`
  )
// click the Toggle in the setting row whose label matches `label` (a RegExp; Toggle is a clickable div, not a button)
const clickRowToggle = (port, label) =>
  cdpEval(
    port,
    'main',
    `(() => {
      const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      const lab = [...document.querySelectorAll('span, label, div')].find((el) => ${label}.test(own(el)))
      let row = lab
      for (let i = 0; row && i < 4 && ![...row.querySelectorAll('div')].some((d) => d.style.cursor === 'pointer'); i++) row = row.parentElement
      const t = row && [...row.querySelectorAll('div')].find((d) => d.style.cursor === 'pointer')
      t?.click()
      return { label: !!lab, toggle: !!t }
    })()`
  )
// whole-line matches: the GENERAL About text mentions "Community data sources"
const OTHER_ROWS = /^(Show reputation|Auto-tick objectives|Data Sources|Learned Places|SET UP ZONES|AFK key presser|Withdrawn steps)\b/im
const GENERAL_SECTIONS = ['GAME', 'DATA', 'DATA FOLDER', 'DISPLAY', 'OVERLAY', 'OCR CAPTURE', 'UPDATES', 'ABOUT']

// CONTRACT14 A (data-folder, damaged-data): answer the folder picker with `dir`; a confirm box gets its first
// non-restart, non-cancel button; relaunch/exit are recorded, not done (the harness restarts the app itself)
const stubFolderPick = (iport, dir) =>
  mainEval(
    iport,
    `(() => {
      const { app, dialog } = require('electron')
      const pick = (o) => { const b = (o && o.buttons) || []; const i = b.findIndex((x) => !/restart|cancel/i.test(x)); return i < 0 ? 0 : i }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(dir)}] })
      dialog.showOpenDialogSync = () => [${JSON.stringify(dir)}]
      dialog.showMessageBox = async (...a) => ({ response: pick(a[a.length - 1]), checkboxChecked: false })
      dialog.showMessageBoxSync = (...a) => pick(a[a.length - 1])
      globalThis.__scRestart = globalThis.__scRestart || { relaunch: 0, exit: 0 }
      app.relaunch = () => { globalThis.__scRestart.relaunch++ }
      app.exit = () => { globalThis.__scRestart.exit++ }
      app.quit = () => { globalThis.__scRestart.exit++ }
      return true
    })()`
  )

// CONTRACT14 A damaged-data: the start-up check's native box comes up before an inspector could stub it, so the
// main process loads this module first (NODE_OPTIONS --require). It answers every showMessageBox with the first button
// matching SC_E2E_DIALOG_PICK (a RegExp source; none matches -> cancelId) and appends each box's options to
// SC_E2E_DIALOG_LOG (JSON lines). It patches electron's dialog the first time the app loads 'electron'.
const DIALOG_STUB = `
const fs = require('fs')
const Module = require('module')
const logFile = process.env.SC_E2E_DIALOG_LOG
const want = new RegExp(process.env.SC_E2E_DIALOG_PICK || '^$', 'i')
const rec = (o) => { try { fs.appendFileSync(logFile, JSON.stringify({ title: o && o.title, message: o && o.message, detail: o && o.detail, buttons: o && o.buttons, defaultId: o && o.defaultId, cancelId: o && o.cancelId, type: o && o.type }) + '\\n') } catch (e) {} }
const pick = (o) => { const b = (o && o.buttons) || []; const i = b.findIndex((x) => want.test(String(x))); return i < 0 ? (o && typeof o.cancelId === 'number' ? o.cancelId : 0) : i }
let patched = false
const patch = (m) => {
  if (patched || !m || !m.dialog) return
  patched = true
  m.dialog.showMessageBox = async (...a) => { const o = a[a.length - 1]; rec(o); return { response: pick(o), checkboxChecked: false } }
  m.dialog.showMessageBoxSync = (...a) => { const o = a[a.length - 1]; rec(o); return pick(o) }
}
const orig = Module._load
Module._load = function (req, ...rest) { const m = orig.call(this, req, ...rest); if (req === 'electron') { try { patch(m) } catch (e) {} } return m }
`
function dialogStubEnv(dir, pickRe) {
  const file = path.join(dir, 'dialog-stub.cjs')
  fs.writeFileSync(file, DIALOG_STUB)
  const logFile = path.join(dir, 'dialogs.jsonl')
  return {
    env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(file)}`.trim(), SC_E2E_DIALOG_LOG: logFile, SC_E2E_DIALOG_PICK: pickRe.source },
    boxes: () => {
      try {
        return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      } catch {
        return []
      }
    }
  }
}
// "Moved for Repair\<YYYY-MM-DD HH-MM>[ (n)]" folders under dir
const REPAIR_DIR = 'Moved for Repair'
const repairFolders = (dir) => {
  try {
    return fs.readdirSync(path.join(dir, REPAIR_DIR)).filter((n) => /^\d{4}-\d\d-\d\d \d\d-\d\d( \(\d+\))?$/.test(n)).map((n) => path.join(dir, REPAIR_DIR, n))
  } catch {
    return []
  }
}
const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// CONTRACT14 B/C update window. Every page target except the overlay (the window may be a modal in the main window
// or its own window); text = all of them joined.
async function pageTargets(port) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return list.filter((t) => t.type === 'page' && !/#compact$/.test(t.url) && t.webSocketDebuggerUrl)
  } catch {
    return []
  }
}
async function appText(port) {
  let out = ''
  for (const t of await pageTargets(port)) out += `${await cdpEvalUrl(t.webSocketDebuggerUrl, 'document.body.innerText').catch(() => '')}\n`
  return out
}
// visible, enabled buttons (and role=button / links) whose own text matches re; prefer one inside a dialog
// ([role=dialog], [aria-modal], <dialog>, [data-update-window]), else the last in the page (a modal renders last)
const UI_CLICK = (re, click) => `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const els = [...document.querySelectorAll('button, [role=button], a')].filter((b) => vis(b) && !b.disabled && ${re}.test(b.textContent.trim()))
  const inDlg = (b) => !!b.closest('[role=dialog], [aria-modal="true"], dialog, [data-update-window], [data-testid*="update"]')
  const b = els.find(inDlg) ?? els[els.length - 1]
  if (b && ${click}) b.click()
  return b ? b.textContent.trim() : null
})()`
async function uiClick(port, re) {
  for (const t of await pageTargets(port)) {
    const hit = await cdpEvalUrl(t.webSocketDebuggerUrl, UI_CLICK(re, true)).catch(() => null)
    if (hit) return hit
  }
  return null
}
async function uiHas(port, re) {
  for (const t of await pageTargets(port)) if (await cdpEvalUrl(t.webSocketDebuggerUrl, UI_CLICK(re, false)).catch(() => null)) return true
  return false
}
const BTN = {
  updateNow: /^update now$/i,
  skip: /^skip this version$/i,
  later: /^later$/i,
  install: /^install and restart$/i,
  tryAgain: /^try again$/i,
  releasePage: /^open release page$/i,
  close: /^close$/i,
  checkUpdates: /^check for updates$/i,
  whatsNew: /^what['’]s new$/i,
  checkNow: /^check now$/i
}
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  } catch {
    return '1.0.0'
  }
})()
const bumpMinor = (v, n) => {
  const [a, b] = String(v).split('-')[0].split('.').map(Number)
  return `${a}.${b + n}.0`
}
const AVAILABLE = (v) => new RegExp(`R1\\s+${reEsc(v)}\\s+is available`, 'i')
const WHATS_NEW = (v) => new RegExp(`What['’]s new in R1 ${reEsc(v)}`, 'i')
// record every updater state the renderer receives (the 3 download steps are ~150 ms apart: too quick to poll the text)
const recordUpdates = (port) =>
  cdpEval(port, 'main', `(() => { if (!window.__scUpd) { window.__scUpd = []; window.supercargo.onUpdate((s) => window.__scUpd.push(s)) } return true })()`)
const updStates = (port) => cdpEval(port, 'main', 'window.__scUpd ?? []').catch(() => [])
const updState = (port) => cdpEval(port, 'main', 'window.supercargo.getUpdateState()').catch(() => null)
// shell.openExternal recorded, not done (Open Release Page / links)
const stubExternal = (iport) =>
  mainEval(iport, `(() => { const { shell } = require('electron'); globalThis.__scOpened = []; shell.openExternal = async (u) => { globalThis.__scOpened.push(String(u)) }; return true })()`)
// writes an SC_TEST_UPDATE_FEED fixture into the scenario's home
function updateFeed(e, file, feed) {
  const f = path.join(e.home, file)
  fs.writeFileSync(f, JSON.stringify(feed))
  return f
}
// Settings -> GENERAL -> UPDATES "CHECK FOR UPDATES": opens the window and checks by hand
async function checkByHand(port) {
  await openSettingsTab(port, 'GENERAL')
  return !!(await until(() => clickButton(port, 'main', BTN.checkUpdates).then((ok) => ok || null), 8000))
}

// CONTRACT14 D: a reference data source the app can reach (SC_TEST_REFDATA_BASE = this http base)
const REF_FILES = [
  { repo: 'ships.json', key: 'ships', label: 'Ships', cache: 'uex-vehicles.json' },
  { repo: 'locations.json', key: 'locations', label: 'Locations', cache: 'uex-locations.json' },
  { repo: 'commodities.json', key: 'commodities', label: 'Commodities', cache: 'uex-commodities.json' },
  { repo: 'grid-faces.json', key: 'gridFaces', label: 'Cargo grids', cache: 'uex-grid-faces.json' },
  { repo: 'contract-overrides.json', key: 'contractOverrides', label: 'Contract box sizes', cache: 'uex-contract-overrides.json' }
]
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
function serveDir(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''))
      const body = f.startsWith(dir) ? readText(f) : null
      res.writeHead(body == null ? 404 : 200, { 'Content-Type': 'application/json' })
      res.end(body ?? 'not found')
    })
    srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }))
  })
}
// the text right after a label (a status row: "Ships  Fingerprint didn't match …  14 Oct 2026 21:05")
const afterLabel = (text, label, n = 160) => {
  const i = (text ?? '').search(new RegExp(`(^|\\n|\\t)\\s*${reEsc(label)}\\b`, 'i'))
  return i < 0 ? '' : text.slice(i, i + n)
}
const REF_WORDS = { upToDate: /up to date/i, updated: /\bupdated\b/i, hashMismatch: /fingerprint didn['’]t match/i, downloadFailed: /couldn['’]t download/i, badFormat: /format not understood/i }
const REF_WARN = /reference data:\s*(\d+)\s*files?(\(s\))?\s*couldn['’]t be updated/i

// CONTRACT14 E overlay-header: per stop, the header's height, where the next row starts and the name cell
const overlayHeader = (port) =>
  cdpEval(
    port,
    'overlay',
    `(() => {
      const prev = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '\\u2039')
      const head = document.querySelector('[data-testid="overlay-stop-header"]') ?? prev?.parentElement?.parentElement
      const row = head?.closest('[data-testid="overlay-stop-header"]')?.parentElement?.parentElement ?? head
      const name = document.querySelector('[data-testid="overlay-stop-name"]')
      const r = head?.getBoundingClientRect()
      const nextRow = row?.nextElementSibling?.getBoundingClientRect()
      const cs = name ? getComputedStyle(name) : null
      const stop = (document.body.innerText.match(/STOP\\s*(\\d+)\\s*\\/\\s*(\\d+)/) ?? []).slice(1).map(Number)
      return {
        height: r ? Math.round(r.height * 10) / 10 : null,
        nextTop: nextRow ? Math.round(nextRow.top * 10) / 10 : null,
        name: name?.textContent ?? null,
        title: name?.getAttribute('title') ?? null,
        clipped: name ? name.scrollWidth > name.clientWidth : null,
        ellipsis: cs ? cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' : null,
        stop
      }
    })()`
  )

// overlay-footer-narrow: the footer row's buttons and brand label, by test id (old code: by text)
const overlayFooter = (port) =>
  cdpEval(
    port,
    'overlay',
    `(() => {
      const byId = (id) => document.querySelector('[data-testid="' + id + '"]')
      const btns = [...document.querySelectorAll('button')]
      const brand = byId('overlay-brand') ?? [...document.querySelectorAll('div,span')].find((x) => x.children.length === 0 && /SUPERCARGO\\s*\\u00b7\\s*OTHER MODE/.test(x.textContent))
      const row = byId('overlay-footer') ?? brand?.parentElement
      const abandon = byId('overlay-btn-abandon') ?? btns.find((b) => b.textContent.trim() === 'ABANDON')
      const afk = byId('overlay-btn-afk') ?? btns.find((b) => /^AFK$/.test(b.textContent.trim()))
      const step = byId('overlay-btn-step') ?? (abandon ? btns[btns.indexOf(abandon) - 1] : null)
      const card = row?.parentElement
      const box = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { text: el.textContent.trim(), l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, sw: el.scrollWidth, cw: el.clientWidth }
      }
      return { winW: window.innerWidth, ids: !!byId('overlay-footer'), step: box(step), abandon: box(abandon), afk: box(afk), brand: box(brand), card: box(card) }
    })()`
  )

// overlay-from-row: the FROM row (start, pin) and the footer's buttons and brand label, by test id (old code: by text)
const overlayFromRow = (port) =>
  cdpEval(
    port,
    'overlay',
    `(() => {
      const byId = (id) => document.querySelector('[data-testid="' + id + '"]')
      const btns = [...document.querySelectorAll('button')]
      const brand = byId('overlay-brand') ?? [...document.querySelectorAll('div,span')].find((x) => x.children.length === 0 && /SUPERCARGO\\s*\\u00b7\\s*OTHER MODE/.test(x.textContent))
      const footer = byId('overlay-footer') ?? brand?.parentElement
      const abandon = byId('overlay-btn-abandon') ?? btns.find((b) => b.textContent.trim() === 'ABANDON')
      const afk = byId('overlay-btn-afk') ?? btns.find((b) => /^AFK$/.test(b.textContent.trim()))
      const step = byId('overlay-btn-step') ?? (abandon ? btns[btns.indexOf(abandon) - 1] : null)
      const fromLabel = [...document.querySelectorAll('span')].find((x) => x.children.length === 0 && x.textContent.trim() === 'FROM:')
      const whereBtn = btns.find((b) => /WHERE AM I/.test(b.textContent))
      const row = byId('overlay-from-row') ?? (fromLabel ?? whereBtn)?.closest('div')
      const pin = byId('overlay-where-pin') ?? btns.find((b) => /^Where am I/.test(b.getAttribute('title') ?? '')) ?? (row && whereBtn && row.contains(whereBtn) ? whereBtn : null)
      const card = byId('overlay-footer')?.parentElement ?? footer?.parentElement
      const box = (el) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { text: el.textContent.trim().slice(0, 120), l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, t: Math.round(r.top * 10) / 10, b: Math.round(r.bottom * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, sw: el.scrollWidth, cw: el.clientWidth }
      }
      return { winW: window.innerWidth, ids: !!byId('overlay-from-row'), step: box(step), abandon: box(abandon), afk: box(afk), brand: box(brand), card: box(card), row: box(row), pin: box(pin), rowText: row?.innerText ?? '' }
    })()`
  )

const scenarios = {
  // #1 both windows ingest the same accept
  'single-ingest': async () => {
    const e = setup('single-ingest')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
    await sleep(3000)
    await stop()
    const created = count(e.log(), new RegExp(`job created.*${id.slice(0, 8)}`, 'g'))
    const doc = e.jobs()
    return [
      ['job created once (not once per window)', created === 1, `created lines=${created}`],
      ['one job saved', doc?.jobs?.length === 1, `jobs=${doc?.jobs?.length}`],
      ['objective became one step', doc?.jobs?.[0]?.steps?.length === 1, `steps=${doc?.jobs?.[0]?.steps?.length}`]
    ]
  },

  // log EndMission Complete closes the job as complete
  'end-complete': async () => {
    const e = setup('end-complete')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
    await sleep(2000)
    e.append(L.end(id, 'Complete'))
    await sleep(2000)
    await stop()
    const job = allJobs(e.jobs()).find((j) => j.missionId === id || j.id === id)
    return [['job complete after EndMission Complete', job?.status === 'complete', `status=${job?.status}`]]
  },

  // #2 manual order and start location survive a restart and a save
  'order-persists': async () => {
    const e = setup('order-persists', {}, { jobs: [], history: [], startLocation: 'Port Tressler', listOrder: 'manual', jobOrder: ['a', 'b'] })
    const stop = await launch(e)
    e.append(L.accept(mission(), 'Bounty Hunt')) // forces a save
    await sleep(3000)
    await stop()
    const doc = e.jobs()
    return [
      ['listOrder kept', doc?.listOrder === 'manual', `listOrder=${doc?.listOrder}`],
      ['jobOrder kept', Array.isArray(doc?.jobOrder) && doc.jobOrder.includes('a'), `jobOrder=${JSON.stringify(doc?.jobOrder)}`],
      ['startLocation kept', doc?.startLocation === 'Port Tressler', `startLocation=${doc?.startLocation}`]
    ]
  },

  // #3 Haul mode must not create Other jobs
  'haul-mode-ignores-other': async () => {
    const e = setup('haul-mode-ignores-other', { workMode: 'haul' })
    const stop = await launch(e)
    e.append(L.accept(mission(), 'Bounty Hunt'))
    await sleep(3000)
    await stop()
    const n = e.jobs()?.jobs?.length ?? 0
    return [['no Other job from a bounty in Haul mode', n === 0, `jobs=${n}`]]
  },

  // R1 1.0.0 bug: started in Haul with the overlay open, Work mode switched to Other in the main window; the overlay kept
  // the Haul card (main pushed settings to the overlay only for six overlay keys, not workMode). Every settings change
  // now reaches the overlay: the mode switch, and an Other-mode overlay setting changed later.
  'overlay-follows-mode': async () => {
    const e = setup('overlay-follows-mode', { workMode: 'haul', otherStartMode: 'fixed', overlayStartWithApp: true }, { jobs: [], history: [], startLocation: 'Seraphim Station', startTypedAt: iso(ago(60)), listOrder: 'distance' })
    // the card's distance line, e.g. "57.5 Gm from start" (the stop header's "FROM START" tag is not it)
    const DIST = /[\d.,]+\s*[kMG]?m\s*from start/
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port))
    const r = {}
    let err = ''
    try {
      r.overlayBefore = await until(() => windowText(port, 'overlay'), 10000)
      // the WORK MODE block above Settings in Haul mode: click "○ Other — …"
      r.settingsPage = await clickButton(port, 'main', /^SETTINGS$/)
      r.otherClick = !!(await until(() => clickButton(port, 'main', /^\u25cb\s*Other\b/).then((ok) => ok || null), 8000))
      r.mode = (await until(() => settingsGet(port).then((s) => (s?.workMode === 'other' ? s.workMode : null)), 8000)) ?? (await settingsGet(port))?.workMode
      const id = mission()
      e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
      r.job = !!(await until(() => (findJob(e.jobs(), id)?.steps?.length ? true : null)))
      // nothing else touched: the overlay shows the Other card with the job's stop and its distance line
      r.overlay = (await until(() => windowText(port, 'overlay').then((t) => (/Port Tressler/.test(t) && DIST.test(t) ? t : '')), 12000)) || (await windowText(port, 'overlay'))
      // Settings -> OTHER MODE -> "Distances on the overlay" off: the overlay's distance line goes
      r.tab = await openSettingsTab(port, 'OTHER MODE')
      r.toggle = await until(() =>
        cdpEval(
          port,
          'main',
          `(() => { const s = [...document.querySelectorAll('span')].find((x) => /^Distances on the overlay/.test(x.textContent.trim())); const t = s?.parentElement?.lastElementChild; if (!t || t === s) return null; t.click(); return true })()`
        ), 8000)
      r.distSetting = (await until(() => settingsGet(port).then((s) => (s?.otherOverlayDistance === false ? 'off' : null)), 8000)) ?? String((await settingsGet(port))?.otherOverlayDistance)
      r.overlayOff = (await until(() => windowText(port, 'overlay').then((t) => (/Port Tressler/.test(t) && !DIST.test(t) ? t : '')), 10000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const ov = (t) => JSON.stringify((t ?? '').slice(0, 300))
    return [
      ['Work mode switched to Other from the main window (WORK MODE block)', r.otherClick && r.mode === 'other', `click=${r.otherClick} workMode=${r.mode} ${err}`],
      ['Other job created from the log', r.job === true, `job=${r.job}`],
      ['overlay shows the Other card with the job stop (no other setting touched)', /Port Tressler/.test(r.overlay ?? ''), `overlay=${ov(r.overlay)} before=${ov(r.overlayBefore)}`],
      ['overlay shows the stop distance ("from start")', DIST.test(r.overlay ?? ''), `overlay=${ov(r.overlay)}`],
      ['"Distances on the overlay" switched off in Settings', r.distSetting === 'off', `toggle=${r.toggle} tab=${short(r.tab)} setting=${r.distSetting}`],
      ['overlay drops the distance line once it is off', /Port Tressler/.test(r.overlayOff ?? '') && !DIST.test(r.overlayOff ?? ''), `overlay=${ov(r.overlayOff)}`]
    ]
  },

  // #4 a job that ended Complete while the app was closed is not recorded as abandoned
  'complete-while-closed': async () => {
    const id = mission()
    const job = { id, ref: 'J01', title: 'Bounty Hunt', kind: 'delivery', reward: 0, status: 'active', steps: [], createdAt: Date.now(), missionId: id, source: 'log' }
    const e = setup('complete-while-closed', {}, { jobs: [job], history: [] })
    e.append(L.accept(id, 'Bounty Hunt'), L.end(id, 'Complete'))
    const stop = await launch(e)
    await stop()
    const found = allJobs(e.jobs()).find((j) => j.id === id)
    return [['outcome is complete, not abandoned', found?.status === 'complete', `status=${found?.status}`]]
  },

  // rule 7: start-up applies only events newer than lastLogEventAt, so an archived job does not come back
  // from an old accept line (a re-share AFTER the watermark would reactivate it, rule 4)
  'archived-stays-archived': async () => {
    const id = mission()
    const fresh = mission()
    const watermark = iso(ago(30))
    const e = setup('archived-stays-archived', {}, { jobs: [], history: [histEntry(id)], lastLogEventAt: watermark })
    e.append(L.logStarted(ago(120)), L.accept(id, 'Bounty Hunt', ago(60)), L.objective(id, 'Go to Port Tressler', ago(60)), L.accept(fresh, 'Patrol', ago(10)))
    const stop = await launch(e)
    await stop()
    const doc = e.jobs()
    const active = (doc?.jobs ?? []).filter((j) => j.id === id || j.missionId === id)
    return [
      ['archived mission not re-created as active', active.length === 0, `active copies=${active.length}`],
      ['archived entry still in history', (doc?.history ?? []).some((h) => h.id === id || h.missionId === id), `history=${doc?.history?.length}`],
      ['accept newer than the watermark was applied', findJob(doc, fresh)?.status === 'active', `fresh=${findJob(doc, fresh)?.status}`],
      ['watermark moved forward', !!doc?.lastLogEventAt && doc.lastLogEventAt > watermark, `lastLogEventAt=${doc?.lastLogEventAt}`]
    ]
  },

  // rule 7: a restart does not re-apply old objectives onto a kept job
  'restart-no-reapply': async () => {
    const id = mission()
    const step = { id: 's1', kind: 'go', label: 'Go to Port Tressler', location: 'Port Tressler', have: 0, need: 1, done: true, logText: 'Go to Port Tressler' }
    const e = setup('restart-no-reapply', {}, { jobs: [logJob(id, { steps: [step] })], history: [], lastLogEventAt: iso(ago(30)) })
    e.append(L.accept(id, 'Bounty Hunt', ago(60)), L.objective(id, 'Go to Port Tressler', ago(60)), L.end(id, 'Abandon', ago(50)))
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    return [
      ['old ending not re-applied', job?.status === 'active', `status=${job?.status}`],
      ['old objective not added again', job?.steps?.length === 1, `steps=${job?.steps?.length}`],
      ['user tick kept', job?.steps?.[0]?.done === true, `done=${job?.steps?.[0]?.done}`]
    ]
  },

  // rule 4 + 3: a re-share reactivates an abandoned job, and the later Complete wins
  'reshare-reactivates': async () => {
    const e = setup('reshare-reactivates')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
    await sleep(2000)
    e.append(L.end(id, 'Abandon'))
    await sleep(2000)
    // poll: one read 2 s after the append raced the watcher on a busy CI runner (status=active)
    const afterAbandon = (await until(() => (findJob(e.jobs(), id)?.status === 'abandoned' ? 'abandoned' : null))) ?? findJob(e.jobs(), id)?.status
    e.append(L.shared('900000000001', id), L.accept(id, 'Bounty Hunt'))
    await sleep(2000)
    const mid = e.jobs()
    const afterReshare = findJob(mid, id)?.status
    const midCopies = copies(mid, id)
    e.append(L.end(id, 'Complete'))
    await sleep(2000)
    await stop()
    const doc = e.jobs()
    return [
      ['abandoned after EndMission Abandon', afterAbandon === 'abandoned', `status=${afterAbandon}`],
      ['active again after the re-share accept', afterReshare === 'active', `status=${afterReshare}`],
      ['one copy of the job after the re-share', midCopies === 1, `copies=${midCopies}`],
      ['the later Complete wins', findJob(doc, id)?.status === 'complete', `status=${findJob(doc, id)?.status}`],
      ['still one copy at the end', copies(doc, id) === 1, `copies=${copies(doc, id)}`]
    ]
  },

  // rule 4: the re-share brings an archived (history) job back to the Jobs list
  'reshare-unarchives': async () => {
    const id = mission()
    const e = setup('reshare-unarchives', {}, { jobs: [], history: [histEntry(id, { ref: 'J05' })] })
    const stop = await launch(e)
    e.append(L.shared('900000000001', id), L.accept(id, 'Bounty Hunt'))
    await sleep(3000)
    await stop()
    const doc = e.jobs()
    const active = (doc?.jobs ?? []).find((j) => j.id === id || j.missionId === id)
    return [
      ['archived job is active again', active?.status === 'active', `status=${active?.status}`],
      ['no longer in history', !(doc?.history ?? []).some((h) => h.id === id || h.missionId === id), `history=${doc?.history?.length}`],
      ['one copy', copies(doc, id) === 1, `copies=${copies(doc, id)}`]
    ]
  },

  // rule 5: quit to menu / server hop ("Player requested disconnect") abandons every active log job
  'quit-to-menu-abandons': async () => {
    const e = setup('quit-to-menu-abandons')
    const stop = await launch(e)
    const a = mission()
    const b = mission()
    e.append(L.accept(a, 'Bounty Hunt'), L.accept(b, 'Patrol'))
    await sleep(2000)
    e.append(L.drop())
    await sleep(2500)
    await stop()
    const doc = e.jobs()
    return [
      ['first job abandoned', findJob(doc, a)?.status === 'abandoned', `status=${findJob(doc, a)?.status}`],
      ['second job abandoned', findJob(doc, b)?.status === 'abandoned', `status=${findJob(doc, b)?.status}`]
    ]
  },

  // rule 5: SystemQuit "Quit via console command" (quit game) abandons every active log job
  'systemquit-abandons': async () => {
    const e = setup('systemquit-abandons')
    const stop = await launch(e)
    const a = mission()
    e.append(L.accept(a, 'Bounty Hunt'), L.objective(a, 'Go to Port Tressler'))
    await sleep(2000)
    e.append(L.quit())
    await sleep(2500)
    await stop()
    const job = findJob(e.jobs(), a)
    return [['job abandoned after SystemQuit', job?.status === 'abandoned', `status=${job?.status}`]]
  },

  // rule 6: a previous log with contract activity and no SystemQuit is a crash: jobs stay active, the user is told
  'crash-keeps-jobs': async () => {
    const id = mission()
    const e = setup('crash-keeps-jobs', {}, { jobs: [logJob(id)], history: [], lastLogEventAt: iso(ago(300)) })
    e.backup([L.logStarted(ago(240)), L.marker(id, 'VisitingIasi', 'Iasi_EliminateSpecific_Easy_0', ago(200)), L.accept(id, 'Bounty Hunt', ago(200)), L.objective(id, 'Go to Port Tressler', ago(200))])
    // current Game.log is empty: the game has not been started again yet
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    const notice = e.log().split('\n').filter((l) => /\bother\b/.test(l) && /crash/i.test(l))
    return [
      ['job still active after a crash', job?.status === 'active', `status=${job?.status}`],
      ['one copy', copies(e.jobs(), id) === 1, `copies=${copies(e.jobs(), id)}`],
      ['debug log shows the crash notice', notice.length > 0, `lines=${notice.length}`]
    ]
  },

  // reviewer: a line in the same millisecond as the watermark is still applied after a restart
  'same-ms-after-watermark': async () => {
    const id = mission()
    const t = ago(60)
    const e = setup('same-ms-after-watermark', {}, { jobs: [logJob(id)], history: [], lastLogEventAt: iso(t) })
    e.append(L.logStarted(ago(120)), L.accept(id, 'Bounty Hunt', t), L.objective(id, 'Go to Port Tressler', t))
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    return [
      ['objective in the watermark ms became a step', job?.steps?.length === 1, `steps=${job?.steps?.length}`],
      ['still one copy', copies(e.jobs(), id) === 1, `copies=${copies(e.jobs(), id)}`]
    ]
  },

  // reviewer: replaying the watermark's millisecond must not undo what the user did after it
  'restart-keeps-user-action': async () => {
    const id = mission()
    const t = ago(60)
    const e = setup('restart-keeps-user-action', {}, { jobs: [logJob(id, { status: 'abandoned' })], history: [], lastLogEventAt: iso(t), lastLogEventCount: 1 })
    e.append(L.logStarted(ago(120)), L.accept(id, 'Bounty Hunt', t))
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    return [['user abandon kept (old accept not re-applied)', job?.status === 'abandoned', `status=${job?.status}`]]
  },

  // #7: a step with no UEX place gets its mission marker's position (system-frame zone used as is)
  'marker-position': async () => {
    const e = setup('marker-position', {}, { jobs: [], history: [], lastLogEventAt: iso(ago(30)) })
    // the app starts mid-session: the build line is above the watermark
    e.append(`${stamp(ago(120))} BackupNameAttachment=" Build(12913470) 13 Oct 26 (18 39 13)"  -- used by backup system`, L.logStarted(ago(120)))
    const stop = await launch(e)
    const id = mission()
    const obj = 'a1b2c3d4-0000-4000-8000-00000000beef'
    e.append(
      `${stamp()} [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [${id}], generator name [VisitingIasi], contract [Iasi_Salvage_Wreck], contractDefinitionId[5168b0a5-7816-4c62-9273-7f2c823af115], objectiveId [${obj}], markerEntityId [14098], zoneHostId [862551775550], position [x: 18379031526.5, y: -21999936331.25, z: 1234.5] [Team_MissionFeatures][Missions]`,
      L.accept(id, 'Salvage Contract'),
      `${stamp()} ${NOTE} "New Objective: Go to Caterpillar wreck site: " [4] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [${obj}] ${TAGS}`
    )
    // wait for the result rather than a fixed time: flaky with several apps starting at once
    for (let t0 = Date.now(); Date.now() - t0 < 12000 && !e.jobs()?.jobs?.[0]?.steps?.[0]?.position; ) await sleep(250)
    await stop()
    const step = e.jobs()?.jobs?.[0]?.steps?.[0]
    const pos = step?.position
    return [
      ['step has the marker position', !!pos && Math.abs(pos.x - 18379031526.5) < 1 && Math.abs(pos.y + 21999936331.25) < 1, `position=${JSON.stringify(pos)}`]
    ]
  },

  // reviewer (rule 1): Haul mode never creates Other jobs, but endings for existing ones still apply live
  'haul-mode-ending-applies': async () => {
    const id = mission()
    const e = setup('haul-mode-ending-applies', { workMode: 'haul' }, { jobs: [logJob(id)], history: [] })
    const stop = await launch(e)
    e.append(L.end(id, 'Complete'))
    await sleep(2500)
    await stop()
    const job = findJob(e.jobs(), id)
    return [['ending applied in Haul mode', job?.status === 'complete', `status=${job?.status}`]]
  },

  // reviewer (rule 6): app opened after a crash but before the game: judged from Game.log itself
  'crash-from-current-log': async () => {
    const id = mission()
    const e = setup('crash-from-current-log', {}, { jobs: [logJob(id)], history: [], lastLogEventAt: iso(ago(600)) })
    e.append(L.logStarted(ago(500)), L.accept(id, 'Bounty Hunt', ago(400)), L.objective(id, 'Go to Port Tressler', ago(400)))
    const old = new Date(ago(300))
    fs.utimesSync(e.gameLog, old, old) // the game is not running: Game.log stopped growing
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    const notice = e.log().split('\n').filter((l) => /\bother\b/.test(l) && /crash/i.test(l))
    return [
      ['job kept after the crash', job?.status === 'active', `status=${job?.status}`],
      ['crash noticed', notice.length > 0, `lines=${notice.length}`]
    ]
  },

  // reviewer (rule 5): only the two quit reasons end contracts
  'other-systemquit-not-quit': async () => {
    const id = mission()
    const e = setup('other-systemquit-not-quit', {}, { jobs: [logJob(id)], history: [] })
    const stop = await launch(e)
    e.append(`${stamp()} [Notice] <SystemQuit> CSystem::Quit invoked with - cause=1, reason=Shader cache rebuild, exitCode=0 [Team_Unknown][System]`)
    await sleep(2500)
    await stop()
    const job = findJob(e.jobs(), id)
    return [['job still active', job?.status === 'active', `status=${job?.status}`]]
  },

  // rule 7 + 5: a previous log that ends in SystemQuit abandons the kept job at start-up
  'previous-quit-abandons': async () => {
    const id = mission()
    const e = setup('previous-quit-abandons', {}, { jobs: [logJob(id)], history: [], lastLogEventAt: iso(ago(300)) })
    e.backup([L.logStarted(ago(240)), L.accept(id, 'Bounty Hunt', ago(200)), L.objective(id, 'Go to Port Tressler', ago(200)), L.drop(ago(100)), L.quit(ago(100))])
    const stop = await launch(e)
    await stop()
    const job = findJob(e.jobs(), id)
    return [
      ['job abandoned because the last session quit', job?.status === 'abandoned', `status=${job?.status}`],
      ['one copy', copies(e.jobs(), id) === 1, `copies=${copies(e.jobs(), id)}`]
    ]
  },

  // Objective Complete (two-line form) ticks the step whose text matches, and only that one
  'objective-complete-ticks': async () => {
    const e = setup('objective-complete-ticks')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'), L.objective(id, 'Neutralize Vanduul Scout'))
    await sleep(2000)
    e.append(L.objectiveComplete(id, 'Go to Port Tressler'))
    await sleep(2500)
    await stop()
    const steps = findJob(e.jobs(), id)?.steps ?? []
    const go = steps.find((s) => /Port Tressler/.test(s.logText ?? s.label ?? ''))
    const other = steps.find((s) => s !== go)
    return [
      ['matching step ticked', go?.done === true, `done=${go?.done} steps=${steps.length}`],
      ['other step not ticked', other && other.done !== true, `done=${other?.done}`]
    ]
  },

  // Objective Withdrawn marks the step withdrawn
  'objective-withdrawn': async () => {
    const e = setup('objective-withdrawn')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to the asteroids surrounding Yela'), L.objective(id, 'Go to Port Tressler'))
    await sleep(2000)
    e.append(L.objectiveWithdrawn(id, 'Go to the asteroids surrounding Yela'))
    await sleep(2500)
    await stop()
    const steps = findJob(e.jobs(), id)?.steps ?? []
    const yela = steps.find((s) => /Yela/.test(s.logText ?? s.label ?? ''))
    const other = steps.find((s) => s !== yela)
    return [
      ['withdrawn step marked', yela?.withdrawn === true, `withdrawn=${yela?.withdrawn}`],
      ['other step untouched', other && !other.withdrawn, `withdrawn=${other?.withdrawn}`]
    ]
  },

  // the game refuses a contract at the limit: a toast (recorded in the debug log), no job
  'contract-limit-toast': async () => {
    const e = setup('contract-limit-toast')
    const stop = await launch(e)
    e.append(L.contractLimit())
    await sleep(2500)
    await stop()
    const lines = e.log().split('\n').filter((l) => /contract limit/i.test(l))
    return [
      ['debug log shows the contract-limit toast', lines.length > 0, `lines=${lines.length}`],
      ['no job made', (e.jobs()?.jobs?.length ?? 0) === 0, `jobs=${e.jobs()?.jobs?.length ?? 0}`]
    ]
  },

  // reputation in the title lands on job.rep and leaves the title
  'rep-parsed': async () => {
    const e = setup('rep-parsed')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'RSI Disc. Month: Package Recovery (Exp. E) <EM4>[313 Rep]</EM4>'))
    await sleep(3000)
    await stop()
    const job = findJob(e.jobs(), id)
    return [
      ['rep is 313', job?.rep === 313, `rep=${job?.rep}`],
      ['title has no markup', job && !/EM4|Rep\]/.test(job.title), `title=${JSON.stringify(job?.title)}`]
    ]
  },

  // a MissionShared push before the accept sets sharedBy to the owner
  'shared-by': async () => {
    const e = setup('shared-by')
    const stop = await launch(e)
    const id = mission()
    const solo = mission()
    e.append(L.shared('900000000042', id), L.marker(id, 'VisitingIasi', 'Iasi_EliminateAll_Medium'), L.accept(id, 'Bounty Hunt'), L.accept(solo, 'Patrol'))
    await sleep(3000)
    await stop()
    const doc = e.jobs()
    return [
      ['sharedBy is the owner id', findJob(doc, id)?.sharedBy === '900000000042', `sharedBy=${findJob(doc, id)?.sharedBy}`],
      ['own contract has no sharedBy', !findJob(doc, solo)?.sharedBy, `sharedBy=${findJob(doc, solo)?.sharedBy}`]
    ]
  },

  // J-refs never repeat, also after jobs move to history
  'refs-unique': async () => {
    const e = setup('refs-unique', {}, { jobs: [], history: [histEntry('old-1', { ref: 'J01', missionId: undefined, source: 'manual' }), histEntry('old-2', { ref: 'J02', missionId: undefined, source: 'manual', outcome: 'completed' })] })
    const stop = await launch(e)
    const a = mission()
    const b = mission()
    const c = mission()
    e.append(L.accept(a, 'Bounty Hunt'), L.accept(b, 'Patrol'))
    await sleep(2000)
    e.append(L.end(a, 'Complete'))
    await sleep(2000)
    e.append(L.accept(c, 'Package Recovery'))
    await sleep(2500)
    await stop()
    const refs = allJobs(e.jobs()).map((j) => j.ref)
    const dupes = refs.filter((r, i) => refs.indexOf(r) !== i)
    return [
      ['five jobs in all', refs.length === 5, `refs=${refs.join(',')}`],
      ['no repeated ref', dupes.length === 0, `dupes=${dupes.join(',')}`]
    ]
  },

  // #10 place names keep their full stops
  'dotted-place-name': async () => {
    const e = setup('dotted-place-name')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to NB Int. Spaceport'))
    await sleep(3000)
    await stop()
    const step = e.jobs()?.jobs?.[0]?.steps?.[0]
    const where = step?.location ?? step?.locationRaw ?? ''
    return [['step location is the full name', /NB Int\.? Spaceport/i.test(where), `location=${JSON.stringify(where)}`]]
  },

  // #11 Neutralize is not a turn-in
  'neutralize-not-turnin': async () => {
    const e = setup('neutralize-not-turnin')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Neutralize Vanduul Scout'))
    await sleep(3000)
    await stop()
    const step = e.jobs()?.jobs?.[0]?.steps?.[0]
    return [
      ['neutralize step exists', !!step, `steps=${e.jobs()?.jobs?.[0]?.steps?.length}`],
      ['neutralize step is not a turn-in', step && step.kind !== 'turnin', `kind=${step?.kind} label=${JSON.stringify(step?.label)}`]
    ]
  },

  // EXPORT DIAGNOSTICS from the command line: every section, names and ids scrubbed, decisions traced
  'diag-export': async () => {
    const e = setup('diag-export')
    const out = path.join(e.data, 'diag-export.txt')
    const stop = await launch(e, ['--export-diagnostics', out])
    const id = mission()
    const other = mission()
    const REAL = 'Zorblax9000'
    const OWNER = '987654321098'
    e.append(
      L.shared(OWNER, id),
      L.accept(id, 'Bounty Hunt'),
      L.objective(id, 'Go to Port Tressler'),
      L.notice('Mission Bonus Unlocked: Extra Credit', id),
      L.objective(id, 'Calibrate the scanner'),
      L.endAs(other, 'Abandon', REAL, '1')
    )
    const text = await waitForFile(out)
    await stop()
    const doc = e.jobs()
    const job = findJob(doc, id)
    const sec = diagSections(text)
    const missing = DIAG_SECTIONS.filter((h) => !(h in sec))
    const unknown = sec['UNKNOWN LINES'] ?? ''
    const decisions = sec['DECISIONS'] ?? ''
    const snap = sec['SNAPSHOT'] ?? ''
    return [
      ['diagnostics file written within 20 s', text != null, `file=${out}`],
      ['every section header present', text != null && missing.length === 0, `missing=${missing.join(',')}`],
      ['real player name absent', text != null && !text.includes(REAL), `hits=${count(text ?? '', new RegExp(REAL, 'g'))}`],
      ['12-digit owner id absent', text != null && !text.includes(OWNER), `hits=${count(text ?? '', new RegExp(OWNER, 'g'))}`],
      ['PLAYER placeholder present', /PLAYER/.test(text ?? ''), `hits=${count(text ?? '', /PLAYER/g)}`],
      ['OWNER- placeholder present', /OWNER-\d+/.test(text ?? ''), `hits=${count(text ?? '', /OWNER-\d+/g)}`],
      ['UNKNOWN LINES lists Mission Bonus Unlocked', /Mission Bonus Unlocked/.test(unknown), `unknown=${JSON.stringify(unknown.slice(0, 200))}`],
      ['DECISIONS has a job-created record', /job created|created/i.test(decisions), `decisions=${JSON.stringify(decisions.slice(0, 200))}`],
      ['DECISIONS has a step record', /step/i.test(decisions), `steps=${count(decisions, /step/gi)}`],
      ['SNAPSHOT has the job ref', !!job?.ref && snap.includes(job.ref), `ref=${job?.ref}`],
      ['SNAPSHOT has a distance table key', /distance/i.test(snap), `snapshot=${JSON.stringify(snap.slice(0, 200))}`]
    ]
  },

  // traceInterpretation off: nothing goes to logs/trace.jsonl
  'trace-off': async () => {
    const e = setup('trace-off', { traceInterpretation: false })
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'), L.notice('Mission Bonus Unlocked: Extra Credit', id))
    await sleep(3000)
    await stop()
    let size = 0
    try {
      size = fs.statSync(path.join(e.data, 'logs', 'trace.jsonl')).size
    } catch {
      // not written: what we want
    }
    return [
      ['events were handled (job made)', !!findJob(e.jobs(), id), `jobs=${e.jobs()?.jobs?.length ?? 0}`],
      ['no trace written', size === 0, `trace.jsonl bytes=${size}`]
    ]
  },

  // no start location set: the inventory request line becomes `where` (source inventory) and the start in AUTO
  'auto-start': async () => {
    const e = setup('auto-start')
    const out = path.join(e.data, 'diag-auto-start.txt')
    const stop = await launch(e, [`--export-diagnostics=${out}`])
    const id = mission()
    e.append(L.arrive('1510935576'), L.inventory('RR_CRU_L1'), L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
    const text = await waitForFile(out)
    await stop()
    const want = 'CRU-L1 Ambitious Dream Station'
    const snap = diagSections(text)['SNAPSHOT'] ?? ''
    const doc = e.jobs()
    return [
      ['diagnostics file written within 20 s', text != null, `file=${out}`],
      ['SNAPSHOT shows CRU-L1 as where you are', snap.includes(want), `snapshot=${JSON.stringify(snap.slice(0, 300))} saved where=${JSON.stringify(doc?.where)}`],
      ['saved where is CRU-L1 from the inventory line', doc?.where?.name === want && doc?.where?.source === 'inventory', `where=${JSON.stringify(doc?.where)}`]
    ]
  },

  // places only in the starmap (not in UEX: aid shelters) are matched and get a distance
  'starmap-places-distance': async () => {
    const id = mission()
    const step = (label, location) => ({ id: `s-${location}`, kind: 'go', label, location, have: 0, need: 1, done: false })
    // one job per place: the distance table lists each job's next open stop
    const a = logJob(id, { steps: [step('Go to Dunlow Ridge Aid Shelter on Daymar', 'Dunlow Ridge Aid Shelter on Daymar')] })
    const b = logJob(mission(), { ref: 'J02', steps: [step('Go to Julep Ravine Aid Shelter on Cellin', 'Julep Ravine Aid Shelter on Cellin')] })
    b.id = b.missionId
    const e = setup('starmap-places-distance', {}, { jobs: [a, b], history: [], startLocation: 'Seraphim Station', listOrder: 'distance' })
    const out = path.join(e.data, 'diag-starmap.txt')
    const stop = await launch(e, [`--export-diagnostics=${out}`])
    const text = await waitForFile(out)
    await stop()
    const snap = diagSections(text)['SNAPSHOT'] ?? ''
    let rows = []
    try {
      rows = JSON.parse(snap.slice(snap.indexOf('{'), snap.lastIndexOf('}') + 1))?.other?.distanceTable?.distance ?? []
    } catch {
      // checked below
    }
    const shelter = (n) => rows.find((r) => String(r.place).startsWith(n))
    return [
      ['diagnostics file written', text != null, `file=${out}`],
      ['Dunlow Ridge Aid Shelter has a distance', shelter('Dunlow Ridge')?.distance > 0, JSON.stringify(shelter('Dunlow Ridge') ?? null).slice(0, 200)],
      ['Julep Ravine Aid Shelter has a distance', shelter('Julep Ravine')?.distance > 0, JSON.stringify(shelter('Julep Ravine') ?? null).slice(0, 200)]
    ]
  },

  // the inventory line's place and time are saved in the doc (`where`) and survive a restart
  'location-persisted': async () => {
    const e = setup('location-persisted')
    let stop = await launch(e)
    const at = Date.now()
    e.append(L.arrive('1510935576', 'PLAYER', at), L.inventory('RR_CRU_L1', 'PLAYER', at), L.accept(mission(), 'Bounty Hunt'))
    await sleep(3000)
    await stop()
    const want = 'CRU-L1 Ambitious Dream Station'
    const first = e.jobs()
    const savedAt = Date.parse(first?.where?.at ?? '')
    stop = await launch(e)
    e.append(L.accept(mission(), 'Patrol')) // forces a save after the reload
    await sleep(3000)
    await stop()
    const again = e.jobs()
    return [
      ['where.name saved', first?.where?.name === want, `where=${JSON.stringify(first?.where)}`],
      ['where.at is the line time', Number.isFinite(savedAt) && Math.abs(savedAt - at) < 120000, `where.at=${first?.where?.at}`],
      ['old currentLocation fields gone', !('currentLocation' in (first ?? {})) && !('currentLocationAt' in (first ?? {})), `keys=${Object.keys(first ?? {}).join(',')}`],
      ['where.name kept after a restart', again?.where?.name === want, `where=${JSON.stringify(again?.where)}`],
      ['where.at kept after a restart', again?.where?.at === first?.where?.at, `before=${first?.where?.at} after=${again?.where?.at}`]
    ]
  },

  // B3: inventory clue sets where (source inventory, log time); leaving clears it; a repeat arrival
  // resolves from the learned hash
  'where-inventory': async () => {
    const e = setup('where-inventory')
    const stop = await launch(e)
    const at = ago(5)
    const want = 'CRU-L1 Ambitious Dream Station'
    e.append(L.arrive('1510935576', 'PLAYER', at), L.inventory('RR_CRU_L1', 'PLAYER', at))
    const arrived = await until(() => (e.jobs()?.where?.name ? e.jobs().where : null))
    // leave: landing 0, location moves to another hash
    e.append(`${stamp()} [Notice] <Update Inventory Location> Player [PLAYER] is changing location. Landing [1510935576] -> [0]. Location [1510935576] -> [2000000001]. Pending [0] [Team_CoreGameplayFeatures][Inventory]`)
    const left = await until(() => e.jobs()?.where === null || e.jobs()?.where === undefined, 6000)
    const afterLeave = e.jobs()?.where
    e.append(L.arrive('1510935576'))
    const back = await until(() => (e.jobs()?.where?.name === want ? e.jobs().where : null))
    await stop()
    const doc = e.jobs()
    return [
      ['where.name is the station', arrived?.name === want, `where=${JSON.stringify(arrived)}`],
      ['where.source is inventory', arrived?.source === 'inventory', `source=${arrived?.source}`],
      ['where.at is the log time', Math.abs(Date.parse(arrived?.at ?? '') - at) < 2000, `at=${arrived?.at} want=${iso(at)}`],
      ['leaving clears the inventory where', !!left, `where=${JSON.stringify(afterLeave)}`],
      ['repeat arrival resolves from the hash', back?.name === want && back?.source === 'inventory', `where=${JSON.stringify(back)}`],
      ['saved after the repeat arrival', doc?.where?.name === want, `where=${JSON.stringify(doc?.where)}`]
    ]
  },

  // B2: Objective Complete ticks a step -> where = that step's place, source objective, log time
  'where-objective': async () => {
    const e = setup('where-objective')
    const stop = await launch(e)
    const id = mission()
    e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'), L.objective(id, 'Neutralize Vanduul Scout'))
    await until(() => findJob(e.jobs(), id)?.steps?.length === 2)
    const at = Date.now()
    e.append(L.objectiveComplete(id, 'Go to Port Tressler', at))
    const w = await until(() => (e.jobs()?.where?.source ? e.jobs().where : null))
    await stop()
    return [
      ['where.source is objective', w?.source === 'objective', `where=${JSON.stringify(w)}`],
      ['where.name is the step place', /Port Tressler/.test(w?.name ?? ''), `name=${w?.name}`],
      ['where.at is the log time', Math.abs(Date.parse(w?.at ?? '') - at) < 2000, `at=${w?.at} want=${iso(at)}`]
    ]
  },

  // C: WHERE AM I through the test seam (SC_WHERE_TEXT_FILE instead of capture + OCR), run from the main window
  'where-am-i': async () => {
    const e = setup('where-am-i')
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: DISPLAY_INFO_HURSTON, zone1: 'STANTON > HURSTON > 0.00° 0.00° 12.85GM' }))
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port), { SC_WHERE_TEXT_FILE: textFile })
    let r1
    let r2
    let err = ''
    let w1
    let w2
    e.append(L.accept(mission(), 'Bounty Hunt', ago(20)))
    const mark = await until(() => e.jobs()?.lastLogEventAt)
    try {
      r1 = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w1 = await until(() => (e.jobs()?.where?.source === 'displayinfo' ? e.jobs().where : null))
      // second run: zone 2 empty -> zone 1 (map line in open space)
      fs.writeFileSync(textFile, JSON.stringify({ zone2: '', zone1: 'STANTON SYSTEM > 0.00° 1.06° 12.47GM' }))
      r2 = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w2 = await until(() => (e.jobs()?.where?.source === 'map' ? e.jobs().where : null))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const after = e.jobs()?.lastLogEventAt
    return [
      ['run 1 ok from zone 2', r1?.ok === true && r1?.zone === 2, `result=${JSON.stringify(r1)?.slice(0, 300)} ${err}`],
      ['where.source displayinfo', w1?.source === 'displayinfo', `where=${JSON.stringify(w1)}`],
      ['where.name HDRSO-Stott', w1?.name === 'HDRSO-Stott', `name=${w1?.name}`],
      ['label shows 22.8 km', /22\.8 km/.test(w1?.label ?? ''), `label=${w1?.label}`],
      ['where has a point on Hurston', !!w1?.point && /hurston/i.test(w1?.body ?? ''), `body=${w1?.body} point=${JSON.stringify(w1?.point)}`],
      ['run 2 ok from zone 1', r2?.ok === true && r2?.zone === 1, `result=${JSON.stringify(r2)?.slice(0, 300)} ${err}`],
      ['where.source map', w2?.source === 'map', `where=${JSON.stringify(w2)}`],
      ['open space: where.name null', w2 != null && w2.name === null, `name=${w2?.name}`],
      ['map where has a point', !!w2?.point, `point=${JSON.stringify(w2?.point)}`],
      ['WHERE AM I does not move the log watermark', !!mark && after === mark, `before=${mark} after=${after}`]
    ]
  },

  // A: STARTING AT modes. Typed start 10 min old, then a newer inventory clue:
  // AUTO measures from the clue, FIXED keeps the typed start
  'start-mode-auto-fixed': async () => {
    const want = 'CRU-L1 Ambitious Dream Station'
    const typed = 'Seraphim Station'
    const run = async (mode) => {
      const step = { id: 's1', kind: 'go', label: 'Go to Port Tressler', location: 'Port Tressler', have: 0, need: 1, done: false }
      const e = setup(`start-mode-${mode}`, { otherStartMode: mode }, { jobs: [logJob(mission(), { steps: [step] })], history: [], startLocation: typed, startTypedAt: iso(ago(600)), listOrder: 'distance' })
      const out = path.join(e.data, `diag-${mode}.txt`)
      const port = await freePort()
      const stop = await launch(e, [`--export-diagnostics=${out}`, ...cdpArgs(port)])
      e.append(L.arrive('1510935576'), L.inventory('RR_CRU_L1'))
      const text = await waitForFile(out)
      let overlay = ''
      // AUTO waits for the clue to reach the overlay too: the card can show Port Tressler from the typed start first
      const shown = (t) => /Port Tressler/.test(t) && (mode !== 'auto' || t.includes(want) || /CRU-L1/.test(t))
      try {
        overlay = (await until(() => windowText(port, 'overlay').then((t) => (shown(t) ? t : '')), 15000)) || (await windowText(port, 'overlay'))
      } catch {
        // checked below
      }
      await stop()
      const snap = snapshotJson(text)
      const row = (snap?.other?.distanceTable?.distance ?? []).find((r) => /Port Tressler/.test(String(r.place)))
      const used = snap?.other?.start?.used ?? snap?.other?.origin?.name ?? null
      return { doc: e.jobs(), snap, row, used, overlay }
    }
    const [auto, fixed] = await Promise.all([run('auto'), run('fixed')])
    const fromClue = rosterDist(want, 'Port Tressler')
    const fromTyped = rosterDist(typed, 'Port Tressler')
    const near = (d, x) => d != null && x != null && Math.abs(d - x) / x < 0.01
    return [
      ['setting otherStartMode in SNAPSHOT', auto.snap?.other?.settings?.otherStartMode === 'auto' && fixed.snap?.other?.settings?.otherStartMode === 'fixed', `auto=${auto.snap?.other?.settings?.otherStartMode} fixed=${fixed.snap?.other?.settings?.otherStartMode}`],
      ['the clue is saved (both modes)', auto.doc?.where?.name === want && fixed.doc?.where?.name === want, `auto=${auto.doc?.where?.name} fixed=${fixed.doc?.where?.name}`],
      ['typed start kept in the doc', auto.doc?.startLocation === typed && fixed.doc?.startLocation === typed, `auto=${auto.doc?.startLocation} fixed=${fixed.doc?.startLocation}`],
      ['AUTO: origin is the newer clue', auto.used ? auto.used === want : near(auto.row?.distance, fromClue), `used=${auto.used} distance=${auto.row?.distance} fromClue=${fromClue} fromTyped=${fromTyped}`],
      ['AUTO: distance measured from the clue', near(auto.row?.distance, fromClue), `distance=${auto.row?.distance} want=${fromClue}`],
      ['FIXED: origin is the typed start', fixed.used ? fixed.used === typed : near(fixed.row?.distance, fromTyped), `used=${fixed.used}`],
      ['FIXED: distance measured from the typed start', near(fixed.row?.distance, fromTyped), `distance=${fixed.row?.distance} want=${fromTyped}`],
      ['AUTO overlay names the clue as the origin', auto.overlay.includes(want) || /CRU-L1/.test(auto.overlay), `overlay=${JSON.stringify(auto.overlay.slice(0, 300))}`]
    ]
  },

  // D: a stop in Pyro measured from Stanton goes through the gateway: "+ 1 jump" on the overlay and in the table
  'multi-system-jump': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to Ruin Station', location: 'Ruin Station', have: 0, need: 1, done: false }
    const e = setup('multi-system-jump', { otherStartMode: 'fixed' }, { jobs: [logJob(mission(), { steps: [step] })], history: [], startLocation: 'Seraphim Station', startTypedAt: iso(ago(60)), listOrder: 'distance' })
    const out = path.join(e.data, 'diag-jump.txt')
    const port = await freePort()
    const stop = await launch(e, [`--export-diagnostics=${out}`, ...cdpArgs(port)])
    const text = await waitForFile(out)
    let overlay = ''
    let err = ''
    try {
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/jump/.test(t) ? t : '')), 10000)) ?? ''
      if (!overlay) overlay = await windowText(port, 'overlay')
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const snap = snapshotJson(text)
    const row = (snap?.other?.distanceTable?.distance ?? []).find((r) => /Ruin Station/.test(String(r.place)))
    // gateway leg: Seraphim -> Pyro Gateway (Stanton) + Stanton Gateway (Pyro) -> Ruin Station
    const viaGate = (rosterDist('Seraphim Station', 'Pyro Gateway (Stanton)') ?? 0) + (rosterDist('Stanton Gateway (Pyro)', 'Ruin Station') ?? 0)
    return [
      ['overlay shows "+ 1 jump"', /\+\s*1 jump/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))} ${err}`],
      ['distance goes through the gateways', row?.distance > 0 && Math.abs(row.distance - viaGate) / viaGate < 0.02, `distance=${row?.distance} viaGate=${Math.round(viaGate)}`]
    ]
  },

  // C1/C2/C3/N1: the user's real OCR text near Hurston ("00C Stanton 1 Hurston", "Stantonl" before the fix)
  // reads as on Hurston, system Stanton, accuracy 10; the overlay start line shows "ACC 10"
  'where-real-near-hurston': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to Lorville', location: 'Lorville', have: 0, need: 1, done: false }
    const e = setup('where-real-near-hurston', {}, { jobs: [logJob(mission(), { steps: [step] })], history: [] })
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_NEAR_HURSTON, zone1: '' }))
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port), { SC_WHERE_TEXT_FILE: textFile })
    let r
    let w
    let overlay = ''
    let err = ''
    try {
      r = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w = await until(() => (e.jobs()?.where?.source === 'displayinfo' ? e.jobs().where : null))
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/ACC\s*10/.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const cas = ROSTER.find((l) => l.name === 'HDPC-Cassillo')
    const p = w?.point
    const toCas = p && cas ? Math.hypot(p.x - cas.x, p.y - cas.y, p.z - cas.z) : null
    return [
      ['run ok from zone 2', r?.ok === true && r?.zone === 2, `result=${JSON.stringify(r)?.slice(0, 300)} ${err}`],
      ['where.body Hurston', /^hurston$/i.test(w?.body ?? ''), `where=${JSON.stringify(w)}`],
      ['where.system Stanton', /^stanton$/i.test(w?.system ?? ''), `system=${w?.system}`],
      ['accuracy 10', w?.accuracy === 10 && r?.where?.accuracy === 10, `doc=${w?.accuracy} result=${r?.where?.accuracy}`],
      ['label names Hurston', /Hurston/.test(w?.label ?? ''), `label=${w?.label}`],
      ['point ~422 km from HDPC-Cassillo', toCas != null && Math.abs(toCas - 422000) < 15000, `distance=${toCas == null ? null : Math.round(toCas)}`],
      ['overlay shows ACC 10', /ACC\s*10/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))} ${err}`]
    ]
  },

  // C3/C7/N1: the real top-3-lines read in space (no system named, "~~" junk, "Km") -> ok, accuracy 9, system null
  'where-real-space': async () => {
    const e = setup('where-real-space')
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_SPACE_TOP3, zone1: '' }))
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port), { SC_WHERE_TEXT_FILE: textFile })
    let r
    let w
    let err = ''
    try {
      r = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w = await until(() => (e.jobs()?.where?.source === 'displayinfo' ? e.jobs().where : null))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [
      ['run ok from zone 2', r?.ok === true && r?.zone === 2, `result=${JSON.stringify(r)?.slice(0, 300)} ${err}`],
      ['accuracy 9', r?.where?.accuracy === 9, `accuracy=${r?.where?.accuracy}`],
      ['saved with a star-frame point', !!w?.point && Math.abs(w.point.x - 12472406290) < 5e6, `where=${JSON.stringify(w)}`]
    ]
  },

  // WHERE AM I at a station: the user's real panel in Seraphim Station's hangar names the start "Seraphim Station
  // (hangar)" (placeKind 'station') in the overlay FROM row and on the Next tab, never "Open space"; the stop's distance
  // still comes from the panel's SolarSystem position (not the roster's station point); a later true open-space read
  // still shows "Open space".
  'where-station-hangar': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to Lorville', location: 'Lorville', have: 0, need: 1, done: false }
    const e = setup('where-station-hangar', { otherStartMode: 'auto' }, { jobs: [logJob(mission(), { steps: [step] })], history: [], listOrder: 'distance' })
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_SERAPHIM_HANGAR, zone1: '' }))
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], { SC_WHERE_TEXT_FILE: textFile })
    const fromRowText = () => cdpEval(port, 'overlay', `document.querySelector('[data-testid="overlay-from-row"]')?.innerText ?? ''`)
    let w
    let from = ''
    let next = ''
    let snap = null
    let w2
    let from2 = ''
    let err = ''
    try {
      await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w = await until(() => (e.jobs()?.where?.source === 'displayinfo' ? e.jobs().where : null))
      from = (await until(() => fromRowText().then((t) => (/seraphim/i.test(t ?? '') ? t : '')), 8000)) || (await fromRowText())
      next = await nextText(port, /Seraphim Station \(hangar\)/, 8000)
      snap = snapshotJson(await exportNow(e, port, iport, 'where-station-hangar'))
      // a true open-space read afterwards still says "Open space"
      const prev = w?.at
      fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_SPACE_TOP3, zone1: '' }))
      await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w2 = await until(() => (e.jobs()?.where && e.jobs().where.at !== prev ? e.jobs().where : null), 8000)
      from2 = (await until(() => fromRowText().then((t) => (/open space/i.test(t ?? '') ? t : '')), 8000)) || (await fromRowText())
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const lor = ROSTER.find((l) => l.name === 'Lorville')
    // the panel's SolarSystem line, in metres
    const panel = { x: -18960653616.8, y: -2659120633.7, z: 5566059.5 }
    const want = lor ? Math.hypot(panel.x - lor.x, panel.y - lor.y, panel.z - lor.z) : null
    const fromStation = rosterDist('Seraphim Station', 'Lorville')
    const row = (snap?.other?.distanceTable?.distance ?? []).find((r) => /Lorville/.test(String(r.place)))
    const nextStart = lineWith(next, /Seraphim|Open space/i)
    return [
      ['where.name Seraphim Station, placeKind station', w?.name === 'Seraphim Station' && w?.placeKind === 'station', `where=${JSON.stringify(w)?.slice(0, 400)} ${err}`],
      ['where.label "Seraphim Station (hangar)"', /^Seraphim Station \(hangar\)/.test(w?.label ?? ''), `label=${w?.label}`],
      ['point is still the panel position', !!w?.point && Math.abs(w.point.x - panel.x) < 5e3 && Math.abs(w.point.y - panel.y) < 5e3, `point=${JSON.stringify(w?.point)}`],
      ['overlay FROM row: "Seraphim Station (hangar)", not Open space', /Seraphim Station \(hangar\)/.test(from) && !/open space/i.test(from), `from=${JSON.stringify(from)} ${err}`],
      ['Next tab start: "Seraphim Station (hangar)", not Open space', /Seraphim Station \(hangar\)/.test(next) && !/open space/i.test(next), `next=${JSON.stringify(nextStart.slice(0, 300))}`],
      ['Lorville distance from the panel position (not the station point)', row?.distance > 0 && want != null && Math.abs(row.distance - want) < 50000 && Math.abs(row.distance - fromStation) > 1e6, `row=${row?.distance} want=${Math.round(want)} fromStationPoint=${Math.round(fromStation)}`],
      ['second read in open space: label Open space, no placeKind station', /open space/i.test(w2?.label ?? '') && w2?.placeKind !== 'station', `where2=${JSON.stringify(w2)?.slice(0, 300)}`],
      ['second read: FROM row shows Open space', /open space/i.test(from2) && !/hangar/i.test(from2), `from2=${JSON.stringify(from2)}`]
    ]
  },

  // C4: a saved where with system "Stantonl" (the real near-Hurston read before fix a) still measures to a
  // Stanton stop: a distance, no "No jump route", 0 jumps
  'where-system-stantonl': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to HUR-L1 Green Glade Station', location: 'HUR-L1 Green Glade Station', have: 0, need: 1, done: false }
    const cas = ROSTER.find((l) => l.name === 'HDPC-Cassillo')
    const where = { name: null, label: 'Open space · near Hurston', point: { x: cas.x, y: cas.y, z: cas.z, system: 'Stantonl', body: 'Hurston' }, system: 'Stantonl', body: 'Hurston', source: 'displayinfo', at: iso(ago(10)), accuracy: 10 }
    const e = setup('where-system-stantonl', { otherStartMode: 'auto' }, { jobs: [logJob(mission(), { steps: [step] })], history: [], where, listOrder: 'distance' })
    const out = path.join(e.data, 'diag-stantonl.txt')
    const port = await freePort()
    const stop = await launch(e, [`--export-diagnostics=${out}`, ...cdpArgs(port)])
    const text = await waitForFile(out)
    let overlay = ''
    let err = ''
    try {
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/Green Glade/.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const row = (snapshotJson(text)?.other?.distanceTable?.distance ?? []).find((r) => /Green Glade/.test(String(r.place)))
    const want = rosterDist('HDPC-Cassillo', 'HUR-L1 Green Glade Station')
    return [
      ['overlay has no "No jump route"', overlay.length > 0 && !/No jump route/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))} ${err}`],
      ['overlay shows a distance', /\d\s*(Gm|Mm|km)/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))}`],
      ['table distance is the straight line, 0 jumps', row?.distance > 0 && Math.abs(row.distance - want) / want < 0.02 && !row?.jumps, `row=${JSON.stringify(row)} want=${Math.round(want)}`]
    ]
  },

  // C5: an OCR'd step place "S1DCO6" (letter O) matches Covalex S1DC06 and gets a distance
  'place-ocr-o-zero': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to Covalex', location: 'Covalex Distribution Center S1DCO6 on Hurston', have: 0, need: 1, done: false }
    const e = setup('place-ocr-o-zero', { otherStartMode: 'fixed' }, { jobs: [logJob(mission(), { steps: [step] })], history: [], startLocation: 'Lorville', startTypedAt: iso(ago(60)), listOrder: 'distance' })
    const out = path.join(e.data, 'diag-o-zero.txt')
    const port = await freePort()
    const stop = await launch(e, [`--export-diagnostics=${out}`, ...cdpArgs(port)])
    const text = await waitForFile(out)
    let overlay = ''
    let err = ''
    try {
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/S1DC/.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const row = (snapshotJson(text)?.other?.distanceTable?.distance ?? []).find((r) => /S1DC/i.test(String(r.place)))
    return [
      ['overlay has no "Not found in UEX"', overlay.length > 0 && !/Not found in UEX/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))} ${err}`],
      ['table row has a distance', row?.distance > 0, `row=${JSON.stringify(row)}`]
    ]
  },

  // O2: the panel's "Tracked mission" id (OCR garbled O for 0) marks the matching active job; overlay shows TRACKED
  'where-tracked-mission': async () => {
    const id = '6844f110-b18a-49ef-ae09-b9617767c5cd'
    const other = mission()
    const step = (s) => ({ id: 's1', kind: 'go', label: `Go to ${s}`, location: s, have: 0, need: 1, done: false })
    const e = setup('where-tracked-mission', {}, { jobs: [logJob(other, { ref: 'J01', steps: [step('Lorville')] }), logJob(id, { id, ref: 'J02', title: 'Courier', steps: [step('HDPC-Cassillo')] })], history: [] })
    const textFile = path.join(e.home, 'where-text.json')
    const panel = `${OCR_NEAR_HURSTON}\nTracked mission : FTL_Courier_Stanton_Chlorine_Rank1_0 [6844f11O-b18a-49ef-ae09-b9617767c5cd]`
    fs.writeFileSync(textFile, JSON.stringify({ zone2: panel, zone1: '' }))
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port), { SC_WHERE_TEXT_FILE: textFile })
    let r
    let tracked
    let overlay = ''
    let err = ''
    try {
      r = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      tracked = await until(() => e.jobs()?.trackedMissionId)
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/TRACKED/.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [
      ['run ok', r?.ok === true, `result=${JSON.stringify(r)?.slice(0, 300)} ${err}`],
      ['doc trackedMissionId is the job', tracked === id, `trackedMissionId=${tracked}`],
      ['overlay shows TRACKED', /TRACKED/.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))}`]
    ]
  },

  // O3: live position on -> main re-reads zone 2 by itself (no button / hotkey) and the doc's where updates
  'where-live': async () => {
    const e = setup('where-live', { otherWhereLive: true, otherWhereLiveSec: 30 })
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: DISPLAY_INFO_HURSTON, zone1: '' }))
    // no test override for the interval: the first live read comes at the 30 s minimum
    const stop = await launch(e, [], { SC_WHERE_TEXT_FILE: textFile })
    const w = await until(() => (e.jobs()?.where?.source === 'displayinfo' ? e.jobs().where : null), 45000)
    await stop()
    const lines = count(e.log(), /where: run done.*\blive\b/g)
    return [
      ['where updated with no manual run', w?.source === 'displayinfo' && w?.name === 'HDRSO-Stott', `where=${JSON.stringify(w)}`],
      ['the read was a live one', lines >= 1, `live run lines=${lines}`]
    ]
  },

  // AFK button, dry run (SC_AFK_DRYRUN: no focus, no keys sent): first press F2 (map), then F1; stop turns it off
  'afk-dry-run': async () => {
    const e = setup('afk-dry-run', { otherAfkFirstKey: 'F2', otherAfkCycleKey: 'F1' })
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port), { SC_AFK_DRYRUN: '1', SC_AFK_INTERVAL_MS: '500' })
    let started
    let mid
    let stopped
    let after
    let err = ''
    try {
      started = await cdpEval(port, 'main', 'window.supercargo.otherAfkStart()')
      // lastKeys keeps the newest 5: read as soon as 2 presses are in, so the first F2 is still there
      mid = await until(() => cdpEval(port, 'main', 'window.supercargo.otherAfkGet()').then((s) => (s?.presses >= 2 ? s : null)), 2500)
      stopped = await cdpEval(port, 'main', 'window.supercargo.otherAfkStop()')
      await sleep(1200)
      after = await cdpEval(port, 'main', 'window.supercargo.otherAfkGet()')
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const keys = mid?.lastKeys ?? []
    return [
      ['start turns it on (dry run)', started?.on === true && started?.dryRun === true, `start=${JSON.stringify(started)} ${err}`],
      ['at least 2 presses in ~2 s', (mid?.presses ?? 0) >= 2, `state=${JSON.stringify(mid)}`],
      ['first key F2, then F1', keys[0] === 'F2' && keys[1] === 'F1', `lastKeys=${JSON.stringify(keys)}`],
      ['stop turns it off', stopped?.on === false && after?.on === false, `stop=${JSON.stringify(stopped)} after=${JSON.stringify(after)}`],
      ['no presses after stop', typeof after?.presses === 'number' && after.presses === stopped?.presses, `stopped=${stopped?.presses} after=${after?.presses}`]
    ]
  },

  // C8: the hotkey check IPC rejects a key that is not an Electron accelerator
  'hotkey-check-invalid': async () => {
    const e = setup('hotkey-check-invalid')
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port))
    let r
    let err = ''
    try {
      r = await cdpEval(port, 'main', "window.supercargo.otherHotkeyCheck('NotAKey')")
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [['otherHotkeyCheck("NotAKey") -> ok false', r?.ok === false, `result=${JSON.stringify(r)} ${err}`]]
  },

  // the main window loads the Other doc and runs the start-up scan once (not once per subscribe / window)
  'init-once': async () => {
    const id = mission()
    const e = setup('init-once', {}, { jobs: [], history: [], lastLogEventAt: iso(ago(60)) })
    e.append(L.logStarted(ago(120)), L.accept(id, 'Bounty Hunt', ago(30)))
    const stop = await launch(e)
    await sleep(2000)
    await stop()
    const log = e.log()
    const inits = count(log, /\bother\s+\[main\] init loaded/g)
    const scans = count(log, /\[main\] startup scan result/g)
    return [
      ['one Other "init loaded" in the main window', inits === 1, `lines=${inits}`],
      ['one start-up scan result', scans === 1, `lines=${scans}`],
      ['the scan applied the accept', findJob(e.jobs(), id)?.status === 'active', `status=${findJob(e.jobs(), id)?.status}`]
    ]
  },

  // Batch 3 diagnostics (items 1-5, 7-13): Export diagnostics from the main window (as the button does) with a
  // note, after two WHERE AM I reads and a dry-run AFK; every new section is in the file, cleaned, no pictures
  'diag-sections-new': async () => {
    const r = await diagExportRun('diag-sections-new', { note: 'test note PLAYER-free', includeImages: false })
    const { text, res, sec, err } = r
    const first = /^##\s+(.+?)\s*$/m.exec(text ?? '')?.[1]
    const overlay = sectionJson(sec['OVERLAY'])
    const placeN = findKey(overlay, /place.*(size|count)|^places$|placeList/i)
    const placeSize = typeof placeN === 'number' ? placeN : Array.isArray(placeN) ? placeN.length : Number(findKey(placeN, /size|count|n$/i))
    const hist = sectionJson(sec['WHERE AM I HISTORY'])
    const reads = Array.isArray(hist) ? hist : findKey(hist, /history|reads|entries/i)
    const afk = sectionJson(sec['AFK LOG'])
    const presses = findKey(afk, /^presses$/i)
    const hot = sec['HOTKEYS'] ?? ''
    const health = sec['GAME LOG HEALTH'] ?? ''
    const snap = snapshotJson(text)
    const locHist = findKey(snap, /^locationHistory$/i)
    const lookup = findKey(snap, /lookup/i)
    const travel = findKey(snap, /travel/i)
    const places = findKey(snap, /^places/i)
    const dir = res?.path ? path.dirname(res.path) : r.e.data
    const pngs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')) : []
    return [
      ['export written through the button path', res?.ok === true && text != null, `result=${JSON.stringify(res)} ${err}`],
      ['## NOTE is the first section, with the note', first === 'NOTE' && (sec['NOTE'] ?? '').includes('test note PLAYER-free'), `first=${first} note=${JSON.stringify((sec['NOTE'] ?? '').slice(0, 100))}`],
      ['## OVERLAY has a place-list size > 0', placeSize > 0, `size=${JSON.stringify(placeN)} overlay=${JSON.stringify((sec['OVERLAY'] ?? '(missing)').slice(0, 300))}`],
      ['## OVERLAY has the start label', (sec['OVERLAY'] ?? '').includes('Seraphim Station'), `overlay=${JSON.stringify((sec['OVERLAY'] ?? '(missing)').slice(0, 300))}`],
      ['## WHERE AM I HISTORY has the 2 reads', Array.isArray(reads) && reads.length === 2, `reads=${Array.isArray(reads) ? reads.length : JSON.stringify(sec['WHERE AM I HISTORY'] ?? '(missing)').slice(0, 300)}`],
      ['each read has timings', Array.isArray(reads) && reads.length > 0 && reads.every((x) => findKey(x, /^timings$|^ms$/i) !== undefined), `read=${JSON.stringify(reads?.[0])?.slice(0, 300)}`],
      ['## CAPTURE present and says there was no capture (test seam)', 'CAPTURE' in sec && /\bno\b|none|null|not|seam|text file/i.test(sec['CAPTURE']), `capture=${JSON.stringify((sec['CAPTURE'] ?? '(missing)').slice(0, 300))}`],
      ['## AFK LOG has >= 2 presses', Array.isArray(presses) && presses.length >= 2, `presses=${Array.isArray(presses) ? presses.length : JSON.stringify(sec['AFK LOG'] ?? '(missing)').slice(0, 300)}`],
      ['## HOTKEYS lists both hotkeys', /ocrHotkey/.test(hot) && /otherWhereHotkey/.test(hot), `hotkeys=${JSON.stringify(hot.slice(0, 300) || '(missing)')}`],
      ['## LIVE present', 'LIVE' in sec, `sections=${Object.keys(sec).join(',')}`],
      ['## GAME LOG HEALTH has the log path and a lag figure', health.includes('Game.log') && /lag[^\n]*\d/i.test(health), `health=${JSON.stringify(health.slice(0, 400) || '(missing)')}`],
      ['SNAPSHOT has locationHistory', Array.isArray(locHist) && locHist.length > 0, `locationHistory=${JSON.stringify(locHist)?.slice(0, 200)}`],
      ['SNAPSHOT has a per-row place lookup', !!lookup && /"(method|status)"/.test(JSON.stringify(lookup)), `lookup=${JSON.stringify(lookup)?.slice(0, 200)}`],
      ['SNAPSHOT has a per-row travel detail', !!travel && /sameSystem/.test(JSON.stringify(travel)), `travel=${JSON.stringify(travel)?.slice(0, 200)}`],
      ['SNAPSHOT has a places summary', !!places && typeof places === 'object', `places=${JSON.stringify(places)?.slice(0, 200)}`],
      ['no pictures without the tick box', !(res?.images?.length) && pngs.length === 0, `images=${JSON.stringify(res?.images)} pngs=${pngs.join(',')}`],
      ['real player name absent', text != null && !text.includes(DIAG_REAL), `hits=${count(text ?? '', new RegExp(DIAG_REAL, 'g'))}`],
      ['PLAYER placeholder present', /PLAYER/.test(text ?? ''), `hits=${count(text ?? '', /PLAYER/g)}`]
    ]
  },

  // items 6/14: the "Include images" tick box saves the overlay picture next to the export and lists it
  // (no zone crops in the test seam: WHERE AM I reads a text file, nothing is captured); the note is cleaned too
  'diag-images': async () => {
    const r = await diagExportRun('diag-images', { note: `went wrong for ${DIAG_REAL}`, includeImages: true })
    const { text, res, sec, err } = r
    const imgs = res?.images ?? []
    const overlayPng = imgs.find((f) => /-overlay\.png$/.test(f))
    let size = 0
    try {
      size = fs.statSync(overlayPng).size
    } catch {
      // checked below
    }
    return [
      ['export written', res?.ok === true && text != null, `result=${JSON.stringify(res)} ${err}`],
      ['result lists <base>-overlay.png', !!overlayPng && path.basename(overlayPng) === path.basename(res.path).replace(/\.txt$/, '') + '-overlay.png', `images=${JSON.stringify(imgs)}`],
      ['overlay PNG saved (non-empty)', size > 0, `bytes=${size}`],
      ['the export lists the saved picture', !!overlayPng && (text ?? '').includes(path.basename(overlayPng)), `sections=${Object.keys(sec).join(',')}`],
      ['no zone crops in the test seam', !imgs.some((f) => /-zone[12]\.png$/.test(f)), `images=${JSON.stringify(imgs)}`],
      ['note cleaned (no player name)', /PLAYER/.test(sec['NOTE'] ?? '') && !(text ?? '').includes(DIAG_REAL), `note=${JSON.stringify((sec['NOTE'] ?? '(missing)').slice(0, 100))}`]
    ]
  },

  // CONTRACT4 F1/F2: J74 from its real lines, pickup done -> the delivery to "Security Compound" (no UEX place)
  // is placed from its body-frame marker (Hurston) and shows a distance "near HDPC-Cassillo", not "Not found in UEX"
  'j74-near-place': async () => {
    const r = await j74Run('j74-near-place', { collected: true, exportDiag: true })
    const rows = r.snap?.other?.distanceTable?.distance ?? []
    const row = rows.find((x) => /Security Compound/.test(String(x.place)))
    // the marker is in Hurston's body frame: point = Hurston centre + position (4 km from HDPC-Cassillo)
    const hur = ROSTER.find((l) => l.name === 'Hurston')
    const lor = ROSTER.find((l) => l.name === 'Lorville')
    const want = hur && lor ? Math.hypot(hur.x - 790556.763184 - lor.x, hur.y + 614240.106819 - lor.y, hur.z - 6055.992337 - lor.z) : null
    // straight line or over the surface (arc on a ~1000 km body), whichever the table uses
    const arc = want ? 1000000 * 2 * Math.asin(Math.min(1, want / 2000000)) : null
    const near = (d, w) => d > 0 && w > 0 && Math.abs(d - w) < Math.max(15000, w * 0.05)
    const ovl = lineWith(r.overlay, /Security Compound|near|km|Gm|Mm/i)
    return [
      // the overlay title is upper case on screen (CSS), so match either case
      ['overlay: "near HDPC-Cassillo"', /(near|at) HDPC-Cassillo/i.test(r.overlay), `overlay=${JSON.stringify(r.overlay.slice(0, 400))} ${r.err}`],
      ['overlay: no "Not found in UEX"', r.overlay.length > 0 && !/Not found in UEX/.test(r.overlay), `lines=${JSON.stringify(ovl)}`],
      ['overlay: a distance', /\d\s*(Gm|Mm|km)/.test(r.overlay.replace(/\(\d+(\.\d+)?\s*km\)/gi, '')), `lines=${JSON.stringify(ovl)}`],
      ['Next tab: "near HDPC-Cassillo"', /(near|at) HDPC-Cassillo/.test(r.next), `next=${JSON.stringify(lineWith(r.next, /Security Compound|near/).slice(0, 400))}`],
      ['Next tab: no "Not found in UEX"', r.next.length > 0 && !/Not found in UEX/.test(r.next), `next=${JSON.stringify(r.next.slice(0, 400))}`],
      ['table distance ~ Lorville -> Hurston centre + marker position', near(row?.distance, want) || near(row?.distance, arc), `row=${JSON.stringify(row)?.slice(0, 300)} want~${Math.round(want ?? 0)} (line) or ${Math.round(arc ?? 0)} (surface)`],
      ['zone 862321816216 calibrated on Hurston for build 12913470', !!r.doc?.markerZones?.['12913470']?.['862321816216'], `zones=${JSON.stringify(r.doc?.markerZones ?? null)?.slice(0, 300)}`]
    ]
  },

  // CONTRACT4 F4: J74's game order is deliver, then collect; the first open stop is the Farnesway pickup
  'j74-pickup-first': async () => {
    const r = await j74Run('j74-pickup-first')
    const steps = r.doc?.jobs?.[0]?.steps ?? []
    const first = (t) => {
      const a = t.toLowerCase().indexOf('farnesway')
      const b = t.toLowerCase().indexOf('security compound')
      return a >= 0 && (b < 0 || a < b)
    }
    return [
      ['both steps saved, game order kept in the doc', steps.length === 2 && /Security Compound/.test(steps[0]?.label ?? steps[0]?.location ?? ''), `steps=${JSON.stringify(steps.map((s) => s.label))}`],
      ['overlay: Farnesway pickup first', first(r.overlay), `overlay=${JSON.stringify(r.overlay.slice(0, 400))} ${r.err}`],
      ['Next tab: Farnesway pickup first', first(r.next), `next=${JSON.stringify(lineWith(r.next, /Farnesway|Security Compound/).slice(0, 400))}`]
    ]
  },

  // CONTRACT4 F3: zone ids change per server, so a new session line (and a disconnect) drops this build's zone table;
  // a marker after it calibrates fresh; a step already placed keeps its position
  'j74-session-resets-zones': async () => {
    const e = setup('j74-session-resets-zones', {}, { jobs: [], history: [], lastLogEventAt: iso(ago(30)) })
    e.append(...J74_L.session(ago(120)))
    const stop = await launch(e)
    const zone = (d) => d?.markerZones?.['12913470']?.['862321816216']
    e.append(J74_L.marker(), J74_L.accept(), J74_L.deliver(), J74_L.collect())
    const before = await until(() => zone(e.jobs()))
    const pos = e.jobs()?.jobs?.[0]?.steps?.find((s) => s.objectiveId === J74_DROP || /Security Compound/.test(s.label ?? ''))?.position
    e.append(...J74_L.session())
    const cleared = await until(() => (e.jobs() && !zone(e.jobs()) ? e.jobs() : null), 8000)
    e.append(J74_L.marker())
    const again = await until(() => zone(e.jobs()), 8000)
    e.append(L.drop())
    const dropped = await until(() => (e.jobs() && !zone(e.jobs()) ? e.jobs() : null), 8000)
    await stop()
    const keptPos = cleared?.jobs?.[0]?.steps?.find((s) => s.objectiveId === J74_DROP || /Security Compound/.test(s.label ?? ''))?.position
    let trace = ''
    try {
      trace = fs.readFileSync(path.join(e.data, 'logs', 'trace.jsonl'), 'utf8')
    } catch {
      // checked below
    }
    return [
      ['zone calibrated from the J74 marker', !!before, `zones=${JSON.stringify(before ?? null)}`],
      ['new session line: zone table for the build emptied', !!before && !!cleared, `after=${JSON.stringify(cleared?.markerZones ?? null)?.slice(0, 200)}`],
      ['placed step keeps its position', !!pos && !!keptPos && Math.abs(keptPos.x - pos.x) < 1, `before=${JSON.stringify(pos)} after=${JSON.stringify(keptPos)}`],
      ['marker after the reset calibrates fresh', !!cleared && !!again, `zone=${JSON.stringify(again ?? null)}`],
      ['disconnect empties it too', !!again && !!dropped, `after=${JSON.stringify(dropped?.markerZones ?? null)?.slice(0, 200)}`],
      ['decide trace notes the reset (session and disconnect)', /marker zones reset: session/.test(trace) && /marker zones reset: disconnect/.test(trace), `resets=${count(trace, /marker zones reset/g)}`]
    ]
  },

  // CONTRACT6: REFRESH on the Next screen re-reads the active jobs' markers ignoring the watermark and places J74's
  // delivery; watermark, done flags and ended jobs untouched; the result line names the place
  'refresh-places-j74': async () => {
    const { e, before } = await j74Stale('refresh-places-j74', true)
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port))
    let pre = ''
    let clicked = false
    let msg = ''
    let overlay = ''
    let next = ''
    let jobsBtn = false
    let err = ''
    try {
      pre = await until(() => windowText(port, 'overlay').then((t) => (/Security Compound/i.test(t) ? t : '')), 8000)
      await clickButton(port, 'main', '/^NEXT$/')
      await until(() => clickButton(port, 'main', '/^REFRESH$/').then((ok) => (clicked = ok)), 6000)
      msg = lineWith(await until(() => windowText(port, 'main').then((t) => (/Refreshed|Refresh failed/.test(t) ? t : '')), 15000), /Refresh/)
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/(near|at) HDPC-Cassillo/i.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
      next = (await until(() => windowText(port, 'main').then((t) => (/(near|at) HDPC-Cassillo/.test(t) ? t : '')), 8000)) || (await windowText(port, 'main'))
      await clickButton(port, 'main', '/^JOBS$/')
      jobsBtn = await until(() => cdpEval(port, 'main', `[...document.querySelectorAll('button')].some((x) => /^REFRESH$/.test(x.textContent.trim()))`), 4000)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const doc = e.jobs()
    const drop = j74Drop(doc)
    const collect = doc?.jobs?.find((j) => j.missionId === J74)?.steps?.find((s) => /Farnesway/.test(s.label ?? ''))
    const endedBefore = findJob(before, J74_ENDED)
    const endedAfter = findJob(doc, J74_ENDED)
    return [
      ['before REFRESH: start-up did not place it (watermark past the marker)', !!pre && !/(near|at) HDPC-Cassillo/i.test(pre), `overlay=${JSON.stringify(lineWith(pre, /Security Compound|near/i).slice(0, 200))} ${err}`],
      ['REFRESH button on the Next screen', clicked, `clicked=${clicked}`],
      ['delivery step gets a position', !!drop?.position, `step=${JSON.stringify(drop ?? null)?.slice(0, 200)}`],
      ['overlay: "near HDPC-Cassillo"', /(near|at) HDPC-Cassillo/i.test(overlay), `overlay=${JSON.stringify(lineWith(overlay, /Security Compound|near/i).slice(0, 200))}`],
      ['Next tab: "near HDPC-Cassillo"', /(near|at) HDPC-Cassillo/.test(next), `next=${JSON.stringify(lineWith(next, /Security Compound|near/i).slice(0, 200))}`],
      ['result line names the place', /Refreshed.*\d+ place.*(Security Compound|HDPC-Cassillo)/.test(msg), `msg=${JSON.stringify(msg)}`],
      ['zone recalibrated for build 12913470', !!doc?.markerZones?.['12913470']?.['862321816216'], `zones=${JSON.stringify(doc?.markerZones ?? null)?.slice(0, 200)}`],
      ['watermark unchanged', !!before.lastLogEventAt && doc?.lastLogEventAt === before.lastLogEventAt && doc?.lastLogEventCount === before.lastLogEventCount, `before=${before.lastLogEventAt}/${before.lastLogEventCount} after=${doc?.lastLogEventAt}/${doc?.lastLogEventCount}`],
      ['ended job not revived', !!endedBefore && endedBefore.status !== 'active' && endedAfter?.status === endedBefore.status && copies(doc, J74_ENDED) === 1, `before=${endedBefore?.status} after=${endedAfter?.status} copies=${copies(doc, J74_ENDED)}`],
      ['jobs/history counts and done flags kept', doc?.jobs?.length === before.jobs.length && (doc?.history?.length ?? 0) === (before.history?.length ?? 0) && collect?.done === true, `jobs=${doc?.jobs?.length}/${before.jobs.length} history=${doc?.history?.length ?? 0}/${before.history?.length ?? 0} collect.done=${collect?.done}`],
      ['Jobs screen header has REFRESH too', !!jobsBtn, `found=${jobsBtn}`]
    ]
  },

  // CONTRACT6: the first start after an update (doc refreshedForVersion missing/different) refreshes once by itself;
  // the next start of the same version does not
  'refresh-auto-once': async () => {
    const { e, before } = await j74Stale('refresh-auto-once', false)
    const autos = () => count(traceText(e), /"what":"auto refresh: new version"/g)
    const a0 = autos()
    const port = await freePort()
    let stop = await launch(e, cdpArgs(port))
    let overlay = ''
    let err = ''
    const placed = await until(() => j74Drop(e.jobs())?.position, 15000)
    try {
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (/(near|at) HDPC-Cassillo/i.test(t) ? t : '')), 8000)) || (await windowText(port, 'overlay'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const mid = e.jobs()
    const a1 = autos()
    // second start, same version: strip again; nothing may place it this time
    fs.writeFileSync(path.join(e.data, 'other-jobs.json'), JSON.stringify(j74Stripped(e.jobs(), true)))
    stop = await launch(e)
    await sleep(3000)
    await stop()
    const last = e.jobs()
    const a2 = autos()
    return [
      ['first start: step placed without clicking', !!placed, `position=${JSON.stringify(placed ?? null)}`],
      ['overlay: "near HDPC-Cassillo"', /(near|at) HDPC-Cassillo/i.test(overlay), `overlay=${JSON.stringify(lineWith(overlay, /Security Compound|near/i).slice(0, 200))} ${err}`],
      ['refreshedForVersion stored', typeof mid?.refreshedForVersion === 'string' && mid.refreshedForVersion.length > 0, `refreshedForVersion=${mid?.refreshedForVersion}`],
      ['watermark unchanged', !!before.lastLogEventAt && mid?.lastLogEventAt === before.lastLogEventAt && mid?.lastLogEventCount === before.lastLogEventCount, `before=${before.lastLogEventAt}/${before.lastLogEventCount} after=${mid?.lastLogEventAt}/${mid?.lastLogEventCount}`],
      ['ended job not revived', findJob(mid, J74_ENDED)?.status === findJob(before, J74_ENDED)?.status && findJob(mid, J74_ENDED)?.status !== 'active', `before=${findJob(before, J74_ENDED)?.status} after=${findJob(mid, J74_ENDED)?.status}`],
      ['decide trace: one auto refresh on the first start', a1 - a0 === 1, `auto refresh lines ${a0} -> ${a1}`],
      ['second start: no rerun (trace count same, step stays unplaced)', a2 === a1 && !j74Drop(last)?.position && last?.refreshedForVersion === mid?.refreshedForVersion, `auto refresh lines ${a1} -> ${a2} position=${JSON.stringify(j74Drop(last)?.position ?? null)}`]
    ]
  },

  // CONTRACT4 C: Export diagnostics (button path) copies the whole saved text to the clipboard; result.copied
  'diag-clipboard': async () => {
    const r = await diagExportRun('diag-clipboard', { note: '', includeImages: false }, ({ iport }) => mainEval(iport, `require('electron').clipboard.readText()`))
    const clip = r.extra ?? ''
    return [
      ['export written', r.res?.ok === true && r.text != null, `result=${JSON.stringify(r.res)} ${r.err}`],
      ['result.copied true', r.res?.copied === true, `copied=${r.res?.copied}`],
      ['clipboard text equals the saved file', r.text != null && clip === r.text, `clipboard=${clip.length} chars file=${r.text?.length ?? null} chars`]
    ]
  },

  // CONTRACT4 C: the --export-diagnostics command-line path saves the file but leaves the clipboard alone
  'diag-cli-no-clipboard': async () => {
    const e = setup('diag-cli-no-clipboard')
    const out = path.join(e.data, 'diag-cli.txt')
    const iport = await freePort()
    const stop = await launch(e, ['--export-diagnostics', out, ...inspectArgs(iport)])
    const SENTINEL = 'sentinel-clipboard-untouched'
    let early = false
    let clip = ''
    let err = ''
    try {
      await mainEval(iport, `require('electron').clipboard.writeText(${JSON.stringify(SENTINEL)})`)
      early = !fs.existsSync(out)
      await waitForFile(out)
      await sleep(1000)
      clip = await mainEval(iport, `require('electron').clipboard.readText()`)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [
      ['sentinel set before the export was written', early, `file existed already=${!early} ${err}`],
      ['file written', fs.existsSync(out), `file=${out}`],
      ['clipboard still the sentinel', clip === SENTINEL, `clipboard=${JSON.stringify(String(clip).slice(0, 80))}`]
    ]
  },

  // Contract Shared / Complete / Failed notifications are known lines, not UNKNOWN LINES
  'contract-notices-known': async () => {
    const e = setup('contract-notices-known')
    const out = path.join(e.data, 'diag-notices.txt')
    const stop = await launch(e, ['--export-diagnostics', out])
    const a = mission()
    const b = mission()
    const c = mission()
    e.append(
      L.accept(a, 'Bounty Hunt'),
      L.accept(b, 'Patrol'),
      L.notice('Contract Shared:  Bounty Hunt', a),
      L.notice('Contract Complete:  Bounty Hunt', a),
      L.notice('Contract Failed:  Patrol', b),
      L.notice('Mission Bonus Unlocked: Extra Credit', c)
    )
    const text = await waitForFile(out)
    await stop()
    const unknown = diagSections(text)['UNKNOWN LINES'] ?? ''
    const bad = ['Contract Shared', 'Contract Complete', 'Contract Failed'].filter((t) => unknown.includes(t))
    return [
      ['diagnostics file written within 20 s', text != null, `file=${out}`],
      ['no Contract Shared/Complete/Failed in UNKNOWN LINES', text != null && bad.length === 0, `found=${bad.join(',')}`],
      ['UNKNOWN LINES still lists a really unknown line', /Mission Bonus Unlocked/.test(unknown), `unknown=${JSON.stringify(unknown.slice(0, 200))}`]
    ]
  },

  // CONTRACT7 A (case J82): standing at Covalex S1DC06, a combined pickup+delivery step whose pickup name has the OCR
  // doubled O ("S1DCO06") and whose position is the DROP-OFF marker (Security Compound, ~4 km away). The pickup is the
  // next stop, so its distance is from the pickup (~0.3 km), never the drop-off marker's ~4 km, and no "near" suffix.
  'j82-pickup-here': async () => {
    const step = {
      id: 's1',
      kind: 'turnin',
      label: 'Collect Scrap from Covalex Distribution Center S1DCO06 on Hurston. Deliver Scrap to Security Compound',
      location: 'Security Compound',
      pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston',
      pickedUp: false,
      item: 'Scrap',
      have: 0,
      need: 1,
      done: false,
      // the real drop-off marker point (star frame) from the export, ~4.2 km from where the user stands
      position: { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
    }
    const e = setup('j82-pickup-here', { otherStartMode: 'auto' }, {
      jobs: [logJob(mission(), { ref: 'J82', title: 'Med. Distance Covalex Delivery Stanton', steps: [step] })],
      history: [],
      listOrder: 'distance'
    })
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS.planet), zone1: '' }))
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], { SC_WHERE_TEXT_FILE: textFile })
    let w
    let overlay = ''
    let next = ''
    let snap = null
    let err = ''
    try {
      await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      w = await until(() => (e.jobs()?.where?.name === COVALEX ? e.jobs().where : null))
      const startShown = (t) => /covalex distribution centre s1dc06/i.test(t) && /from you/i.test(t)
      overlay = (await until(() => windowText(port, 'overlay').then((t) => (startShown(t) ? t : '')), 10000)) || (await windowText(port, 'overlay'))
      await clickButton(port, 'main', /^NEXT$/)
      next = (await until(() => windowText(port, 'main').then((t) => (/S1DCO06/i.test(t) ? t : '')), 8000)) || (await windowText(port, 'main'))
      const out = path.join(e.data, 'j82.txt')
      await stubSaveDialog(iport, out)
      const res = await cdpEval(port, 'main', `window.supercargo.diagExport({ note: '', includeImages: false })`, 40000)
      snap = snapshotJson(fs.readFileSync(res?.path ?? out, 'utf8'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const row = (snap?.other?.distanceTable?.distance ?? []).find((r) => /S1DCO06/i.test(String(r.place)))
    const fromYou = lineWith(overlay, /from you/i)
    // the start label also says "· 305 m": take it out before looking for the row's own sub-km figure
    const nextRows = (next ?? '').replace(new RegExp(`${COVALEX}\\s*·\\s*\\d+\\s*m`, 'gi'), '')
    const subKm = /≈?\s*[1-4]\d\d\s*m\b|≈?\s*0\.[1-4]\s*km/
    const fourKm = /\b4(\.\d)?\s*km\b/
    return [
      ['start read at Covalex S1DC06', w?.name === COVALEX, `where=${JSON.stringify(w)?.slice(0, 300)} ${err}`],
      ['table row: pickup distance ~0.3 km (not the 4 km drop-off marker)', row?.distance > 100 && row.distance < 500, `row=${JSON.stringify(row)?.slice(0, 400)}`],
      ['table row: distance not from the drop-off marker', !!row && row.distanceSource !== 'marker', `distanceSource=${row?.distanceSource} lookup=${JSON.stringify(row?.lookup?.method)}`],
      ['overlay: "from you" line is ~0.3 km', subKm.test(fromYou) && !fourKm.test(fromYou), `line=${JSON.stringify(fromYou)} ${err}`],
      ['overlay: no "near" suffix on the pickup', overlay.length > 0 && !/near covalex/i.test(overlay), `overlay=${JSON.stringify(lineWith(overlay, /S1DC|near/i).slice(0, 400))}`],
      ['Next tab: ~0.3 km, no 4 km', subKm.test(nextRows) && !fourKm.test(lineWith(nextRows, /S1DCO06|from you|km/i)), `next=${JSON.stringify(lineWith(next, /S1DC|km|\d m\b/i).slice(0, 400))}`],
      ['Next tab: no "near" suffix', next.length > 0 && !/near covalex/i.test(next), `next=${JSON.stringify(lineWith(next, /near/i).slice(0, 300))}`]
    ]
  },

  // CONTRACT7 B: the user's real reads at Covalex. The two "Open space" reads (garbled system/body lines) now place the
  // user at Covalex S1DC06 ~250-320 m, accuracy 10; the planet-line read is unchanged; the "Rappel" read (body line cut
  // off, star-frame lines would be used on a planet) gives no position, so the start stays at Covalex.
  'where-covalex-garbled': async () => {
    const step = { id: 's1', kind: 'go', label: 'Go to Lorville', location: 'Lorville', have: 0, need: 1, done: false }
    const e = setup('where-covalex-garbled', { otherStartMode: 'auto' }, { jobs: [logJob(mission(), { steps: [step] })], history: [] })
    const textFile = path.join(e.home, 'where-text.json')
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], { SC_WHERE_TEXT_FILE: textFile })
    const reads = {}
    let overlay = ''
    let err = ''
    let rappel
    let before
    let after
    let hist = null
    try {
      for (const k of ['open1', 'open2', 'planet']) {
        const prev = e.jobs()?.where?.at
        fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS[k]), zone1: '' }))
        const r = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
        const w = await until(() => (e.jobs()?.where && e.jobs().where.at !== prev ? e.jobs().where : null), 8000)
        reads[k] = { r, w }
        if (k === 'open1') overlay = (await until(() => windowText(port, 'overlay').then((t) => (/covalex/i.test(t) ? t : '')), 6000)) || (await windowText(port, 'overlay'))
      }
      before = e.jobs()?.where
      fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS.rappel), zone1: '' }))
      rappel = await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      await sleep(2500)
      after = e.jobs()?.where
      // the read's checks reach the user through ## WHERE AM I HISTORY
      const out = path.join(e.data, 'where-covalex.txt')
      await stubSaveDialog(iport, out)
      const res = await cdpEval(port, 'main', `window.supercargo.diagExport({ note: '', includeImages: false })`, 40000)
      hist = sectionJson(diagSections(fs.readFileSync(res?.path ?? out, 'utf8'))['WHERE AM I HISTORY'])
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const histReads = Array.isArray(hist) ? hist : findKey(hist, /history|reads|entries/i)
    const lastRead = Array.isArray(histReads) ? histReads[histReads.length - 1] : null
    const at = (k) => {
      const w = reads[k]?.w
      const m = labelMeters(w?.label)
      return [
        [`${k}: start is Covalex S1DC06, not Open space`, w?.name === COVALEX && !/open space/i.test(w?.label ?? ''), `where=${JSON.stringify(w)?.slice(0, 300)} ${err}`],
        [`${k}: ~250-320 m from it`, m != null && m >= 200 && m <= 400, `label=${w?.label}`],
        [`${k}: accuracy 10`, w?.accuracy === 10, `accuracy=${w?.accuracy} checks=${JSON.stringify(reads[k]?.r?.info?.checks)?.slice(0, 300)}`]
      ]
    }
    return [
      ...at('open1'),
      ['overlay start shows Covalex, not Open space', /covalex/i.test(overlay) && !/open space/i.test(overlay), `overlay=${JSON.stringify(overlay.slice(0, 300))}`],
      ...at('open2'),
      ...at('planet'),
      ['Rappel read gives no position', !rappel?.where?.point && !/rappel/i.test(rappel?.where?.label ?? rappel?.where?.name ?? ''), `result=${JSON.stringify(rappel)?.slice(0, 400)}`],
      ['Rappel read: a failed position check says why', /star-frame lines not used/i.test(JSON.stringify(lastRead?.checks ?? rappel?.info?.checks ?? null)), `checks=${JSON.stringify(lastRead?.checks ?? rappel?.info?.checks)?.slice(0, 400)}`],
      ['Rappel read: start unchanged', !!before && after?.name === COVALEX && after?.at === before.at, `before=${before?.label}@${before?.at} after=${after?.label}@${after?.at}`]
    ]
  },

  // CONTRACT8 (J82 through the resolver): the OCR-doubled pickup name "S1DCO06" folds to the roster's Covalex S1DC06
  // ('corrected', not the drop-off marker); ~0.3 km from the read start; the read start adds "you are here"
  'match-j82-corrected': async () => {
    const step = {
      id: 's1',
      kind: 'turnin',
      label: 'Collect Scrap from Covalex Distribution Center S1DCO06 on Hurston. Deliver Scrap to Security Compound',
      location: 'Security Compound',
      pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston',
      pickedUp: false,
      item: 'Scrap',
      have: 0,
      need: 1,
      done: false,
      position: { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
    }
    const r = await matchRun('match-j82-corrected', { jobs: [{ ref: 'J82', title: 'Med. Distance Covalex Delivery Stanton', steps: [step] }], read: 'planet', want: TAG.corrected })
    const row = distRow(r.snap, /S1DCO06/i)
    const m = matchEntry(r.matches, /S1DCO06/i)
    return [
      ['start read at Covalex S1DC06', r.w?.name === COVALEX, `where=${short(r.w, 300)} ${r.err}`],
      ['overlay: "≈ corrected" tag', TAG.corrected.test(r.overlay), `overlay=${short(lineWith(r.overlay, /S1DC|corrected/i))}`],
      ['Next tab: "≈ corrected" tag', TAG.corrected.test(r.next), `next=${short(lineWith(r.next, /S1DC|corrected/i))}`],
      ['table row: match corrected to Covalex S1DC06 (roster)', row?.match?.status === 'corrected' && row.match.source === 'roster' && /Covalex Distribution Centre S1DC06/.test(JSON.stringify(row.match)), `match=${short(row?.match, 500)}`],
      ['table row: ~0.3 km (pickup, not the 4 km drop-off marker)', row?.distance > 100 && row.distance < 500 && row.distanceSource !== 'marker', `distance=${row?.distance} source=${row?.distanceSource}`],
      ['evidence: name corrected, Hurston agrees, you are here', /corrected/i.test(short(row?.match?.evidence, 2000)) && /Hurston/.test(short(row?.match?.evidence, 2000)) && /you are here/i.test(short(row?.match?.evidence, 2000)), `evidence=${short(row?.match?.evidence, 600)}`],
      ['confidence >= 7', row?.match?.confidence >= 7, `confidence=${row?.match?.confidence}`],
      ['## MATCHES lists it as corrected', m?.status === 'corrected' && Array.isArray(m.evidence) && Array.isArray(m.candidates), `matches=${short(r.matches, 500)} raw=${short((r.sec['MATCHES'] ?? '(missing)').slice(0, 200))}`]
    ]
  },

  // CONTRACT8 (J74): "Security Compound" has no roster place; the game's marker places it -> '📍 game marker',
  // confidence 8. ADDENDUM: the generic site belongs to the nearest roster place to the marker -> "at HDPC-Cassillo"
  // (site from 'marker'; the contract's HDPC-Farnesway is not within 25 km of the marker, so it is not the parent)
  'match-j74-marker': async () => {
    const r = await j74Run('match-j74-marker', { collected: true, exportDiag: true })
    const row = distRow(r.snap, /Security Compound/)
    const matches = sectionJson(r.sec?.['MATCHES'])
    const m = matchEntry(matches, /Security Compound/)
    const site = row?.match?.site
    return [
      ['overlay: "📍 game marker" tag', TAG.marker.test(r.overlay), `overlay=${short(lineWith(r.overlay, /Security Compound|marker|at |near/i))} ${r.err}`],
      ['overlay: "at HDPC-Cassillo"', /\bat HDPC-Cassillo/i.test(r.overlay), `overlay=${short(lineWith(r.overlay, /HDPC|at /i))}`],
      ['Next tab: "📍 game marker" tag + "Security Compound · at HDPC-Cassillo"', TAG.marker.test(r.next) && /Security Compound\s*·\s*at HDPC-Cassillo/i.test(r.next), `next=${short(lineWith(r.next, /Security Compound|marker|HDPC/i))}`],
      ['Next tab: not "at HDPC-Farnesway" (the pickup is not the parent)', r.next.length > 0 && !/Security Compound\s*·\s*at HDPC-Farnesway/i.test(r.next), `next=${short(lineWith(r.next, /Security Compound/i))}`],
      ['table row: status marker, source marker', row?.match?.status === 'marker' && row.match.source === 'marker', `match=${short(row?.match, 500)}`],
      ['table row: site HDPC-Cassillo from marker (near = same)', site?.name === 'HDPC-Cassillo' && site.from === 'marker' && row.match.near?.name === 'HDPC-Cassillo', `site=${short(site)} near=${short(row?.match?.near)}`],
      // 8 from the marker; +2 when the wiki game data confirms HDPC-Cassillo has a Security Compound (batch 8 W4)
      ['table row: confidence 8 (10 with game data), has a distance', [8, 10].includes(row?.match?.confidence) && row?.distance > 0, `confidence=${row?.match?.confidence} distance=${row?.distance}`],
      ['## MATCHES lists Security Compound as marker', m?.status === 'marker', `matches=${short(matches, 500)}`]
    ]
  },

  // CONTRACT8 ADDENDUM (J82 drop-off): pickup done, the active place is the generic "Security Compound"; the contract
  // names Covalex Distribution Center S1DC06, within 25 km of the drop-off marker, so the site is Covalex S1DC06
  // (from 'contract'), positioned by the marker (status 'marker'); shown "Security Compound · at Covalex Distribution
  // Centre S1DC06", never another place's distance
  'match-j82-dropoff-site': async () => {
    const step = {
      id: 's1',
      kind: 'turnin',
      label: 'Collect Scrap from Covalex Distribution Center S1DCO06 on Hurston. Deliver Scrap to Security Compound',
      location: 'Security Compound',
      pickupLocation: 'Covalex Distribution Center S1DCO06 on Hurston',
      pickedUp: true,
      item: 'Scrap',
      have: 0,
      need: 1,
      done: false,
      position: { x: 12851198309.646416, y: 18566.685364, z: 672945.839535 }
    }
    const r = await matchRun('match-j82-dropoff-site', {
      jobs: [{ ref: 'J82', title: 'Med. Distance Covalex Delivery Stanton', steps: [step] }],
      read: 'planet',
      want: /Security Compound[\s\S]{0,80}at Covalex/i
    })
    const row = distRow(r.snap, /Security Compound/)
    const site = row?.match?.site
    const m = matchEntry(r.matches, /Security Compound/)
    return [
      ['start read at Covalex S1DC06', r.w?.name === COVALEX, `where=${short(r.w, 300)} ${r.err}`],
      ['overlay: "at Covalex Distribution Centre S1DC06"', /\bat Covalex Distribution Centre S1DC06/i.test(r.overlay), `overlay=${short(lineWith(r.overlay, /Security Compound|at Covalex/i))}`],
      ['Next tab: "Security Compound · at Covalex Distribution Centre S1DC06"', /Security Compound\s*·\s*at Covalex Distribution Centre S1DC06/i.test(r.next), `next=${short(lineWith(r.next, /Security Compound|Covalex/i))}`],
      ['Next tab: "📍 game marker" tag', TAG.marker.test(r.next), `next=${short(lineWith(r.next, /Security Compound|marker/i))}`],
      ['table row: site Covalex S1DC06 from contract', site?.name === COVALEX && site.from === 'contract', `site=${short(site)} match=${short(row?.match, 500)}`],
      ['table row: status marker, point from the marker', row?.match?.status === 'marker' && row.match.source === 'marker' && row.distanceSource === 'marker', `status=${row?.match?.status} source=${row?.match?.source} distanceSource=${row?.distanceSource}`],
      ['table row: distance ~4 km (start -> drop-off marker)', row?.distance > 2000 && row.distance < 7000, `distance=${row?.distance}`],
      ['site meters ~4 km (marker -> Covalex)', site?.meters > 2000 && site.meters < 7000, `site=${short(site)}`],
      ['## MATCHES lists Security Compound with the site', m?.status === 'marker' && /Covalex Distribution Centre S1DC06/.test(JSON.stringify(m)), `matches=${short(r.matches, 600)}`]
    ]
  },

  // CONTRACT8: a look-alike name on another body ("Covalex ... S1DC06" is on Hurston, the text says microTech) is
  // rejected: '✗ not found', no distance (never the Hurston place's), listed in ## MATCHES; an exact stop isn't listed
  'match-lookalike-other-body': async () => {
    const go = (id, place) => ({ id, kind: 'go', label: `Deliver Scrap to ${place}`, location: place, have: 0, need: 1, done: false })
    const PLACE = 'Covalex Distribution Center S1DC06 on microTech'
    const r = await matchRun('match-lookalike-other-body', {
      jobs: [{ ref: 'J90', steps: [go('s1', PLACE)] }, { ref: 'J91', steps: [go('s1', 'Port Tressler')] }],
      want: /not found/i,
      overlayWant: /Port Tressler|microTech/i
    })
    const row = distRow(r.snap, /on microTech/i)
    const exact = distRow(r.snap, /^Port Tressler$/)
    return [
      ['Next tab: "✗ not found" tag', TAG.none.test(r.next), `next=${short(lineWith(r.next, /microTech|S1DC06|not found/i))} ${r.err}`],
      ['table row: status none, no point, no roster match', row?.match?.status === 'none' && !row.match.point && !row.match.match, `match=${short(row?.match, 500)}`],
      ['table row: no distance (not the Hurston S1DC06 distance)', !!row && row.distance == null, `distance=${row?.distance} source=${row?.distanceSource} why=${row?.noDistanceWhy}`],
      ['evidence says microTech disagrees', /microtech/i.test(short(row?.match?.evidence, 2000)) && /✗/.test(short(row?.match?.evidence, 2000)), `evidence=${short(row?.match?.evidence, 600)}`],
      ['exact stop still exact with a distance', exact?.match?.status === 'exact' && exact.distance > 0, `row=${short(exact, 300)}`],
      ['## MATCHES lists the look-alike as none', matchEntry(r.matches, /on microTech/i)?.status === 'none', `matches=${short(r.matches, 500)}`],
      ['## MATCHES leaves out the exact stop', !!r.matches && !matchEntry(r.matches, /^Port Tressler$/), `matches=${short(r.matches, 500)}`]
    ]
  },

  // CONTRACT8: two roster places score the same ("Shubin Mining Facility on Lyria": SAL-2 and SAL-5), no marker ->
  // '? not sure' with both named, no distance, listed in ## MATCHES
  'match-two-equal': async () => {
    const step = { id: 's1', kind: 'go', label: 'Deliver Scrap to Shubin Mining Facility on Lyria', location: 'Shubin Mining Facility on Lyria', have: 0, need: 1, done: false }
    const r = await matchRun('match-two-equal', { jobs: [{ ref: 'J92', steps: [step] }], want: /not sure/i })
    const row = distRow(r.snap, /Shubin Mining Facility on Lyria/i)
    const names = (row?.match?.candidates ?? []).slice(0, 2).map((c) => c.name)
    const scores = (row?.match?.candidates ?? []).slice(0, 2).map((c) => c.score)
    return [
      ['Next tab: "? not sure" tag', TAG.unsure.test(r.next), `next=${short(lineWith(r.next, /Shubin|not sure/i))} ${r.err}`],
      ['Next tab: names both places ("not sure: A or B?")', /not sure:.*SAL-[25].*\bor\b.*SAL-[25]/i.test(r.next), `next=${short(lineWith(r.next, /not sure/i))}`],
      ['table row: status unsure, no point, no distance', row?.match?.status === 'unsure' && !row.match.point && row.distance == null, `match=${short(row?.match, 500)} distance=${row?.distance}`],
      ['top two candidates SAL-2 and SAL-5 with equal scores', names.sort().join() === 'Shubin Mining Facility SAL-2,Shubin Mining Facility SAL-5' && scores[0] === scores[1] && scores[0] >= 5, `candidates=${short(row?.match?.candidates, 400)}`],
      ['## MATCHES lists it as unsure', matchEntry(r.matches, /Shubin Mining Facility on Lyria/i)?.status === 'unsure', `matches=${short(r.matches, 500)}`]
    ]
  },

  // CONTRACT8: only exact names -> ## MATCHES says "(all exact)" and no warning tag shows
  'match-all-exact': async () => {
    const go = (id, place) => ({ id, kind: 'go', label: `Go to ${place}`, location: place, have: 0, need: 1, done: false })
    // one open step per job is listed (show-all off), so two jobs
    const r = await matchRun('match-all-exact', { jobs: [{ steps: [go('s1', 'Port Tressler')] }, { steps: [go('s2', 'Seraphim Station')] }], want: /Port Tressler|Seraphim/i })
    const rows = r.snap?.other?.distanceTable?.distance ?? []
    return [
      ['## MATCHES is "(all exact)"', /\(all exact\)/.test(r.sec['MATCHES'] ?? ''), `matches=${short((r.sec['MATCHES'] ?? '(missing)').slice(0, 300))} ${r.err}`],
      ['table rows all exact', rows.length >= 2 && rows.every((x) => x.match?.status === 'exact'), `rows=${short(rows.map((x) => [x.place, x.match?.status]))}`],
      ['no non-exact tag on the overlay or Next tab', r.next.length > 0 && !NON_EXACT_TAG.test(r.overlay) && !NON_EXACT_TAG.test(r.next), `overlay=${short(lineWith(r.overlay, NON_EXACT_TAG))} next=${short(lineWith(r.next, NON_EXACT_TAG))}`]
    ]
  },

  // CONTRACT9 M5 + M1: "Shubin Mining Facility on Lyria" is '? not sure' (SAL-2 / SAL-5). Click the tag on the Next tab,
  // ✗ Wrong, pick SAL-2 -> '✓ you set' with a distance, a 'user' entry in other-matches.json; after a restart it is
  // still set (the file is read back, not re-guessed)
  'memory-wrong-pick': async () => {
    const name = 'memory-wrong-pick'
    const { e, port, iport, stop } = await memLaunch(name, { jobs: [{ ref: 'J92', steps: [goStep('s1', SHUBIN)] }] })
    let ui = null
    let next = ''
    let snap = null
    let err = ''
    try {
      await nextText(port, TAG.unsure)
      ui = await uiWrongPick(port, 'main', TAG.unsure, 'SAL-2', SAL2)
      next = await nextText(port, MEM_TAG.user)
      snap = snapshotJson(await exportNow(e, port, iport, name))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const file = memFile(e)
    const ent = memEntry(file, /Shubin Mining Facility on Lyria/i)
    const row = distRow(snap, /Shubin Mining Facility on Lyria/i)
    // second run on the same data folder; move the first run's log aside so launch() waits for this run's ready line
    try {
      const lf = path.join(e.data, 'logs', 'supercargo.log')
      if (fs.existsSync(lf)) fs.renameSync(lf, `${lf}.run1`)
    } catch {
      // no log yet
    }
    const again = await launch(e, cdpArgs(port))
    let next2 = ''
    try {
      next2 = await nextText(port, MEM_TAG.user, 15000)
    } catch (x) {
      err += ` restart: ${String(x?.message ?? x)}`
    }
    await again()
    return [
      ['UI: tag, ✗ Wrong, picker input and SAL-2 option found', !!ui?.tag && !!ui.wrong && !!ui.input && !!ui.option, `ui=${short(ui)} ${err}`],
      ['Next tab: "✓ you set" tag', MEM_TAG.user.test(next), `next=${short(lineWith(next, /Shubin|SAL-|you set|not sure/i))}`],
      ['Next tab: no "? not sure" left on the stop', next.length > 0 && !TAG.unsure.test(lineWith(next, /Shubin|not sure/i)), `next=${short(lineWith(next, /not sure/i))}`],
      ['table row: status user, SAL-2, has a distance', row?.match?.status === 'user' && /SAL-2/.test(JSON.stringify(row.match.match ?? row.match)) && row.distance > 0, `match=${short(row?.match, 500)} distance=${row?.distance}`],
      ['table row: confidence 10, evidence "you set this"', row?.match?.confidence === 10 && /you set this/i.test(short(row?.match?.evidence, 1000)), `confidence=${row?.match?.confidence} evidence=${short(row?.match?.evidence, 300)}`],
      ['other-matches.json: user entry -> SAL-2', ent?.origin === 'user' && ent.place === SAL2, `entry=${short(ent, 500)}`],
      ['other-matches.json: a "set" change by user with before/after', (file?.changes ?? []).some((c) => c.what === 'set' && c.by === 'user' && c.after?.place === SAL2), `changes=${short(file?.changes, 500)}`],
      ['after restart: still "✓ you set"', MEM_TAG.user.test(next2), `next=${short(lineWith(next2, /Shubin|you set|not sure/i))}`]
    ]
  },

  // CONTRACT9 M7: set SAL-2 for the unsure stop, then the LEARNED DATA tab (CONTRACT12) -> UNDO on the newest change ->
  // the stop is '? not sure' again and the entry is no longer the user's
  'memory-undo': async () => {
    const name = 'memory-undo'
    const { e, port, stop } = await memLaunch(name, { jobs: [{ ref: 'J92', steps: [goStep('s1', SHUBIN)] }] })
    let setDoc = null
    let listText = ''
    let undone = false
    let next = ''
    let err = ''
    try {
      setDoc = await memSetVia(port, /Shubin Mining Facility on Lyria/i, SAL2)
      await nextText(port, MEM_TAG.user)
      listText = (await openLearnedData(port, /SAL-2[\s\S]*you set it|you set it[\s\S]*SAL-2/i)).text
      undone = await clickButton(port, 'main', /^Undo$/i)
      await until(() => (memEntry(memFile(e), /Shubin Mining Facility on Lyria/i)?.origin !== 'user' ? true : null), 8000)
      next = await nextText(port, TAG.unsure)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const file = memFile(e)
    const ent = memEntry(file, /Shubin Mining Facility on Lyria/i)
    return [
      ['otherMemorySet returned the doc with the user entry', memEntry(setDoc, /Shubin/i)?.origin === 'user', `doc=${short(setDoc, 400)} ${err}`],
      ['LEARNED DATA lists the text -> SAL-2, "you set it"', /RECENT CHANGES/i.test(listText) && /you set it/i.test(listText) && /SAL-2/.test(listText), `learned=${short(lineWith(listText, /RECENT|Shubin|SAL-|you set/i))}`],
      ['Undo button clicked', undone === true, `undone=${undone}`],
      ['Next tab: back to "? not sure"', TAG.unsure.test(next) && !MEM_TAG.user.test(lineWith(next, /Shubin|you set/i)), `next=${short(lineWith(next, /Shubin|not sure|you set/i))}`],
      ['other-matches.json: entry not the user\'s (game or gone)', !ent || ent.origin === 'game', `entry=${short(ent, 400)}`],
      ['other-matches.json: an "undo" change logged', (file?.changes ?? []).some((c) => c.what === 'undo'), `changes=${short((file?.changes ?? []).map((c) => c.what))}`]
    ]
  },

  // CONTRACT9 M2 + M3: read at Covalex S1DC06, then Objective Complete for "Covalex Distribution Center S1DCO06 on
  // Hurston" (resolved there, 'corrected') -> confirmed 1; a second job the same -> confirmed 2; a third job's open stop
  // with that text is then '✓ learned'
  'memory-proof-learned': async () => {
    const name = 'memory-proof-learned'
    const TEXT = 'Covalex Distribution Center S1DCO06 on Hurston'
    const OBJ = `Go to ${TEXT}`
    const { e, port, iport, stop, textFile } = await memLaunch(name, { read: true })
    const conf = []
    let next = ''
    let snap = null
    let err = ''
    try {
      for (let i = 0; i < 2; i++) {
        const id = mission()
        e.append(L.accept(id, 'Med. Distance Covalex Delivery Stanton'), L.objective(id, OBJ))
        await until(() => (findJob(e.jobs(), id)?.steps?.length ? true : null))
        await memRead(e, port, textFile)
        e.append(L.objectiveComplete(id, OBJ))
        const n = await until(() => {
          const c = memEntry(memFile(e), /S1DCO06/i)?.confirmed
          return c >= i + 1 ? c : null
        }, 10000)
        conf.push(n ?? memEntry(memFile(e), /S1DCO06/i)?.confirmed ?? null)
      }
      const id3 = mission()
      e.append(L.accept(id3, 'Med. Distance Covalex Delivery Stanton'), L.objective(id3, OBJ))
      await until(() => (findJob(e.jobs(), id3)?.steps?.length ? true : null))
      next = await nextText(port, MEM_TAG.learned)
      snap = snapshotJson(await exportNow(e, port, iport, name))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const ent = memEntry(memFile(e), /S1DCO06/i)
    const row = distRow(snap, /S1DCO?06/i) // the import may rename a sure match; locationRaw keeps the text as read
    const proofs = (memFile(e)?.changes ?? []).filter((c) => c.what === 'proof' && /S1DCO06/i.test(c.text))
    return [
      ['first completion -> confirmed 1', conf[0] === 1, `confirmed=${short(conf)} ${err}`],
      ['second job -> confirmed 2', conf[1] === 2, `confirmed=${short(conf)}`],
      ['entry: game, Covalex S1DC06, wrong 0', ent?.origin === 'game' && ent.place === COVALEX && !ent.wrong, `entry=${short(ent, 500)}`],
      ['two "proof" changes by game', proofs.length === 2 && proofs.every((c) => c.by === 'game'), `changes=${short(proofs, 400)}`],
      ['Next tab: "✓ learned" tag on the third job', MEM_TAG.learned.test(next), `next=${short(lineWith(next, /S1DC|learned|corrected/i))}`],
      ['table row: status learned, Covalex S1DC06', row?.match?.status === 'learned' && /Covalex Distribution Centre S1DC06/.test(JSON.stringify(row.match)), `match=${short(row?.match, 500)}`],
      ['evidence: "learned: game confirmed ×2"', /learned: game confirmed ×2/i.test(short(row?.match?.evidence, 2000)), `evidence=${short(row?.match?.evidence, 500)}`]
    ]
  },

  // CONTRACT9 M8: the user sets SAL-2 for "Shubin Mining Facility on Lyria"; two completions of that stop while the
  // reads show you at Covalex S1DC06 (Hurston) -> wrong 2, disputed; the user's place still wins (status user,
  // confidence 6) and the stop shows "⚠ the game disagrees" with where you were
  'memory-disputed': async () => {
    const name = 'memory-disputed'
    const OBJ = `Go to ${SHUBIN}`
    const { e, port, iport, stop, textFile } = await memLaunch(name, { read: true })
    let next = ''
    let snap = null
    let err = ''
    try {
      await memRead(e, port, textFile)
      const ids = [mission(), mission(), mission()]
      e.append(L.accept(ids[0], 'Bounty Hunt'), L.objective(ids[0], OBJ))
      await memSetVia(port, /Shubin Mining Facility on Lyria/i, SAL2)
      for (let i = 0; i < 2; i++) {
        if (i) {
          e.append(L.accept(ids[i], 'Bounty Hunt'), L.objective(ids[i], OBJ))
          await until(() => (findJob(e.jobs(), ids[i])?.steps?.length ? true : null))
        }
        await memRead(e, port, textFile)
        e.append(L.objectiveComplete(ids[i], OBJ))
        await until(() => (memEntry(memFile(e), /Shubin/i)?.wrong >= i + 1 ? true : null), 10000)
      }
      e.append(L.accept(ids[2], 'Bounty Hunt'), L.objective(ids[2], OBJ))
      await until(() => (findJob(e.jobs(), ids[2])?.steps?.length ? true : null))
      next = await nextText(port, MEM_TAG.disputed)
      snap = snapshotJson(await exportNow(e, port, iport, name))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const ent = memEntry(memFile(e), /Shubin Mining Facility on Lyria/i)
    const row = distRow(snap, /Shubin Mining Facility on Lyria/i)
    return [
      ['entry: user, SAL-2, wrong 2, disputed', ent?.origin === 'user' && ent.place === SAL2 && ent.wrong === 2 && ent.disputed === true, `entry=${short(ent, 600)} ${err}`],
      ['entry: wrongAt[0] is Covalex S1DC06 with meters', ent?.wrongAt?.[0]?.name === COVALEX && ent.wrongAt[0].meters != null, `wrongAt=${short(ent?.wrongAt)}`],
      ['Next tab: "⚠ the game disagrees"', MEM_TAG.disputed.test(next), `next=${short(lineWith(next, /Shubin|SAL-|disagree|you set/i))}`],
      ['Next tab: "you were at Covalex Distribution Centre S1DC06"', /you were at Covalex Distribution Centre S1DC06/i.test(next), `next=${short(lineWith(next, /you were|disagree/i))}`],
      ['table row: user\'s place still wins (status user, SAL-2, confidence 6)', row?.match?.status === 'user' && /SAL-2/.test(JSON.stringify(row.match)) && row.match.confidence === 6, `match=${short(row?.match, 500)}`],
      ['evidence: "you set this; ⚠ the game disagrees ×2"', /you set this; ⚠ the game disagrees ×2/i.test(short(row?.match?.evidence, 2000)), `evidence=${short(row?.match?.evidence, 400)}`]
    ]
  },

  // CONTRACT9 M4: after a user set, the button-path export has ## MATCH MEMORY with the entry and the change
  'memory-diag-section': async () => {
    const name = 'memory-diag-section'
    const { e, port, iport, stop } = await memLaunch(name, { jobs: [{ ref: 'J92', steps: [goStep('s1', SHUBIN)] }] })
    let text = null
    let err = ''
    try {
      await memSetVia(port, /Shubin Mining Facility on Lyria/i, SAL2)
      await sleep(1500)
      text = await exportNow(e, port, iport, name)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const body = diagSections(text)['MATCH MEMORY'] ?? null
    return [
      ['## MATCH MEMORY present', body != null, `sections=${short(Object.keys(diagSections(text)))} ${err}`],
      ['entries: the Shubin text -> SAL-2 (user)', /Shubin Mining Facility on Lyria/i.test(body ?? '') && /SAL-2/.test(body ?? '') && /user/i.test(body ?? ''), `body=${short((body ?? '').slice(0, 600))}`],
      ['changes: a "set" line', /\bset\b/.test(body ?? ''), `body=${short((body ?? '').slice(-400))}`],
      ['no player handle in the section', !/PLAYER/.test(body ?? ''), '']
    ]
  },

  // CONTRACT9 ADDENDUM 2 S: J82 pickup "S1DCO06" resolves to Covalex Distribution Centre S1DC06, a place only the
  // starmap file has (UEX lists "…Center S1DC06" without coordinates). Switch the starmap source off in Settings →
  // DATA SOURCES: the place is gone, the stop gets no distance (never the 4 km drop-off marker's), the counts show;
  // switch it on again: back to ~0.3 km. The candidate's evidence names its source ("· from starmap data").
  'sources-starmap-off': async () => {
    const name = 'sources-starmap-off'
    const e = setup(name, { otherStartMode: 'auto', otherSourceStarmap: true }, {
      jobs: [logJob(mission(), { ref: 'J82', title: 'Med. Distance Covalex Delivery Stanton', steps: [J82_PICKUP_STEP] })],
      history: [],
      listOrder: 'distance',
      lastLogEventAt: iso(ago(30))
    })
    const textFile = path.join(e.home, 'where-text.json')
    fs.writeFileSync(textFile, JSON.stringify({ zone2: serverTimeNow(COVALEX_READS.planet), zone1: '' }))
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], { SC_WHERE_TEXT_FILE: textFile })
    const snaps = {}
    const nexts = {}
    let src = ''
    let off = null
    let back = null
    let err = ''
    try {
      await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
      await until(() => (e.jobs()?.where?.name === COVALEX ? true : null))
      nexts.on = await nextText(port, TAG.corrected)
      snaps.on = snapshotJson(await exportNow(e, port, iport, `${name}-on`))
      src = await sourcesText(port)
      off = await sourcesToggle(port, false)
      nexts.off = await nextText(port, /S1DCO06/i)
      await sleep(1500)
      snaps.off = snapshotJson(await exportNow(e, port, iport, `${name}-off`))
      await sourcesText(port)
      back = await sourcesToggle(port, true)
      nexts.back = await nextText(port, TAG.corrected)
      snaps.back = snapshotJson(await exportNow(e, port, iport, `${name}-back`))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const rows = Object.fromEntries(Object.entries(snaps).map(([k, s]) => [k, distRow(s, /S1DCO06/i)]))
    const counts = sourceCounts(src)
    const isCentre = (r) => /Covalex Distribution Centre S1DC06/.test(JSON.stringify(r?.match?.match ?? r?.match?.label ?? ''))
    const near = (r) => r?.distance > 100 && r.distance < 500 && r.distanceSource !== 'marker'
    const evOn = short([rows.on?.match?.evidence, rows.on?.match?.candidates], 3000)
    const sourcesSnap = findKey(snaps.off, /^(enabled)?sources$/i) ?? findKey(snaps.off, /source(s)?Enabled|otherSource/i)
    return [
      ['on: J82 pickup corrected to Covalex Centre S1DC06, ~0.3 km', isCentre(rows.on) && rows.on.match.status === 'corrected' && near(rows.on), `match=${short(rows.on?.match, 300)} distance=${rows.on?.distance} source=${rows.on?.distanceSource} ${err}`],
      ['on: evidence names the source ("· from starmap data")', STARMAP_EV.test(evOn), `evidence=${evOn.slice(0, 500)}`],
      ['DATA SOURCES: UEX row with counts, base list (always on)', counts.uex > 0 && counts.uexCoords >= 0 && /base list/i.test(src), `counts=${short(counts)} text=${short(lineWith(src, /UEX|base list/i))}`],
      ['DATA SOURCES: starmap row "adds N places, fills coordinates for M"', counts.starmapAdds > 0 && counts.starmapFills >= 0, `counts=${short(counts)} text=${short(lineWith(src, /starmap/i))}`],
      ['switch off through the UI', off?.clicked === true && off.setting === false, `off=${short(off)}`],
      ['off: the stop is still listed on Next', /S1DCO06/i.test(nexts.off ?? ''), `next=${short(lineWith(nexts.off, /S1DC/i))}`],
      ['off: not the starmap-only Centre S1DC06', !isCentre(rows.off), `match=${short(rows.off?.match, 300)}`],
      ['off: no distance (never the drop-off marker\'s 4 km)', !rows.off || rows.off.distance == null, `row=${short(rows.off, 300)}`],
      ['off: SNAPSHOT shows the starmap source disabled', /starmap/i.test(short(sourcesSnap, 400)) && /false|off/i.test(short(sourcesSnap, 400)), `sources=${short(sourcesSnap, 300)}`],
      ['switch on again through the UI', back?.clicked === true && back.setting === true, `back=${short(back)}`],
      ['settings.json keeps the switch (otherSourceStarmap true at the end)', (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(e.data, 'settings.json'), 'utf8')).otherSourceStarmap === true
        } catch {
          return false
        }
      })(), ''],
      ['back on: corrected to Covalex Centre S1DC06, ~0.3 km again', isCentre(rows.back) && near(rows.back), `match=${short(rows.back?.match, 300)} distance=${rows.back?.distance}`]
    ]
  },

  // CONTRACT9 ADDENDUM 2 T (OCR typo matching): confusion-folded names -> '≈ corrected'. Primary: J73's pickup
  // "CRU-L1 Ambitious Dream Station" as OCR reads it with rn for m ("Drearn"): folded keys equal -> corrected +5,
  // right place, shown with the tag in both windows. The case table's OCR misreads may resolve or stay 'none'
  // (resolve_checks decides each), but never to a wrong place; S1DC06 never matches S4DC05 (code tokens).
  'typo-close-spelling': async () => {
    const TYPO = 'CRU-L1 Ambitious Drearn Station'
    const CASES = [
      ['CRU-LS5 Beautiful Glen Station', 'CRU-L5 Beautiful Glen Station'],
      ['ARC-L dern Express Station', 'ARC-L3 Modern Express Station'],
      ['Deak Outpost on Yela', 'Deakins Research Outpost'],
      ['August Dunlow Sg Orison. Quy port in', 'August Dunlow Spaceport']
    ]
    const jobs = [
      { ref: 'J73', title: 'Medical Supplies', steps: [goStep('s0', TYPO)] },
      ...CASES.map(([text], i) => ({ ref: `J${74 + i}`, steps: [goStep(`s${i + 1}`, text)] })),
      { ref: 'J90', steps: [goStep('s9', 'Covalex Distribution Center S4DC05 on Hurston')] }
    ]
    const r = await matchRun('typo-close-spelling', { jobs, want: TAG.corrected })
    const row = distRow(r.snap, /Drearn/i)
    const m = matchEntry(r.matches, /Drearn/i)
    const placeOf = (x) => String(x?.match?.match?.name ?? x?.match?.label ?? '')
    const caseChecks = CASES.map(([text, right]) => {
      const x = distRow(r.snap, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
      const st = x?.match?.status
      const ok = !x || st === 'none' || st === 'unsure' || placeOf(x) === right
      return [`case table "${text}": ${right} or not placed, never a wrong place`, ok, `status=${st} place=${placeOf(x)} evidence=${short(x?.match?.evidence, 200)}`]
    })
    const s4 = distRow(r.snap, /S4DC05/i)
    return [
      ['overlay: "≈ corrected" tag', TAG.corrected.test(r.overlay), `overlay=${short(lineWith(r.overlay, /Drearn|Dream|corrected/i))} ${r.err}`],
      ['Next tab: "≈ corrected" on the Drearn stop', TAG.corrected.test(lineWith(r.next, /Drearn|corrected/i)), `next=${short(lineWith(r.next, /Drearn|Dream|corrected/i))}`],
      ['table row: corrected to CRU-L1 Ambitious Dream Station, has a distance', row?.match?.status === 'corrected' && placeOf(row) === 'CRU-L1 Ambitious Dream Station' && row.distance > 0, `match=${short(row?.match, 400)} distance=${row?.distance}`],
      ['evidence: name corrected / close spelling', /corrected|close spelling/i.test(short(row?.match?.evidence, 2000)), `evidence=${short(row?.match?.evidence, 500)}`],
      ['## MATCHES lists the Drearn text as corrected', m?.status === 'corrected', `m=${short(m, 300)}`],
      ...caseChecks,
      ['S4DC05 never matches Covalex S1DC06 (code tokens differ)', !/S1DC06/.test(placeOf(s4)), `status=${s4?.match?.status} place=${placeOf(s4)}`]
    ]
  },

  // CONTRACT7 C: after an export with pictures, COPY TEXT puts the saved text back on the clipboard and COPY IMAGES
  // puts the one stitched picture (<base>-all.png: side by side, 16 px gaps, top-aligned) there
  'diag-copy-buttons': async () => {
    const r = await diagExportRun('diag-copy-buttons', { note: '', includeImages: true }, async ({ port, iport }) => {
      const o = {}
      const step = async (k, f) => {
        try {
          o[k] = await f()
        } catch (x) {
          o[`${k}Err`] = String(x?.message ?? x)
        }
      }
      await step('sentinel', () => mainEval(iport, `(() => { const { clipboard } = require('electron'); clipboard.writeText('sentinel-before-copy'); return clipboard.readText() })()`))
      await step('copyText', () => cdpEval(port, 'main', 'window.supercargo.diagCopyText()'))
      await step('clipText', () => mainEval(iport, `require('electron').clipboard.readText()`))
      await step('cleared', () => mainEval(iport, `(() => { const { clipboard } = require('electron'); clipboard.clear(); return clipboard.readImage().isEmpty() })()`))
      await step('copyImages', () => cdpEval(port, 'main', 'window.supercargo.diagCopyImages()'))
      await step('clipSize', () => mainEval(iport, `require('electron').clipboard.readImage().getSize()`))
      return o
    })
    const x = r.extra ?? {}
    // PNG width/height from the IHDR chunk
    const pngSize = (f) => {
      try {
        const b = fs.readFileSync(f)
        return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
      } catch {
        return null
      }
    }
    const parts = (r.res?.images ?? []).filter((f) => !/-all\.png$/.test(f)).map(pngSize).filter(Boolean)
    const want = parts.length ? { width: parts.reduce((s, p) => s + p.width, 0) + 16 * (parts.length - 1), height: Math.max(...parts.map((p) => p.height)) } : null
    const all = r.res?.combinedImage
    const allSize = all ? pngSize(all) : null
    let bytes = null
    try {
      bytes = fs.statSync(r.res.path).size
    } catch {
      // checked below
    }
    const same = (a, b) => !!a && !!b && a.width === b.width && a.height === b.height
    return [
      ['export written with pictures', r.res?.ok === true && r.text != null && parts.length > 0, `result=${JSON.stringify(r.res)?.slice(0, 300)} ${r.err}`],
      ['combined picture <base>-all.png saved', !!all && path.basename(all) === path.basename(r.res.path).replace(/\.txt$/, '') + '-all.png' && !!allSize, `combinedImage=${all}`],
      ['combined size = side by side + 16 px gaps, tallest height', same(allSize, want), `all=${JSON.stringify(allSize)} want=${JSON.stringify(want)} parts=${JSON.stringify(parts)}`],
      ['IMAGES lists the combined picture', !!all && (r.text ?? '').includes(path.basename(all)) && /all pictures in one/i.test(r.sec['IMAGES'] ?? ''), `images=${JSON.stringify((r.sec['IMAGES'] ?? '(missing)').slice(0, 300))}`],
      ['clipboard set to a sentinel before COPY TEXT', x.sentinel === 'sentinel-before-copy', `sentinel=${x.sentinel} ${x.sentinelErr ?? ''}`],
      ['diagCopyText ok with the file size', x.copyText?.ok === true && x.copyText?.bytes === bytes, `result=${JSON.stringify(x.copyText)} file=${bytes} ${x.copyTextErr ?? ''}`],
      ['clipboard text equals the saved file', r.text != null && x.clipText === r.text, `clipboard=${String(x.clipText ?? '').length} chars file=${r.text?.length ?? null} chars`],
      ['diagCopyImages ok with the combined size', x.copyImages?.ok === true && same(x.copyImages, allSize), `result=${JSON.stringify(x.copyImages)} all=${JSON.stringify(allSize)} ${x.copyImagesErr ?? ''}`],
      ['clipboard image has the combined size', x.cleared === true && same(x.clipSize, allSize), `cleared=${x.cleared} clipboard=${JSON.stringify(x.clipSize)} all=${JSON.stringify(allSize)}`]
    ]
  },

  // CONTRACT7 C: the copy buttons before any export answer "no export yet"
  'diag-copy-none': async () => {
    const e = setup('diag-copy-none')
    const port = await freePort()
    const stop = await launch(e, cdpArgs(port))
    let t
    let i
    let err = ''
    try {
      t = await cdpEval(port, 'main', 'window.supercargo.diagCopyText()')
      i = await cdpEval(port, 'main', 'window.supercargo.diagCopyImages()')
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [
      ['diagCopyText: no export yet', t?.ok === false && t?.error === 'no export yet', `result=${JSON.stringify(t)} ${err}`],
      ['diagCopyImages: no export yet', i?.ok === false && i?.error === 'no export yet', `result=${JSON.stringify(i)} ${err}`]
    ]
  },

  // CONTRACT10 e2e 1: a scanned job whose place OCR misread. The confirm screen tags each place from importPlace
  // ("S1DCO6" -> '≈ corrected'; "Shubin Mining Facility on Lyria", code lost -> '? not sure'); the user fixes the unsure
  // one there (tag -> ✗ Wrong -> pick SAL-2) before CONFIRM; the saved stop uses the fix and keeps the text as read
  'resolver-scan-fix': async () => {
    const name = 'resolver-scan-fix'
    const TITLE = 'Resolver Scan Delivery'
    const id = mission()
    // the reward sits above the objectives on the contract screen (below them it reads as a wrapped objective line)
    const RAW = ['Reward 12,500 aUEC', 'Primary Objectives', `Deliver Scrap to ${SHUBIN}`, `Go to ${SCAN_COVALEX}`].join('\n')
    const e = setup(name, { otherStartMode: 'fixed' }, { jobs: [logJob(id, { ref: 'J93', title: TITLE, steps: [] })], history: [], listOrder: 'distance', startLocation: 'Lorville', startTypedAt: iso(ago(60)) })
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)])
    let scan = null
    let fix = null
    let fixed = ''
    let confirmed = false
    let jobsText = ''
    let err = ''
    try {
      scan = await scanToConfirm(port, iport, TITLE, RAW, TAG.unsure)
      // the S1DCO6 tag can still read "? not sure" for a moment after the Shubin tag shows (CI flake): poll for it
      const corrected = await until(() => windowText(port, 'main').then((t) => (TAG.corrected.test(confirmPart(t)) ? t : '')), 12000)
      if (corrected) scan.text = corrected
      fix = await uiWrongPick(port, 'main', TAG.unsure, 'SAL-2', SAL2)
      fixed = (await until(() => windowText(port, 'main').then((t) => (MEM_TAG.user.test(confirmPart(t)) ? t : '')), 8000)) || (await windowText(port, 'main'))
      confirmed = await clickButton(port, 'main', /^CONFIRM$/)
      await until(() => ((findJob(e.jobs(), id)?.steps?.length ?? 0) >= 2 ? true : null), 10000)
      jobsText = (await until(() => windowText(port, 'main').then((t) => (!/Step 1/.test(t) && MEM_TAG.user.test(t) ? t : '')), 8000)) || (await windowText(port, 'main'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const conf = confirmPart(scan?.text)
    const shubin = stepOf(e, id, /Shubin/i)
    const covalex = stepOf(e, id, /S1DC/i)
    const ent = memEntry(memFile(e), /Shubin Mining Facility on Lyria/i)
    return [
      ['UI: OCR stub, JOBS, job row, IMPORT FROM OCR, CAPTURE found', !!scan?.ui && Object.values(scan.ui).every(Boolean), `ui=${short(scan?.ui)} ${err}`],
      ['confirm screen: "≈ corrected" on the misread S1DCO6 place', TAG.corrected.test(conf), `confirm=${short(lineWith(conf, /S1DC|corrected|not sure/i), 600)}`],
      ['confirm screen: "? not sure" on the Shubin place', TAG.unsure.test(conf), `confirm=${short(lineWith(conf, /Shubin|not sure/i), 600)}`],
      ['confirm screen: tag, ✗ Wrong, picker and SAL-2 option found', !!fix?.tag && !!fix.wrong && !!fix.input && !!fix.option, `fix=${short(fix)}`],
      ['confirm screen: "✓ you set" after the fix, before CONFIRM', MEM_TAG.user.test(confirmPart(fixed)), `confirm=${short(lineWith(confirmPart(fixed), /Shubin|SAL-|you set|not sure/i), 600)}`],
      ['CONFIRM clicked', confirmed === true, `confirmed=${confirmed}`],
      ['other-matches.json: user entry for the text as read -> SAL-2 (saved before Confirm)', ent?.origin === 'user' && ent.place === SAL2, `entry=${short(ent, 400)}`],
      ['Shubin stop: text as read kept, place is the fix (SAL-2)', shubin?.locationRaw === SHUBIN && shubin.location === SAL2, `step=${short(shubin, 400)}`],
      ['Covalex stop: text as read kept ("S1DCO6"), never another place', covalex?.locationRaw === SCAN_COVALEX && [COVALEX, SCAN_COVALEX].includes(covalex.location), `step=${short(covalex, 400)}`],
      ['Jobs tab: the stop shows "✓ you set"', MEM_TAG.user.test(jobsText), `jobs=${short(lineWith(jobsText, /Shubin|SAL-|you set/i), 600)}`]
    ]
  },

  // CONTRACT10 e2e 2: a Game.log job whose place text looks like one unique roster name ("Covalex Distribution Center
  // S1DC06 on microTech": the old snap culled " on microTech" and renamed it to Hurston's S1DC06, so the stop showed
  // exact). Now the import keeps the text as read; the tag shows the real status ('✗ not found': the body disagrees)
  'resolver-log-no-rename': async () => {
    const name = 'resolver-log-no-rename'
    const { e, port, iport, stop } = await memLaunch(name)
    const id = mission()
    let next = ''
    let snap = null
    let err = ''
    try {
      e.append(L.accept(id, 'Med. Distance Covalex Delivery Stanton'), L.objective(id, `Deliver Scrap to ${MICROTECH_LOOKALIKE}`))
      await until(() => (findJob(e.jobs(), id)?.steps?.length ? true : null))
      next = await nextText(port, TAG.none)
      snap = snapshotJson(await exportNow(e, port, iport, name))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const step = findJob(e.jobs(), id)?.steps?.[0]
    const row = distRow(snap, /on microTech/i)
    return [
      ['step: text as read kept in locationRaw', step?.locationRaw === MICROTECH_LOOKALIKE, `step=${short(step, 400)} ${err}`],
      ['step: NOT renamed to the Hurston S1DC06 roster name', step?.location === MICROTECH_LOOKALIKE && !step.locationSnapped, `location=${step?.location} snapped=${step?.locationSnapped}`],
      ['Next tab: "✗ not found" tag (the real status, not exact)', TAG.none.test(next), `next=${short(lineWith(next, /S1DC|microTech|not found|exact/i))}`],
      ['table row: status none, no distance', row?.match?.status === 'none' && row.distance == null, `match=${short(row?.match, 400)} distance=${row?.distance}`]
    ]
  },

  // CONTRACT10 e2e 3: the typed start "S1DCO06" (O for 0) goes through the resolver: Covalex Distribution Centre
  // S1DC06, tagged '≈ corrected' next to STARTING AT and on the overlay's start line; distances are measured from it
  'resolver-typed-start': async () => {
    const r = await matchRun('resolver-typed-start', {
      jobs: [{ ref: 'J95', steps: [goStep('s1', 'Port Tressler')] }],
      typed: 'S1DCO06',
      // a bare code (no place words) is honestly a guess; either tag shows it isn't an exact match
      want: /STARTING AT[\s\S]{0,240}(≈\s*corrected|\?\s*guess)/i,
      overlayWant: /≈\s*corrected|\?\s*guess/i
    })
    const row = distRow(r.snap, /^Port Tressler$/)
    const want = rosterDist(COVALEX, 'Port Tressler')
    return [
      ['Next tab: "≈ corrected" or "? guess" next to STARTING AT', /≈\s*corrected|\?\s*guess/i.test(startPart(r.next)), `start=${short(startPart(r.next))} ${r.err}`],
      ['overlay: "≈ corrected" or "? guess" on the start line (the only stop is exact)', /≈\s*corrected|\?\s*guess/i.test(r.overlay), `overlay=${short(lineWith(r.overlay, /S1DC|start|corrected/i))}`],
      ['Port Tressler measured from Covalex S1DC06', row?.distance > 0 && (want == null || Math.abs(row.distance - want) / want < 0.05), `distance=${row?.distance} want=${want && Math.round(want)}`]
    ]
  },

  // CONTRACT10 e2e 4: one user entry ("Shubin Mining Facility on Lyria" -> SAL-2) applies to every lookup alike: a
  // Game.log job imported after it, a scan job's confirm screen and saved stop, and the typed start
  // CONTRACT11: Settings has a tab bar GENERAL | OTHER MODE. GENERAL keeps the vanilla sections and no Other rows;
  // OTHER MODE has the 5 headings in order, each larger than a GENERAL section title; the jump list scrolls to AFK;
  // the tab is remembered after a restart (settings.json otherSettingsTab); a toggle there still saves (otherShowRep)
  'settings-tabs': async () => {
    const e = setup('settings-tabs')
    const port = await freePort()
    let stop = await launch(e, cdpArgs(port))
    const r = { general: '', gen: null, other: '', oth: null, before: null, jumped: false, after: null, rep0: null, rep1: null, again: '', againProbe: null }
    let err = ''
    try {
      r.page = await clickButton(port, 'main', /^SETTINGS$/)
      r.general = (await until(() => windowText(port, 'main').then((t) => (/OCR CAPTURE/.test(t) && /ABOUT/.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
      r.gen = await settingsProbe(port)
      r.tabClicked = !!(await until(() => clickButton(port, 'main', /^OTHER MODE$/).then((ok) => ok || null), 8000))
      r.other = (await until(() => windowText(port, 'main').then((t) => (/afk/i.test(t) && /places\s*&\s*matching/i.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
      r.oth = await settingsProbe(port)
      r.before = await afkView(port)
      r.jumped = await clickJumpAfk(port)
      r.after = await until(() => afkView(port).then((v) => (v?.inView && (v.scrolled > (r.before?.scrolled ?? 0) || r.before?.inView) ? v : null)), 4000)
      r.after = r.after ?? (await afkView(port))
      r.rep0 = (await settingsGet(port))?.otherShowRep ?? true
      r.toggle = await clickRowToggle(port, /^show\b.*reputation/i)
      r.rep1 = (await until(() => settingsGet(port).then((x) => ((x?.otherShowRep ?? true) !== r.rep0 ? x : null)), 8000))?.otherShowRep ?? null
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    try {
      // same data folder: localStorage survives the restart; Settings opens on the remembered tab without a click
      const port2 = await freePort()
      stop = await launch(e, cdpArgs(port2))
      await clickButton(port2, 'main', /^SETTINGS$/)
      r.again = (await until(() => windowText(port2, 'main').then((t) => (/places\s*&\s*matching/i.test(t) ? t : '')), 10000)) || (await windowText(port2, 'main'))
      r.againProbe = await settingsProbe(port2)
    } catch (x) {
      err += ` restart: ${String(x?.message ?? x)}`
    }
    await stop()
    const saved = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(e.data, 'settings.json'), 'utf8'))
      } catch {
        return null
      }
    })()
    const genSize = r.gen?.game?.size ?? NaN
    const hs = r.oth?.headings ?? []
    const tops = hs.map((h) => h?.top ?? NaN)
    return [
      ['tab bar: GENERAL and OTHER MODE buttons', ['GENERAL', 'OTHER MODE'].every((t) => r.gen?.tabs?.includes(t)), `tabs=${short(r.gen?.tabs)} page=${r.page} ${err}`],
      ['GENERAL is the first-visit tab: vanilla sections shown', GENERAL_SECTIONS.every((t) => new RegExp(`^${t}$`, 'm').test(r.general)), `missing=${short(GENERAL_SECTIONS.filter((t) => !new RegExp(`^${t}$`, 'm').test(r.general)))}`],
      ['GENERAL has no Other rows', !OTHER_ROWS.test(r.general), `found=${short(lineWith(r.general, OTHER_ROWS))}`],
      ['GENERAL UPDATES: button CHECK FOR UPDATES (CONTRACT14 C)', /^\s*check for updates\s*$/im.test(r.general), `line=${short(lineWith(r.general, /update/i), 300)}`],
      ['OTHER MODE tab clicked: no vanilla sections, Other rows shown', r.tabClicked && !/^OCR CAPTURE$/m.test(r.other) && /Show reputation/i.test(r.other) && /DATA SOURCES/i.test(r.other) && /Learned places are on the LEARNED DATA tab/i.test(r.other), `clicked=${r.tabClicked} text=${short(r.other.slice(0, 300))}`],
      ['OTHER MODE: the 5 headings are there', hs.length === 5 && hs.every(Boolean), `headings=${short(hs.map((h) => h?.text ?? null))}`],
      ['OTHER MODE: sections jobs, distances, where, places, afk (data-other-section)', short(r.oth?.ids) === short(['jobs', 'distances', 'where', 'places', 'afk']), `ids=${short(r.oth?.ids)}`],
      ['GENERAL shows no OTHER MODE sections', !(r.gen?.ids ?? []).length, `ids=${short(r.gen?.ids)}`],
      ['OTHER MODE: headings in order Jobs, Distances, Where Am I, Places, AFK', tops.every((t, i) => i === 0 || t > tops[i - 1]), `tops=${short(tops)}`],
      ['OTHER MODE: every heading larger than a GENERAL section title', Number.isFinite(genSize) && hs.every((h) => h && h.size > genSize), `general=${genSize}px headings=${short(hs.map((h) => h?.size ?? null))}`],
      ['jump list AFK scrolls the AFK heading into view', r.jumped && !!r.after?.inView, `clicked=${r.jumped} before=${short(r.before)} after=${short(r.after)}`],
      ['toggle on OTHER MODE saves (otherShowRep flips)', r.rep1 !== null && r.rep1 === !r.rep0 && saved?.otherShowRep === !r.rep0, `ui=${short(r.toggle)} before=${r.rep0} after=${r.rep1} file=${saved?.otherShowRep}`],
      ['tab remembered after a restart (OTHER MODE open, no click)', /places\s*&\s*matching/i.test(r.again) && !/^OCR CAPTURE$/m.test(r.again), `stored=${JSON.stringify(e.settings?.()?.otherSettingsTab ?? null)} text=${short(r.again.slice(0, 300))}`]
    ]
  },

  'resolver-memory-everywhere': async () => {
    const name = 'resolver-memory-everywhere'
    const SCAN_TITLE = 'Resolver Memory Scan'
    const scanId = mission()
    const { e, port, iport, stop } = await memLaunch(name, {
      jobs: [{ ref: 'J92', steps: [goStep('s1', SHUBIN)] }, { ref: 'J96', title: SCAN_TITLE, steps: [], missionId: scanId, id: scanId }],
      typed: SHUBIN
    })
    const logId = mission()
    let next = ''
    let scan = null
    let confirmed = false
    let err = ''
    try {
      await memSetVia(port, /Shubin Mining Facility on Lyria/i, SAL2)
      e.append(L.accept(logId, 'Resolver Memory Log'), L.objective(logId, `Deliver Scrap to ${SHUBIN}`))
      await until(() => (findJob(e.jobs(), logId)?.steps?.length ? true : null))
      next = await nextText(port, /STARTING AT[\s\S]{0,240}✓\s*you set/i)
      scan = await scanToConfirm(port, iport, SCAN_TITLE, ['Primary Objectives', `Deliver Scrap to ${SHUBIN}`].join('\n'), MEM_TAG.user)
      confirmed = await clickButton(port, 'main', /^CONFIRM$/)
      await until(() => (findJob(e.jobs(), scanId)?.steps?.length ? true : null), 10000)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const logStep = findJob(e.jobs(), logId)?.steps?.[0]
    const scanStep = stepOf(e, scanId, /Shubin/i)
    return [
      ['user entry set (SAL-2)', memEntry(memFile(e), /Shubin Mining Facility on Lyria/i)?.place === SAL2, `entry=${short(memEntry(memFile(e), /Shubin/i), 300)} ${err}`],
      ['log job after the set: place SAL-2, text as read kept', logStep?.location === SAL2 && logStep.locationRaw === SHUBIN, `step=${short(logStep, 400)}`],
      ['typed start: "✓ you set" next to STARTING AT', MEM_TAG.user.test(startPart(next)), `start=${short(startPart(next))}`],
      ['scan confirm screen: "✓ you set" on the place', MEM_TAG.user.test(confirmPart(scan?.text)), `ui=${short(scan?.ui)} confirm=${short(lineWith(confirmPart(scan?.text), /Shubin|SAL-|you set|not sure/i), 500)}`],
      ['scan job after CONFIRM: place SAL-2, text as read kept', confirmed && scanStep?.location === SAL2 && scanStep.locationRaw === SHUBIN, `confirmed=${confirmed} step=${short(scanStep, 400)}`]
    ]
  },

  // CONTRACT12 (main tab LEARNED DATA): the tab is in the bottom menu in Other mode only; Settings → OTHER MODE keeps one
  // line + OPEN LEARNED DATA (no list); the summary counts match other-matches.json; the open '? not sure' stop is in
  // "Needs your eye" and is fixed there (✗ Wrong → SAL-2); disputed entries: KEEP MINE clears the dispute, USE WHERE I
  // WAS sets the place you were; the table sorts by TIMES SEEN; Sites and Planets show other-bodies.json; MatchFix
  // "Open in Learned Data" lands on the stop's entry. A Haul-mode launch has no LEARNED DATA button.
  'learned-data-tab': async () => {
    const name = 'learned-data-tab'
    const at = iso(ago(3600))
    const ent = (key, text, place, origin, extra = {}) => ({ key, text, place, origin, confirmed: 0, wrong: 0, seen: 1, firstAt: at, lastAt: at, ...extra })
    const matchesDoc = {
      entries: [
        ent('seed-user', 'Port Tresler Gate 3', 'Port Tressler', 'user', { seen: 5 }),
        ent('seed-learned', 'Seraphim Stn Hab', 'Seraphim Station', 'game', { confirmed: 3, seen: 9 }),
        ent('seed-unproven', 'Covalex S1DCO06 Hurstn', COVALEX, 'game', { seen: 2 }),
        ent('seed-keep', 'Shubin SAL 5 Lyria', 'Shubin Mining Facility SAL-5', 'user', { confirmed: 1, wrong: 2, disputed: true, seen: 4, wrongAt: [{ name: COVALEX, meters: 120, at }, { name: COVALEX, meters: 140, at }] }),
        ent('seed-use', 'Shubin SAL 2 Lyria', SAL2, 'user', { wrong: 2, disputed: true, seen: 3, wrongAt: [{ name: 'Port Tressler', meters: 300, at }, { name: 'Port Tressler', meters: 280, at }] })
      ],
      changes: []
    }
    const P = { x: 12850457093, y: 0, z: 0 }
    const bodiesDoc = {
      bodies: { hurston: { name: 'Hurston', system: 'Stanton', centre: P, radiusM: 1000000, radiusSource: 'panel', seen: 3, lastSeen: at } },
      learned: [{ name: 'Security Compound', near: COVALEX, nearMeters: 850, body: 'Hurston', system: 'Stanton', point: { x: P.x + 1000, y: 0, z: 0 }, seen: 2, lastSeen: at }]
    }
    const { e, port, stop } = await memLaunch(name, {
      jobs: [{ ref: 'J92', steps: [goStep('s1', SHUBIN)] }],
      files: { 'other-matches.json': matchesDoc, 'other-bodies.json': bodiesDoc }
    })
    const r = { nav: null, settings: '', link: false, p0: null, file0: null, filter: null, filtered: null, ui: null, p1: null, keep: null, use: null, sort1: null, sort2: null, open: false, fixTag: false, view: null, key: null }
    let err = ''
    const seedOrder = (p) => (p?.rows ?? []).map((x) => x.key).filter((k) => ['seed-user', 'seed-learned', 'seed-unproven'].includes(k))
    try {
      r.nav = await until(() => navButtons(port).then((b) => (b?.includes('SETTINGS') ? b : null)), 10000)
      // the live stop's "seen" entry first, so the counts below are stable
      await until(() => memGet(port).then((d) => memEntry(d, /Shubin Mining Facility on Lyria/i) ?? null), 15000)
      await openSettingsTab(port, 'OTHER MODE')
      r.settings = (await until(() => windowText(port, 'main').then((t) => (/places\s*&\s*matching/i.test(t) && /DATA SOURCES/i.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
      r.settingsRows = await cdpEval(port, 'main', `document.querySelectorAll('tr[data-testid="learned-row"]').length`)
      r.link = await clickButton(port, 'main', /^OPEN LEARNED DATA$/)
      // S1: summary counts vs main's doc (read together; the seen reporter may still add the stop's entry)
      const pair = await until(async () => {
        const p = await learnedProbe(port)
        const d = await memGet(port)
        return p?.rows?.length && sameCounts(p.counts, memCounts(d)) ? { p, d } : null
      }, 10000)
      r.p0 = pair?.p ?? (await learnedProbe(port))
      r.file0 = memCounts(pair?.d ?? (await memGet(port)))
      // the disputed number filters the table; a second click shows all again
      r.filter = await clickSel(port, '[data-testid="learned-count-disputed"]')
      r.filtered = await until(() => learnedProbe(port).then((p) => (p?.rows?.length && p.rows.every((x) => x.kind === 'disputed') ? p : null)), 5000)
      r.filtered = r.filtered ?? (await learnedProbe(port))
      await clickSel(port, '[data-testid="learned-count-disputed"]')
      // S2: Needs your eye, fixed there (its tag -> ✗ Wrong -> SAL-2)
      r.ui = await uiWrongPick(port, 'main', TAG.unsure, 'SAL-2', SAL2)
      await until(() => (memEntry(memFile(e), /Shubin Mining Facility on Lyria/i)?.place === SAL2 ? true : null), 10000)
      r.p1 = (await until(() => learnedProbe(port).then((p) => (p && !p.needs.some((x) => /Shubin Mining Facility on Lyria/.test(x.text)) ? p : null)), 8000)) ?? (await learnedProbe(port))
      // S3: disputed entries
      r.keep = await clickRowButton(port, 'seed-keep', /^KEEP MINE$/i)
      await until(() => (memEntry(memFile(e), /Shubin SAL 5 Lyria/)?.wrong === 0 ? true : null), 10000)
      r.use = await clickRowButton(port, 'seed-use', /^USE WHERE I WAS$/i)
      await until(() => (memEntry(memFile(e), /Shubin SAL 2 Lyria/)?.place === 'Port Tressler' ? true : null), 10000)
      // S4: sort by TIMES SEEN (first click: most seen first), then the other way
      r.sortClick1 = await clickSel(port, 'th[data-sort="seen"]')
      await sleep(400)
      r.sort1 = seedOrder(await learnedProbe(port))
      r.sortClick2 = await clickSel(port, 'th[data-sort="seen"]')
      await sleep(400)
      r.sort2 = seedOrder(await learnedProbe(port))
      // S7: MatchFix on the Next tab -> Open in Learned Data -> the entry's row, scrolled into view and lit
      r.key = memEntry(await memGet(port), /Shubin Mining Facility on Lyria/i)?.key ?? null
      await nextText(port, MEM_TAG.user)
      r.fixTag = await clickButton(port, 'main', MEM_TAG.user)
      r.open = !!(await until(() => clickSel(port, '[data-testid="matchfix-open-learned"]').then((ok) => ok || null), 5000))
      r.view = (await until(() => learnedRowView(port, r.key).then((v) => (v?.inView && v.marked ? v : null)), 3500)) ?? (await learnedRowView(port, r.key))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    // Haul mode: no LEARNED DATA in the bottom menu
    let haulNav = null
    try {
      const h = setup(`${name}-haul`, { workMode: 'haul' })
      const hport = await freePort()
      const hstop = await launch(h, cdpArgs(hport))
      haulNav = await until(() => navButtons(hport).then((b) => (b?.includes('SETTINGS') ? b : null)), 10000)
      await hstop()
    } catch (x) {
      err += ` haul: ${String(x?.message ?? x)}`
    }
    const file = memFile(e)
    const keep = memEntry(file, /Shubin SAL 5 Lyria/)
    const use = memEntry(file, /Shubin SAL 2 Lyria/)
    const shubin = memEntry(file, /Shubin Mining Facility on Lyria/i)
    const needs0 = (r.p0?.needs ?? []).find((x) => /Shubin Mining Facility on Lyria/.test(x.text))
    const sites = (r.p1?.sites ?? []).join(' | ')
    const planets = r.p1?.planets ?? []
    // the planet itself, not a moon such as "Aberdeen of Hurston"
    const hurston = planets.find((x) => /^\s*Hurston/.test(x)) ?? ''
    return [
      ['Other bottom menu: NEXT JOBS HISTORY LEARNED DATA SETTINGS', short(r.nav) === short(['NEXT', 'JOBS', 'HISTORY', 'LEARNED DATA', 'SETTINGS']), `nav=${short(r.nav)} ${err}`],
      ['Haul bottom menu: no LEARNED DATA', !!haulNav && !haulNav.includes('LEARNED DATA'), `nav=${short(haulNav)}`],
      ['Settings OTHER MODE: the line, no learned list', /Learned places are on the LEARNED DATA tab\./.test(r.settings) && r.settingsRows === 0 && !/RECENT CHANGES/i.test(r.settings), `rows=${r.settingsRows} places=${short(lineWith(r.settings, /learned|RECENT/i))}`],
      ['OPEN LEARNED DATA opens the tab: Places, Sites, Planets', r.link && short(r.p0?.sections) === short(['places', 'sites', 'planets']), `clicked=${r.link} sections=${short(r.p0?.sections)}`],
      ['summary counts match other-matches.json (one bucket per entry)', sameCounts(r.p0?.counts, r.file0) && r.file0.disputed === 2 && r.file0.learned === 1, `summary=${short(r.p0?.counts)} file=${short(r.file0)}`],
      ['disputed number filters the table to the disputed rows', r.filter && (r.filtered?.rows ?? []).length === 2 && r.filtered.rows.every((x) => x.kind === 'disputed'), `rows=${short((r.filtered?.rows ?? []).map((x) => [x.key, x.kind]))}`],
      ['disputed pinned on top with "you were at Covalex …"', ['seed-keep', 'seed-use'].every((k, i, a) => (r.p0?.rows ?? []).slice(0, a.length).some((x) => x.key === k)) && (r.p0?.where ?? []).some((w) => /you were at Covalex Distribution Centre S1DC06/i.test(w)), `top=${short((r.p0?.rows ?? []).slice(0, 3).map((x) => x.key))} where=${short(r.p0?.where)}`],
      ['Needs your eye: the open stop with its job ref and "? not sure"', !!needs0 && /J92/.test(needs0.text) && TAG.unsure.test(needs0.text), `needs=${short(r.p0?.needs, 500)}`],
      ['Needs your eye: fixed there (tag, ✗ Wrong, SAL-2) -> user entry, row gone', !!r.ui?.option && shubin?.origin === 'user' && shubin.place === SAL2 && !(r.p1?.needs ?? []).some((x) => /Shubin Mining Facility on Lyria/.test(x.text)), `ui=${short(r.ui)} entry=${short(shubin, 300)} needs=${short(r.p1?.needs)}`],
      ['KEEP MINE: place kept, wrong 0, no wrongAt, not disputed, confirmed kept', !!r.keep?.button && keep?.origin === 'user' && keep.place === 'Shubin Mining Facility SAL-5' && keep.wrong === 0 && !(keep.wrongAt ?? []).length && !keep.disputed && keep.confirmed === 1, `ui=${short(r.keep)} entry=${short(keep, 400)}`],
      ['USE WHERE I WAS: user entry -> Port Tressler', !!r.use?.button && use?.origin === 'user' && use.place === 'Port Tressler', `ui=${short(r.use)} entry=${short(use, 400)}`],
      ['both logged as user "set" changes with before/after (UNDO works)', ['seed-keep', 'seed-use'].every((k) => (file?.changes ?? []).some((c) => c.key === k && c.what === 'set' && c.by === 'user' && c.before && c.after)), `changes=${short((file?.changes ?? []).map((c) => [c.key, c.what]))}`],
      ['sort by TIMES SEEN: most first, then least first', r.sortClick1 && r.sortClick2 && short(r.sort1) === short(['seed-learned', 'seed-user', 'seed-unproven']) && short(r.sort2) === short(['seed-unproven', 'seed-user', 'seed-learned']), `first=${short(r.sort1)} second=${short(r.sort2)}`],
      ['Sites: Security Compound at Covalex (850 m), Hurston', /Security Compound/.test(sites) && /Covalex/.test(sites) && /850\s*m|0[.,]85\s*km/.test(sites) && /Hurston/.test(sites), `sites=${short(r.p1?.sites)}`],
      ['Planets: Hurston, Stanton, 1,000 km exact (panel); others estimated', /Stanton/.test(hurston) && /1[,.\s]?000\s*km/.test(hurston) && /exact \(panel\)/i.test(hurston) && planets.some((x) => /estimated/i.test(x)), `hurston=${short(hurston)} planets=${planets.length}`],
      ['MatchFix "Open in Learned Data": tag and link found', r.fixTag && r.open, `tag=${r.fixTag} link=${r.open} key=${r.key}`],
      ['lands on the entry: row in view and lit', !!r.view?.inView && !!r.view.marked, `view=${short(r.view)}`]
    ]
  },

  // Batch 12 (CONTRACT13): the data folder. App files land in <HOME>/SuperCargo (settings.json too), never in Electron's
  // userData; the old %APPDATA% folder is neither read nor written (fresh start). CHANGE… to an empty folder copies the
  // data (a folder that already holds SuperCargo data is used as is, nothing overwritten), saves settings.dataFolder
  // in the default folder's settings.json and asks for a restart; after the restart the app uses the new folder. A
  // chosen folder that can't be used falls back to the default with the reason shown in Settings → GENERAL.
  'data-folder': async () => {
    const name = 'data-folder'
    const e = setup(name)
    const legacy = legacyDataDir(e.home)
    const LEGACY_ID = '00000000-0000-4000-8000-1e6ac9000001'
    fs.mkdirSync(legacy, { recursive: true })
    const legacyJobs = JSON.stringify({ jobs: [logJob(LEGACY_ID)], history: [] })
    fs.writeFileSync(path.join(legacy, 'other-jobs.json'), legacyJobs)
    // CONTRACT14 A: CHANGE… uses the picked folder AS IS (no SuperCargo subfolder is made in it)
    const pickedMoved = path.join(e.home, 'Moved Data') // a space in the path, as Windows user folders often have
    fs.mkdirSync(pickedMoved, { recursive: true })
    // Q6: a folder holding only a logs folder (and an empty exports folder) is not SuperCargo data: CHANGE… still
    // copies the current data in, and the user's own file inside logs/ is left as it was
    const OWN_LOG = path.join(pickedMoved, 'logs', 'my-own-notes.txt')
    const OWN_LOG_TEXT = 'not a SuperCargo file\n'
    fs.mkdirSync(path.dirname(OWN_LOG), { recursive: true })
    fs.writeFileSync(OWN_LOG, OWN_LOG_TEXT)
    fs.mkdirSync(path.join(pickedMoved, 'exports'), { recursive: true })
    const moved = pickedMoved
    const existing = path.join(e.home, 'Existing')
    fs.mkdirSync(existing, { recursive: true })
    const existingJobs = JSON.stringify({ jobs: [], history: [], marker: 'keep-me' })
    fs.writeFileSync(path.join(existing, 'other-jobs.json'), existingJobs)
    // a chosen folder that is gone at start-up (drive unplugged, folder deleted): never recreated, default used with the reason
    const bad = path.join(e.home, 'Unplugged Drive', 'Data')
    const id1 = mission()
    const id2 = mission()
    const r = { ready1: false, ready2: false, ready3: false, ud: null, info1: null, gen1: '', choseExisting: null, chose: null, relaunch: null, info2: null, gen3: '', info3: null }
    let err = ''
    // answer the folder picker with `dir`; a confirm box gets its first non-restart, non-cancel button; relaunch/exit
    // are recorded, not done (the harness restarts the app itself)
    const stubMain = stubFolderPick
    const generalText = async (port, re) => {
      await openSettingsTab(port, 'GENERAL')
      return (await until(() => windowText(port, 'main').then((t) => (re.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
    }
    // phase 1: a fresh start on the default folder
    try {
      const port = await freePort()
      const iport = await freePort()
      const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)])
      r.ready1 = stop.ready
      try {
        r.ud = await mainEval(iport, `require('electron').app.getPath('userData')`)
        e.append(L.accept(id1, 'Bounty Hunt'), L.objective(id1, 'Go to Port Tressler'))
        await until(() => findJob(e.jobs(), id1))
        r.info1 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
        r.gen1 = await generalText(port, /DATA FOLDER/)
        await stubMain(iport, existing)
        r.choseExisting = await cdpEval(port, 'main', 'window.supercargo.chooseDataFolder()', 30000)
        await stubMain(iport, pickedMoved)
        r.chose = await cdpEval(port, 'main', 'window.supercargo.chooseDataFolder()', 30000)
        r.info2 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
        await cdpEval(port, 'main', 'window.supercargo.restartForDataFolder()').catch(() => null)
        r.relaunch = await mainEval(iport, 'globalThis.__scRestart')
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase1: ${String(x?.message ?? x)}`
    }
    const set1 = e.settings()
    const movedJobs1 = readJsonIn(moved, 'other-jobs.json')
    // phase 2: the restart (done by the harness) runs on the moved folder
    const e2 = { ...e, data: moved }
    try {
      const port = await freePort()
      const stop = await launch(e2, cdpArgs(port))
      r.ready2 = stop.ready
      try {
        e.append(L.accept(id2, 'Bounty Hunt'), L.objective(id2, 'Go to Ruin Station'))
        await until(() => findJob(readJsonIn(moved, 'other-jobs.json'), id2))
        r.info3 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase2: ${String(x?.message ?? x)}`
    }
    const movedJobs2 = readJsonIn(moved, 'other-jobs.json')
    const defaultJobs2 = e.jobs()
    // phase 3: the chosen folder can't be used -> the default folder, with the reason
    let info4 = null
    try {
      fs.writeFileSync(path.join(e.data, 'settings.json'), JSON.stringify({ ...(e.settings() ?? {}), dataFolder: bad }))
      fs.rmSync(bad, { recursive: true, force: true })
      const port = await freePort()
      const stop = await launch(e, cdpArgs(port))
      r.ready3 = stop.ready
      try {
        info4 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
        r.gen3 = await generalText(port, /DATA FOLDER/)
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase3: ${String(x?.message ?? x)}`
    }
    const appFiles = ['settings.json', 'other-jobs.json', path.join('logs', 'supercargo.log'), 'window-state.json', 'history.json', 'manifest.json', 'other-matches.json', 'upload-queue.json']
    const inUd = r.ud ? appFiles.filter((f) => !(f === 'other-jobs.json' && path.resolve(r.ud) === path.resolve(legacy)) && fs.existsSync(path.join(r.ud, f))) : ['(no userData path)']
    const legacyNow = (() => {
      try {
        return fs.readFileSync(path.join(legacy, 'other-jobs.json'), 'utf8')
      } catch {
        return null
      }
    })()
    const dataFolderLine = lineWith(r.gen1, /SuperCargo-OtherModes|default/i)
    const subfolders = ['SuperCargo', DATA_FOLDER_NAME].filter((n) => fs.existsSync(path.join(pickedMoved, n)) || fs.existsSync(path.join(existing, n)))
    const same = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b)
    return [
      ['app starts on the default folder: its log is in HOME/SuperCargo-OtherModes/logs', r.ready1 && fs.existsSync(path.join(e.data, 'logs', 'supercargo.log')), `ready=${r.ready1} ${err}`],
      ['jobs saved in HOME/SuperCargo-OtherModes/other-jobs.json', !!findJob(readJsonIn(e.data, 'other-jobs.json'), id1), `jobs=${short(e.jobs()?.jobs?.map((j) => j.missionId))}`],
      ['settings.json read from HOME/SuperCargo-OtherModes (gameLogPath used, Other mode)', e.settings()?.gameLogPath === e.gameLog && !!findJob(e.jobs(), id1), `settings=${short(e.settings(), 200)}`],
      ['no app files in Electron userData', !!r.ud && !same(r.ud, e.data) && inUd.length === 0, `userData=${r.ud} found=${short(inUd)}`],
      ['fresh start: the old folder is not read (its job is not imported) nor written', !findJob(e.jobs(), LEGACY_ID) && legacyNow === legacyJobs, `imported=${!!findJob(e.jobs(), LEGACY_ID)} oldFileSame=${legacyNow === legacyJobs}`],
      ['getDataFolder: default folder, isDefault, no fallback', same(r.info1?.folder, e.data) && r.info1?.isDefault === true && !r.info1?.fallback && same(r.info1?.defaultFolder, e.data), `info=${short(r.info1)}`],
      ['Settings GENERAL shows DATA FOLDER with the folder and "default"', /^DATA FOLDER$/m.test(r.gen1) && r.gen1.includes(e.data) && /default/i.test(dataFolderLine), `line=${short(dataFolderLine, 300)}`],
      ['CHANGE to a folder with SuperCargo data: used as is, nothing overwritten', r.choseExisting?.ok === true && r.choseExisting?.usedExisting === true && (r.choseExisting?.copied ?? 0) === 0 && fs.readFileSync(path.join(existing, 'other-jobs.json'), 'utf8') === existingJobs, `result=${short(r.choseExisting, 300)}`],
      ['Q6 CHANGE to a folder with only logs/ (+ exports/): not treated as SuperCargo data, the data is copied', r.chose?.ok === true && r.chose?.usedExisting !== true && (r.chose?.copied ?? 0) > 0, `result=${short(r.chose, 300)}`],
      ['Q6 the folder\'s own file in logs/ is untouched (after the copy and the restart)', readText(OWN_LOG) === OWN_LOG_TEXT, `text=${short(readText(OWN_LOG))}`],
      ['CHANGE to an empty folder (only logs/, exports/) copies the data (jobs file with the job)', r.chose?.ok === true && (r.chose?.copied ?? 0) > 0 && !!findJob(movedJobs1, id1), `result=${short(r.chose, 300)} movedJobs=${short(movedJobs1?.jobs?.map((j) => j.missionId))}`],
      ['CHANGE uses the picked folder as is (no subfolder made in it)', same(r.chose?.info?.pending ?? r.info2?.pending, pickedMoved) && subfolders.length === 0, `pending=${r.chose?.info?.pending ?? r.info2?.pending} subfolders=${short(subfolders)}`],
      ['settings.dataFolder saved in the default folder settings.json', same(set1?.dataFolder, moved), `dataFolder=${set1?.dataFolder}`],
      ['the change waits for a restart (pending), RESTART relaunches', same(r.info2?.pending, moved) && same(r.info2?.folder, e.data) && (r.relaunch?.relaunch ?? 0) >= 1, `info=${short(r.info2)} restart=${short(r.relaunch)}`],
      ['after the restart the app uses the moved folder (log, jobs)', r.ready2 && same(r.info3?.folder, moved) && r.info3?.isDefault === false && !!findJob(movedJobs2, id1) && !!findJob(movedJobs2, id2), `ready=${r.ready2} info=${short(r.info3)} jobs=${short(movedJobs2?.jobs?.map((j) => j.missionId))}`],
      ['after the restart nothing new is written to the default folder jobs file', !findJob(defaultJobs2, id2), `defaultJobs=${short(defaultJobs2?.jobs?.map((j) => j.missionId))}`],
      ['missing chosen folder: runs on the default with the reason', r.ready3 && same(info4?.folder, e.data) && info4?.isDefault === true && typeof info4?.fallback === 'string' && info4.fallback.includes(bad), `ready=${r.ready3} info=${short(info4, 400)}`],
      ['missing chosen folder is not recreated', !fs.existsSync(bad), `exists=${fs.existsSync(bad)}`],
      ['Settings GENERAL shows the fallback reason', r.gen3.includes(bad) || /could not be used|unavailable|fall(s|ing)? ?back/i.test(lineWith(r.gen3, /folder|default|could/i)), `text=${short(lineWith(r.gen3, /folder|default|could|SuperCargo/i), 400)}`]
    ]
  },

  // CONTRACT14 A: damaged SuperCargo data at start-up -> native box -> Reset moves every SuperCargo file into
  // "Moved for Repair\<date>" (settings.json stays) and the app starts; CHANGE to a folder with damaged data shows the
  // inline warning: CANCEL keeps the old folder, RESET AND CONTINUE moves its files aside and copies the current data in.
  'damaged-data': async () => {
    const name = 'damaged-data'
    const e = setup(name)
    const BROKEN = '{ "entries": [ broken'
    fs.writeFileSync(path.join(e.data, 'history.json'), BROKEN)
    const OLD_ID = '00000000-0000-4000-8000-da0a9ed00001'
    fs.writeFileSync(path.join(e.data, 'other-jobs.json'), JSON.stringify({ jobs: [logJob(OLD_ID)], history: [] }))
    const settingsBefore = readText(path.join(e.data, 'settings.json'))
    // a picked folder whose SuperCargo data can't be read
    const target = path.join(e.home, 'Damaged Target')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'history.json'), BROKEN)
    const targetJobs = JSON.stringify({ jobs: [], history: [], marker: 'old-target' })
    fs.writeFileSync(path.join(target, 'other-jobs.json'), targetJobs)
    const stub = dialogStubEnv(e.home, /^reset and continue$/)
    const id = mission()
    const r = { ready: false, info0: null, warn1: '', cancel: null, warn1Gone: false, info1: null, warn2: '', reset: null, msg: '', info2: null }
    let err = ''
    try {
      const port = await freePort()
      const iport = await freePort()
      const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)], stub.env)
      r.ready = stop.ready
      try {
        e.append(L.accept(id, 'Bounty Hunt'), L.objective(id, 'Go to Port Tressler'))
        await until(() => findJob(e.jobs(), id))
        r.info0 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
        const change = async () => {
          await stubFolderPick(iport, target)
          await openSettingsTab(port, 'GENERAL')
          await until(() => clickButton(port, 'main', /^CHANGE(…|\.\.\.)?$/i).then((ok) => ok || null), 8000)
          return (await until(() => windowText(port, 'main').then((t) => (/RESET AND CONTINUE/i.test(t) ? t : '')), 15000)) || (await windowText(port, 'main'))
        }
        r.warn1 = await change()
        r.cancel = await clickButton(port, 'main', /^CANCEL$/i)
        r.warn1Gone = !!(await until(() => windowText(port, 'main').then((t) => !/RESET AND CONTINUE/i.test(t)), 8000))
        r.info1 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
        r.targetAfterCancel = readText(path.join(target, 'history.json'))
        r.dfAfterCancel = e.settings()?.dataFolder ?? null
        r.movedAfterCancel = repairFolders(target).length
        r.warn2 = await change()
        r.reset = await clickButton(port, 'main', /^RESET AND CONTINUE$/i)
        r.msg = (await until(() => windowText(port, 'main').then((t) => (/Moved the old files to/i.test(t) ? t : '')), 15000)) || (await windowText(port, 'main'))
        r.info2 = await cdpEval(port, 'main', 'window.supercargo.getDataFolder()')
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` ${String(x?.message ?? x)}`
    }
    const boxes = stub.boxes()
    const box = boxes.find((b) => /can.t be read/i.test(String(b.title))) ?? boxes[0]
    const moved0 = repairFolders(e.data)
    const m0 = moved0[0]
    const movedT = repairFolders(target)
    const mT = movedT[0]
    const set = e.settings()
    const same = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b)
    const warnLine = lineWith(r.warn1, /history\.json|RESET AND CONTINUE|can.t be read|damaged/i)
    return [
      ['start-up box: title "SuperCargo data can\'t be read", lists history.json, buttons Reset and continue / Quit', !!box && /SuperCargo data can.t be read/i.test(String(box.title)) && /history\.json/.test(`${box.message} ${box.detail}`) && /^reset and continue$/i.test(String(box.buttons?.[0] ?? '')) && (box.buttons ?? []).some((b) => /^quit$/i.test(b)), `boxes=${short(boxes, 600)} ${err}`],
      ['start-up box: default and cancel are Quit', !!box && /^quit$/i.test(String(box.buttons?.[box.defaultId] ?? '')) && /^quit$/i.test(String(box.buttons?.[box.cancelId] ?? '')), `defaultId=${box?.defaultId} cancelId=${box?.cancelId}`],
      ['start-up box detail names the folder and "Moved for Repair"', !!box && String(box.detail).includes(e.data) && /Moved for Repair/.test(String(box.detail)) && /settings are kept/i.test(String(box.detail)), `detail=${short(box?.detail, 300)}`],
      ['Reset: one "Moved for Repair\\<YYYY-MM-DD HH-MM>" folder with the damaged history.json', moved0.length === 1 && readText(path.join(m0 ?? '', 'history.json')) === BROKEN, `folders=${short(moved0.map((f) => path.basename(f)))}`],
      ['Reset moves ALL SuperCargo files (the good jobs file too), keeps settings.json', !!m0 && !!findJob(readJsonIn(m0, 'other-jobs.json'), OLD_ID) && !fs.existsSync(path.join(m0, 'settings.json')) && readText(path.join(e.data, 'settings.json')) !== null && !findJob(e.jobs(), OLD_ID), `moved=${short(m0 ? fs.readdirSync(m0) : null)} defaultJobs=${short(e.jobs()?.jobs?.map((j) => j.missionId))}`],
      ['settings kept as they were (gameLogPath, workMode)', set?.gameLogPath === e.gameLog && set?.workMode === 'other' && !!settingsBefore, `settings=${short(set, 200)}`],
      ['app starts after Reset with empty data and keeps working (new job saved)', r.ready && !!findJob(e.jobs(), id), `ready=${r.ready} jobs=${short(e.jobs()?.jobs?.map((j) => j.missionId))}`],
      ['CHANGE to a folder with damaged data: inline warning lists history.json with RESET AND CONTINUE / CANCEL', /history\.json/.test(r.warn1) && /RESET AND CONTINUE/i.test(r.warn1) && /^CANCEL$/im.test(r.warn1), `line=${short(warnLine, 400)}`],
      ['CANCEL: warning gone, old folder kept, nothing saved or pending, target untouched', !!r.cancel && r.warn1Gone && same(r.info1?.folder, e.data) && !r.info1?.pending && !r.dfAfterCancel && r.targetAfterCancel === BROKEN && r.movedAfterCancel === 0, `cancel=${r.cancel} gone=${r.warn1Gone} info=${short(r.info1)} dataFolder=${r.dfAfterCancel} moved=${r.movedAfterCancel}`],
      ['RESET AND CONTINUE: target files moved into its "Moved for Repair\\<date>" (history.json, jobs)', /RESET AND CONTINUE/i.test(r.warn2) && r.reset && movedT.length === 1 && readText(path.join(mT ?? '', 'history.json')) === BROKEN && readText(path.join(mT ?? '', 'other-jobs.json')) === targetJobs, `folders=${short(movedT.map((f) => path.basename(f)))}`],
      ['RESET AND CONTINUE: current data copied in, folder saved, restart pending', !!findJob(readJsonIn(target, 'other-jobs.json'), id) && same(e.settings()?.dataFolder, target) && same(r.info2?.pending, target), `targetJobs=${short(readJsonIn(target, 'other-jobs.json')?.jobs?.map((j) => j.missionId))} dataFolder=${e.settings()?.dataFolder} info=${short(r.info2)}`],
      ['message "Moved the old files to <movedTo>. Copied N files."', /Moved the old files to .+\. Copied \d+ files?\./.test(r.msg) && (!mT || r.msg.includes(mT)), `line=${short(lineWith(r.msg, /Moved the old files/), 400)}`]
    ]
  },

  // CONTRACT14 B/C: the Check for Updates window with SC_TEST_UPDATE_FEED (no network): opens by itself at start-up
  // with What's new of 2 versions, Skip This Version keeps the next start quiet, Check for Updates by hand shows it
  // again, Update Now -> progress -> ready -> Install and Restart; failed download, no notes, zip copy, up to date,
  // Updated notice.
  'update-window': async () => {
    const V1 = bumpMinor(APP_VERSION, 1)
    const V2 = bumpMinor(APP_VERSION, 2)
    const NOTES = [
      { version: V2, markdown: '### New\n- Second release **bold feature**\n- Another new line' },
      { version: V1, markdown: '### Fixed\n- First release fix' }
    ]
    const OLD = '0.9.0'
    const e = setup('update-window', { autoCheckUpdates: true, lastRunVersion: OLD })
    const feed = updateFeed(e, 'feed-available.json', { version: V2, notes: NOTES })
    const env = { SC_TEST_UPDATE_FEED: feed }
    const r = { p1: '', notice: '', whats: false, states: [], ready: '', install: null, p2: '', skip: null, skipped: null, p3: '', p3state: null, noticeAgain: '', byHand: '', clickedCheck: false }
    let err = ''
    // phase 1: start-up check -> window opens by itself; Updated notice (lastRunVersion older); Update Now -> Install
    try {
      const port = await freePort()
      const stop = await launch(e, cdpArgs(port), env)
      try {
        await recordUpdates(port)
        r.p1 = (await until(() => appText(port).then((t) => (AVAILABLE(V2).test(t) && WHATS_NEW(V1).test(t) ? t : '')), 20000)) || (await appText(port))
        r.notice = r.p1
        r.whats = await uiHas(port, BTN.whatsNew)
        r.clicked = await uiClick(port, BTN.updateNow)
        await until(() => updStates(port).then((s) => s.some((x) => x.kind === 'ready')), 15000)
        r.states = await updStates(port)
        r.ready = (await until(() => appText(port).then((t) => (/Downloaded and checked/i.test(t) ? t : '')), 8000)) || (await appText(port))
        r.readyBtns = { install: await uiHas(port, BTN.install), later: await uiHas(port, BTN.later) }
        r.install = await uiClick(port, BTN.install)
        await until(() => /update install \(test\)/.test(e.log()), 8000)
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase1: ${String(x?.message ?? x)}`
    }
    const set1 = e.settings()
    // phase 2: next start offers it again -> Skip This Version
    try {
      const port = await freePort()
      const stop = await launch(e, cdpArgs(port), env)
      try {
        r.p2 = (await until(() => appText(port).then((t) => (AVAILABLE(V2).test(t) ? t : '')), 20000)) || (await appText(port))
        r.noticeAgain = r.p2
        r.skip = await uiClick(port, BTN.skip)
        r.skipped = (await until(() => (e.settings()?.skippedUpdateVersion === V2 ? e.settings() : null), 8000))?.skippedUpdateVersion ?? e.settings()?.skippedUpdateVersion ?? null
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase2: ${String(x?.message ?? x)}`
    }
    // phase 3: start-up stays quiet for the skipped version; Check for Updates by hand shows it
    try {
      const port = await freePort()
      const stop = await launch(e, cdpArgs(port), env)
      try {
        r.p3state = await until(() => updState(port).then((s) => (s && s.kind !== 'checking' ? s : null)), 15000)
        await sleep(1500)
        r.p3 = await appText(port)
        r.p3UpdateNow = await uiHas(port, BTN.updateNow)
        r.clickedCheck = await checkByHand(port)
        r.byHand = (await until(() => appText(port).then((t) => (AVAILABLE(V2).test(t) ? t : '')), 15000)) || (await appText(port))
      } finally {
        await stop()
      }
    } catch (x) {
      err += ` phase3: ${String(x?.message ?? x)}`
    }
    // variants, each on its own data folder, checked by hand (start-up check off)
    const variant = async (tag, feedDoc, act) => {
      const ev = setup(`update-window-${tag}`, { autoCheckUpdates: false })
      const f = updateFeed(ev, `feed-${tag}.json`, feedDoc)
      const port = await freePort()
      const iport = await freePort()
      const out = { err: '' }
      try {
        const stop = await launch(ev, [...cdpArgs(port), ...inspectArgs(iport)], { SC_TEST_UPDATE_FEED: f })
        try {
          await recordUpdates(port)
          await stubExternal(iport)
          out.clicked = await checkByHand(port)
          await act(port, iport, out, ev)
        } finally {
          await stop()
        }
      } catch (x) {
        out.err = String(x?.message ?? x)
      }
      return out
    }
    // Q2: closing the window (Escape) during a download cancels it, like Gremlin. The Escape is sent from the
    // renderer's own onUpdate listener on the first 'downloading' state (the 3 test steps are ~150 ms apart);
    // downloadStepMs slows the test feed where the updater supports it (ignored otherwise).
    const ESC_ON_DOWNLOAD = `(() => { window.__scEscArmed = true; if (!window.__scEscHook) { window.__scEscHook = true; window.supercargo.onUpdate((s) => { if (s.kind === 'downloading' && window.__scEscArmed) { window.__scEscArmed = false; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } }) } return true })()`
    const cancelV = variant('cancel', { version: V2, notes: NOTES, downloadStepMs: 1000 }, async (port, iport, o, ev) => {
      await until(() => appText(port).then((t) => AVAILABLE(V2).test(t)), 15000)
      await cdpEval(port, 'main', ESC_ON_DOWNLOAD)
      const n = (await updStates(port)).length
      o.update = await uiClick(port, BTN.updateNow)
      // back to available after a downloading state
      o.after = await until(
        () =>
          updStates(port).then((s) => {
            const a = s.slice(n)
            const i = a.findIndex((x) => x.kind === 'downloading')
            return i >= 0 && a.slice(i + 1).some((x) => x.kind === 'available') ? a : null
          }),
        15000
      )
      o.logged = !!(await until(() => /update download cancelled/i.test(ev.log()), 8000))
      // a left-over download would have finished by now (3 steps of up to 1 s)
      await sleep(4000)
      o.states = (await updStates(port)).slice(n)
      o.state = await updState(port)
      o.windowOpen = await uiHas(port, BTN.updateNow)
      o.text = await appText(port)
      // Update Now again (window reopened by hand) downloads to ready
      o.reopened = await checkByHand(port)
      await until(() => appText(port).then((t) => AVAILABLE(V2).test(t)), 15000)
      const m = (await updStates(port)).length
      o.update2 = await uiClick(port, BTN.updateNow)
      o.again = await until(() => updStates(port).then((s) => (s.slice(m).some((x) => x.kind === 'ready') ? s.slice(m) : null)), 20000)
    })
    const [fail, nonotes, portable, upToDate, cancel] = await Promise.all([
      variant('fail', { version: V2, notes: NOTES, failDownload: 'size check failed (test)' }, async (port, iport, o) => {
        await until(() => appText(port).then((t) => AVAILABLE(V2).test(t)), 15000)
        o.update = await uiClick(port, BTN.updateNow)
        o.text = (await until(() => appText(port).then((t) => (/The download failed:/i.test(t) ? t : '')), 15000)) || (await appText(port))
        o.btns = { tryAgain: await uiHas(port, BTN.tryAgain), page: await uiHas(port, BTN.releasePage), close: await uiHas(port, BTN.close) }
        const n = (await updStates(port)).length
        o.retry = await uiClick(port, BTN.tryAgain)
        o.after = await until(() => updStates(port).then((s) => (s.slice(n).some((x) => x.kind === 'failed') ? s.slice(n) : null)), 15000)
      }),
      variant('nonotes', { version: V2, notes: null }, async (port, iport, o) => {
        o.text = (await until(() => appText(port).then((t) => (AVAILABLE(V2).test(t) ? t : '')), 15000)) || (await appText(port))
        o.update = await uiHas(port, BTN.updateNow)
      }),
      variant('portable', { version: V2, notes: NOTES, portable: true }, async (port, iport, o) => {
        o.text = (await until(() => appText(port).then((t) => (AVAILABLE(V2).test(t) ? t : '')), 15000)) || (await appText(port))
        o.btns = { page: await uiHas(port, BTN.releasePage), skip: await uiHas(port, BTN.skip), later: await uiHas(port, BTN.later), updateNow: await uiHas(port, BTN.updateNow) }
        o.page = await uiClick(port, BTN.releasePage)
        o.opened = await until(() => mainEval(iport, 'globalThis.__scOpened').then((a) => (a?.length ? a : null)), 5000)
      }),
      variant('uptodate', { version: APP_VERSION, upToDate: true }, async (port, iport, o) => {
        o.text = (await until(() => appText(port).then((t) => (/is up to date/i.test(t) ? t : '')), 15000)) || (await appText(port))
      }),
      cancelV
    ])
    const cKinds = (cancel.states ?? []).map((s) => s.kind)
    const cFirstDl = cKinds.indexOf('downloading')
    const cBack = cKinds.indexOf('available', cFirstDl + 1)
    const kinds = r.states.map((s) => s.kind)
    const dl = r.states.filter((s) => s.kind === 'downloading')
    const readyState = r.states.find((s) => s.kind === 'ready')
    const i2 = r.p1.search(WHATS_NEW(V2))
    const i1 = r.p1.search(WHATS_NEW(V1))
    const UPDATED = new RegExp(`Updated\\s*[—–-]+\\s*now R1 ${reEsc(APP_VERSION)}`, 'i')
    return [
      ['start-up check: the window opens by itself ("R1 <new> is available. You have R1 <current>.")', AVAILABLE(V2).test(r.p1) && new RegExp(`You have R1 ${reEsc(APP_VERSION)}`, 'i').test(r.p1) && /Check for Updates/i.test(r.p1), `line=${short(lineWith(r.p1, /available|You have/i), 300)} ${err}`],
      ['What\'s new of both versions, newest first, markdown rendered', i2 >= 0 && i1 > i2 && /Second release bold feature/.test(r.p1) && /First release fix/.test(r.p1) && !/\*\*|^###/m.test(r.p1), `newest=${i2} older=${i1}`],
      ['link "Full release notes on GitHub" shown', /Full release notes on GitHub/i.test(r.p1), `found=${/Full release notes/i.test(r.p1)}`],
      ['installed copy: Update Now / Skip This Version / Later', !!r.clicked, `clicked=${r.clicked}`],
      ['Updated notice banner "Updated — now R1 <current>" with WHAT\'S NEW', UPDATED.test(r.notice) && r.whats, `line=${short(lineWith(r.notice, /Updated/i), 200)} whatsNew=${r.whats}`],
      ['lastRunVersion saved as the running version', set1?.lastRunVersion === APP_VERSION, `lastRunVersion=${set1?.lastRunVersion}`],
      ['Update Now: downloading with progress, then ready (checked)', dl.length >= 1 && dl.every((s, i) => i === 0 || s.percent >= dl[i - 1].percent) && readyState?.verified === true && kinds.indexOf('ready') > kinds.indexOf('downloading'), `kinds=${short(kinds)} percents=${short(dl.map((s) => s.percent))}`],
      ['ready: "Downloaded and checked." with Install and Restart / Later', /Downloaded and checked/i.test(r.ready) && r.readyBtns?.install && r.readyBtns?.later, `btns=${short(r.readyBtns)}`],
      ['Install and Restart runs the install (test log "update install (test)")', !!r.install && /update install \(test\)/.test(e.log()), `clicked=${r.install}`],
      ['Updated notice only once (not on the next start)', !!r.p2 && !UPDATED.test(r.noticeAgain), `line=${short(lineWith(r.noticeAgain, /Updated/i), 200)}`],
      ['Skip This Version saves skippedUpdateVersion', !!r.skip && r.skipped === V2, `clicked=${r.skip} saved=${r.skipped}`],
      ['skipped version: start-up stays quiet (no window)', r.p3state?.kind === 'available' && r.p3state?.skipped === true && !AVAILABLE(V2).test(r.p3) && !r.p3UpdateNow, `state=${short(r.p3state, 200)} text=${short(lineWith(r.p3, /available/i), 200)}`],
      ['Check for Updates by hand (Settings → UPDATES "CHECK FOR UPDATES") shows the skipped version', r.clickedCheck && AVAILABLE(V2).test(r.byHand), `clicked=${r.clickedCheck}`],
      ['failed download: "The download failed: <msg>" with Try Again / Open Release Page / Close', /The download failed:.*size check failed \(test\)/i.test(fail.text ?? '') && fail.btns?.tryAgain && fail.btns?.page && fail.btns?.close, `line=${short(lineWith(fail.text, /download failed/i), 200)} btns=${short(fail.btns)} ${fail.err}`],
      ['Try Again downloads again', !!fail.retry && !!fail.after, `after=${short(fail.after?.map((s) => s.kind))}`],
      ['notes null: "Release notes unavailable." with the link, Update Now still there', /Release notes unavailable\./i.test(nonotes.text ?? '') && /Full release notes on GitHub/i.test(nonotes.text ?? '') && nonotes.update, `update=${nonotes.update} ${nonotes.err}`],
      ['zip copy: Open Release Page / Skip This Version / Later, no Update Now', portable.btns?.page && portable.btns?.skip && portable.btns?.later && !portable.btns?.updateNow, `btns=${short(portable.btns)} ${portable.err}`],
      ['zip copy: Open Release Page opens the release url', !!portable.page && (portable.opened?.length ?? 0) > 0, `opened=${short(portable.opened)}`],
      ['Q2 Escape during the download cancels it: state back to available for the same version', !!cancel.update && cFirstDl >= 0 && cBack > cFirstDl && cancel.states[cBack]?.version === V2 && cancel.state?.kind === 'available' && cancel.state?.version === V2, `kinds=${short(cKinds)} state=${short(cancel.state, 200)} ${cancel.err ?? ''}`],
      ['Q2 cancel logged ("update download cancelled")', cancel.logged === true, `logged=${cancel.logged}`],
      ['Q2 no ready arrives after the cancel, window closed, no "Downloading update" bar left', cBack > 0 && !cKinds.slice(cBack).includes('ready') && !cancel.windowOpen && !/Downloading update/i.test(cancel.text ?? ''), `after=${short(cKinds.slice(cBack))} windowOpen=${cancel.windowOpen} bar=${short(lineWith(cancel.text, /Downloading update/i), 120)}`],
      ['Q2 Update Now again (window reopened) downloads to ready', !!cancel.reopened && !!cancel.update2 && !!cancel.again?.some((x) => x.kind === 'ready' && x.version === V2), `reopened=${cancel.reopened} clicked=${cancel.update2} kinds=${short(cancel.again?.map((x) => x.kind))}`],
      ['up to date by hand: "SuperCargo-OtherModes R1 <v> is up to date."', new RegExp(`R1 ${reEsc(APP_VERSION)} is up to date`, 'i').test(upToDate.text ?? ''), `line=${short(lineWith(upToDate.text, /up to date/i), 200)} ${upToDate.err}`]
    ]
  },

  // CONTRACT14 D: reference data from a test source (SC_TEST_REFDATA_BASE): one file with a wrong fingerprint ->
  // the update window's panel says so, Settings shows the ⚠ line; fixed at the source -> CHECK NOW -> Updated.
  'refdata-status': async () => {
    const e = setup('refdata-status', { autoCheckUpdates: false })
    const src = path.join(e.home, 'refdata-source')
    fs.mkdirSync(src, { recursive: true })
    const seed = path.join(root, 'data', 'uex')
    const hashes = {}
    for (const f of REF_FILES) {
      const body = readText(path.join(seed, f.repo)) ?? JSON.stringify({ [f.key]: [] })
      fs.writeFileSync(path.join(src, f.repo), body)
      hashes[f.key] = sha256(body)
    }
    // Ships: the list names a newer copy, but the file served doesn't match it
    const shipsDoc = JSON.parse(readText(path.join(src, 'ships.json')))
    const NEW_SHIPS = JSON.stringify({ ...shipsDoc, e2eMarker: 'newer copy' }, null, 2)
    hashes.ships = sha256(NEW_SHIPS)
    fs.writeFileSync(path.join(src, 'ships.json'), `${NEW_SHIPS}\n `)
    fs.writeFileSync(path.join(src, 'hashes.json'), JSON.stringify(hashes))
    const server = await serveDir(src)
    const feed = updateFeed(e, 'feed-uptodate.json', { version: APP_VERSION, upToDate: true })
    const r = { first: null, settings: '', clicked: false, panel: '', after: null, panel2: '', settings2: '' }
    let err = ''
    try {
      const port = await freePort()
      const stop = await launch(e, cdpArgs(port), { SC_TEST_REFDATA_BASE: server.base, SC_TEST_UPDATE_FEED: feed })
      try {
        const get = () => cdpEval(port, 'main', 'window.supercargo.getRefDataStatus()')
        r.first = await until(() => get().then((s) => (s?.checkedAt ? s : null)), 25000)
        if (!r.first) {
          // the start-up refresh didn't run (or hasn't finished): check by hand so the rest can still be judged
          r.startupMissing = true
          await checkByHand(port)
          await uiClick(port, BTN.checkNow)
          r.first = await until(() => get().then((s) => (s?.checkedAt ? s : null)), 20000)
        }
        await openSettingsTab(port, 'GENERAL')
        r.settings = (await until(() => windowText(port, 'main').then((t) => (REF_WARN.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
        r.clicked = await checkByHand(port)
        r.panel = (await until(() => appText(port).then((t) => (/Reference data \(ships, places, cargo grids\)/i.test(t) && REF_WORDS.hashMismatch.test(t) ? t : '')), 15000)) || (await appText(port))
        // the source is fixed: the served Ships file now matches its fingerprint
        fs.writeFileSync(path.join(src, 'ships.json'), NEW_SHIPS)
        r.checkNow = await uiClick(port, BTN.checkNow)
        r.after = await until(() => get().then((s) => (s?.files?.find((f) => f.key === 'ships')?.state === 'updated' ? s : null)), 20000)
        r.panel2 = (await until(() => appText(port).then((t) => (REF_WORDS.updated.test(afterLabel(t, 'Ships')) ? t : '')), 10000)) || (await appText(port))
        r.settings2 = await windowText(port, 'main')
      } finally {
        await stop()
      }
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await server.close()
    const st = (s, key) => s?.files?.find((f) => f.key === key)?.state
    const saved = readJsonIn(e.data, 'reference-data-status.json')
    const others = REF_FILES.filter((f) => f.key !== 'ships')
    return [
      ['start-up check: Ships fingerprint mismatch, the others up to date', st(r.first, 'ships') === 'hashMismatch' && others.every((f) => st(r.first, f.key) === 'upToDate') && r.first?.reached === true, `startupRan=${!r.startupMissing} files=${short(r.first?.files?.map((f) => `${f.key}:${f.state}`))} ${err}`],
      ['the old Ships copy is kept', readText(path.join(e.data, 'uex-vehicles.json')) !== `${NEW_SHIPS}\n ` , `same=${readText(path.join(e.data, 'uex-vehicles.json')) === `${NEW_SHIPS}\n `}`],
      ['status saved to reference-data-status.json', !!saved && Array.isArray(saved.files) && saved.files.length === REF_FILES.length, `saved=${short(saved, 200)}`],
      ['Settings UPDATES: "⚠ Reference data: 1 file(s) couldn\'t be updated — see Check for Updates"', (r.settings.match(REF_WARN) ?? [])[1] === '1' && /see Check for Updates/i.test(lineWith(r.settings, REF_WARN)), `line=${short(lineWith(r.settings, /reference data/i), 300)}`],
      ['update window panel: heading, Ships "Fingerprint didn\'t match", others "Up to date", source line', r.clicked && /Reference data \(ships, places, cargo grids\)/i.test(r.panel) && REF_WORDS.hashMismatch.test(afterLabel(r.panel, 'Ships')) && others.every((f) => REF_WORDS.upToDate.test(afterLabel(r.panel, f.label))) && /original SuperCargo author/i.test(r.panel) && /Last checked/i.test(r.panel), `ships=${short(afterLabel(r.panel, 'Ships'))} locations=${short(afterLabel(r.panel, 'Locations'))}`],
      ['CHECK NOW after the source is fixed: Ships Updated, new copy written', !!r.checkNow && st(r.after, 'ships') === 'updated' && readText(path.join(e.data, 'uex-vehicles.json')) === NEW_SHIPS, `clicked=${r.checkNow} files=${short(r.after?.files?.map((f) => `${f.key}:${f.state}`))}`],
      ['panel shows Ships Updated; Settings ⚠ line gone', REF_WORDS.updated.test(afterLabel(r.panel2, 'Ships')) && !REF_WARN.test(r.settings2), `ships=${short(afterLabel(r.panel2, 'Ships'))} warn=${short(lineWith(r.settings2, REF_WARN))}`]
    ]
  },

  // CONTRACT14 E: the overlay stop card keeps its height while stepping ‹ › between long/short names, with and
  // without tags; a rep range shows "+100–500 REP" (O2)
  'overlay-header': async () => {
    const LONG = 'Shubin Mining Facility SAL-2'
    const { e, port, stop } = await memLaunch('overlay-header', {
      jobs: [
        { title: 'Scrap Haul', rep: 100, repMax: 500, steps: [goStep('s1', LONG)] },
        { title: 'Scrap Haul', steps: [goStep('s2', 'Port Tressler')] },
        { title: 'Scrap Haul', steps: [goStep('s3', 'Qqzzx Unheard Of Outpost With A Very Long Made Up Name')] },
        { title: 'Scrap Haul', steps: [goStep('s4', 'Everus Harbor')] }
      ]
    })
    const views = []
    let main = ''
    let err = ''
    try {
      await until(() => overlayHeader(port).then((v) => (v?.height && v.stop?.[1] >= 2 ? v : null)), 15000)
      // back to the first stop, then step through every stop
      for (let i = 0; i < 6; i++) await cdpEval(port, 'overlay', `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '\\u2039'); if (b && !b.disabled) b.click(); return true })()`)
      await sleep(400)
      for (let i = 0; i < 6; i++) {
        const v = await overlayHeader(port)
        v.text = await windowText(port, 'overlay')
        views.push(v)
        const moved = await cdpEval(port, 'overlay', `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '\\u203a'); if (!b || b.disabled) return false; b.click(); return true })()`)
        if (!moved) break
        await sleep(400)
      }
      main = (await until(() => windowText(port, 'main').then((t) => (/REP/.test(t) ? t : '')), 10000)) || (await windowText(port, 'main'))
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const hs = views.map((v) => v.height)
    const tops = views.map((v) => v.nextTop)
    const names = new Set(views.map((v) => v.name))
    const longView = views.find((v) => new RegExp(reEsc(LONG), 'i').test(v.title ?? v.name ?? ''))
    const RANGE = /\+100\s*–\s*500 REP/
    const repShown = views.filter((v) => /REP\b/.test(v.text))
    return [
      ['overlay stepped through all stops (different names)', views.length >= 4 && names.size >= 4, `stops=${short(views.map((v) => v.stop))} names=${short([...names])} ${err}`],
      ['stop header height is the same on every stop', hs.length >= 4 && hs.every((h) => h != null && Math.abs(h - hs[0]) <= 0.5), `heights=${short(hs)}`],
      ['the row below the header starts at the same place on every stop', tops.every((t) => t != null && Math.abs(t - tops[0]) <= 0.5), `tops=${short(tops)}`],
      ['place name on one line with an ellipsis; full name in the title tooltip', views.every((v) => v.ellipsis === true) && views.filter((v) => v.clipped).every((v) => !!v.title) && !!longView, `views=${short(views.map((v) => ({ n: v.name, t: v.title, c: v.clipped })), 600)}`],
      ['rep range in the jobs list: "+100–500 REP"', RANGE.test(main), `line=${short(lineWith(main, /REP/), 300)}`],
      ['overlay rep, where shown, uses the range form', repShown.every((v) => !/\+100 REP/.test(v.text) || RANGE.test(v.text)) && repShown.filter((v) => /\+100/.test(v.text)).every((v) => RANGE.test(v.text)), `lines=${short(repShown.map((v) => lineWith(v.text, /REP/)), 300)}`]
    ]
  },
  // overlay footer at narrow widths: the row wraps; buttons keep full size and an 8 px gap; the brand label never
  // clips (user bug: ABANDON slid under AFK and the label showed "SU"; at 332 px ABANDON and AFK touched)
  'overlay-footer-narrow': async () => {
    const run = async (w) => {
      const { port, stop } = await memLaunch(`overlay-footer-narrow-${w}`, {
        jobs: [{ title: 'Scrap Haul', steps: [goStep('s1', 'Port Tressler')] }],
        settings: { overlayW: w, overlayH: 432, overlayX: 10, overlayY: 10 }
      })
      let v = null
      let err = ''
      try {
        v = await until(() => overlayFooter(port).then((x) => (x?.abandon && x.afk && x.step && x.brand ? x : null)), 15000)
      } catch (x) {
        err = String(x?.message ?? x)
      }
      await stop()
      const bs = v ? [v.step, v.abandon, v.afk].filter(Boolean) : []
      const overlap = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
      const pairs = []
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) pairs.push([bs[i], bs[j]])
      const sameLine = pairs.filter(([a, b]) => Math.abs(a.t - b.t) < 2)
      const gap = (a, b) => (a.l < b.l ? b.l - a.r : a.l - b.r)
      const where = (x) => (x ? `${x.text}[${x.l}-${x.r} x ${x.t}-${x.b} sw=${x.sw} cw=${x.cw}]` : 'missing')
      const tag = `${w} px:`
      return [
        [`${tag} overlay footer found (3 buttons + brand label)`, bs.length === 3 && !!v?.brand, `win=${v?.winW} ids=${v?.ids} ${err}`],
        [`${tag} no two buttons overlap`, bs.length === 3 && pairs.every(([a, b]) => !overlap(a, b)), short(bs.map(where), 400)],
        [`${tag} buttons on the same line are >= 6 px apart`, bs.length === 3 && sameLine.every(([a, b]) => gap(a, b) >= 6), `gaps=${short(sameLine.map(([a, b]) => `${a.text}|${b.text}=${Math.round(gap(a, b) * 10) / 10}`))}`],
        [`${tag} button text not cut (scrollWidth <= clientWidth)`, bs.length === 3 && bs.every((b) => b.sw <= b.cw), short(bs.map((b) => `${b.text} ${b.sw}/${b.cw}`))],
        [`${tag} brand label not clipped and inside the card`, !!v?.brand && !!v.card && v.brand.sw <= v.brand.cw && v.brand.l >= v.card.l - 0.5 && v.brand.r <= v.card.r + 0.5, `brand=${where(v?.brand)} card=${where(v?.card)}`],
        [`${tag} every button inside the overlay's visible width`, bs.length === 3 && bs.every((b) => b.l >= -0.5 && b.r <= v.winW + 0.5), `win=${v?.winW} ${short(bs.map(where), 400)}`]
      ]
    }
    return (await Promise.all([run(332), run(260)])).flat()
  },
  // overlay FROM row at the bottom (user: "put some padding there so I dont accidently click a button instead of the
  // pin"): buttons, then a gap >= 10 px, then the FROM row, then the brand label; the pin's click area >= 24x24
  'overlay-from-row': async () => {
    const START = 'Lorville'
    const run = async (w, typed) => {
      const { port, stop } = await memLaunch(`overlay-from-row-${w}${typed ? '' : '-nostart'}`, {
        jobs: [{ title: 'Scrap Haul', steps: [goStep('s1', 'Port Tressler')] }],
        typed,
        settings: { overlayW: w, overlayH: 432, overlayX: 10, overlayY: 10 }
      })
      let v = null
      let err = ''
      try {
        const want = typed ? /FROM:/ : /No start/
        v = await until(() => overlayFromRow(port).then((x) => (x?.abandon && x.afk && x.step && x.brand && x.row && want.test(x.rowText) ? x : null)), 15000)
      } catch (x) {
        err = String(x?.message ?? x)
        v = await overlayFromRow(port).catch(() => null)
      }
      await stop()
      return { v, err }
    }
    const where = (x) => (x ? `${x.text.slice(0, 40)}[${x.l}-${x.r} x ${x.t}-${x.b}]` : 'missing')
    const overlap = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
    const checks = ({ v, err }, w) => {
      const tag = `${w} px:`
      const bs = v ? [v.step, v.abandon, v.afk].filter(Boolean) : []
      const low = bs.length ? Math.max(...bs.map((b) => b.b)) : null
      const gap = v?.row && low != null ? Math.round((v.row.t - low) * 10) / 10 : null
      return [
        [`${tag} FROM row, pin, 3 buttons and brand found`, bs.length === 3 && !!v?.row && !!v.pin && !!v.brand, `ids=${v?.ids} row=${where(v?.row)} pin=${where(v?.pin)} ${err}`],
        [`${tag} FROM row's top is below every button's bottom`, bs.length === 3 && !!v?.row && bs.every((b) => v.row.t >= b.b - 0.5), `row=${where(v?.row)} buttons=${short(bs.map(where), 300)}`],
        [`${tag} gap between the lowest button and the FROM row >= 10 px`, gap != null && gap >= 10, `gap=${gap}`],
        [`${tag} pin click area >= 24x24 px`, !!v?.pin && v.pin.w >= 24 && v.pin.h >= 24, `pin=${v?.pin?.w}x${v?.pin?.h}`],
        [`${tag} pin overlaps no button`, !!v?.pin && bs.length === 3 && bs.every((b) => !overlap(v.pin, b)), `pin=${where(v?.pin)} buttons=${short(bs.map(where), 300)}`],
        [`${tag} pin inside the card`, !!v?.pin && !!v.card && v.pin.l >= v.card.l - 0.5 && v.pin.r <= v.card.r + 0.5 && v.pin.t >= v.card.t - 0.5 && v.pin.b <= v.card.b + 0.5, `pin=${where(v?.pin)} card=${where(v?.card)}`],
        [`${tag} brand label below the FROM row and not clipped`, !!v?.brand && !!v.row && v.brand.t >= v.row.b - 0.5 && v.brand.sw <= v.brand.cw && (!v.card || (v.brand.l >= v.card.l - 0.5 && v.brand.r <= v.card.r + 0.5)), `brand=${where(v?.brand)} sw=${v?.brand?.sw}/${v?.brand?.cw} row=${where(v?.row)}`],
        [`${tag} FROM row reads "FROM:" and the start name`, /FROM:/.test(v?.rowText ?? '') && new RegExp(reEsc(START)).test(v?.rowText ?? ''), `row=${short(v?.rowText)}`]
      ]
    }
    const [a, b, none] = await Promise.all([run(332, START), run(260, START), run(332, '')])
    const nb = none.v ? [none.v.step, none.v.abandon, none.v.afk].filter(Boolean) : []
    const nlow = nb.length ? Math.max(...nb.map((x) => x.b)) : null
    return [
      ...checks(a, 332),
      ...checks(b, 260),
      ['no start: the row shows "No start"', /No start/.test(none.v?.rowText ?? ''), `row=${short(none.v?.rowText)} ${none.err}`],
      ['no start: its WHERE AM I button is below the buttons', !!none.v?.pin && /WHERE AM I/.test(none.v.pin.text) && nlow != null && none.v.pin.t >= nlow - 0.5, `where=${where(none.v?.pin)} lowestButton=${nlow}`]
    ]
  },

  // problem stops (shared rule src/other/renderer/stopIssue.ts, user 2026-10-14): place not found -> red; guess /
  // not sure / mismatch -> amber. Lists tint the row (data-issue="red|amber"; the Jobs header also an issue-chip);
  // the overlay tints only the words (overlay-stop-name / objective carry data-issue, the card does not)
  'issue-tint': async () => {
    const BAD = 'Qzxv Brellin Outpost CR-9'
    const T = { bad: 'Bad Place Run', none: 'No Place Run', unsure: 'Unsure Place Run', good: 'Good Place Run' }
    const NOPLACE = 'Deliver Prescription Medications'
    const jobs = [
      { ref: 'J81', title: T.bad, steps: [goStep('s1', BAD)] },
      { ref: 'J82', title: T.none, steps: [{ id: 's1', kind: 'go', label: NOPLACE, location: '', have: 0, need: 1, done: false }] },
      { ref: 'J83', title: T.unsure, steps: [goStep('s1', SHUBIN)] },
      { ref: 'J84', title: T.good, steps: [goStep('s1', 'Port Tressler')] }
    ]
    // for each text: every visible element holding it -> the nearest [data-issue] (level, whether it is the job's
    // whole block, i.e. also holds the title) and the job wrapper's issue-chip
    const probe = (port, which, texts, titles = []) =>
      cdpEval(
        port,
        which,
        `(() => {
          const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
          const titles = ${JSON.stringify(titles)}
          const out = {}
          for (const t of ${JSON.stringify(texts)}) {
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
            const hits = []
            while (w.nextNode()) {
              const el = w.currentNode.parentElement
              if (!el || !vis(el) || !w.currentNode.textContent.includes(t)) continue
              const i = el.closest('[data-issue]')
              const wrap = el.closest('button')?.parentElement ?? null
              hits.push({
                level: i?.getAttribute('data-issue') ?? null,
                holdsTitle: !!i && titles.some((x) => x !== t && i.textContent.includes(x)),
                chip: !!wrap?.querySelector('[data-testid="issue-chip"]')
              })
            }
            out[t] = hits
          }
          return out
        })()`
      )
    const lvl = (hits) => (hits ?? []).map((h) => h.level).find(Boolean) ?? null
    const main = async () => {
      const { port, stop } = await memLaunch('issue-tint', { jobs })
      const r = { err: '' }
      try {
        r.nextText = await nextText(port, /Port Tressler/)
        await sleep(800)
        r.next = await probe(port, 'main', [BAD, NOPLACE, SHUBIN, 'Port Tressler'])
        await clickButton(port, 'main', /^JOBS$/)
        await until(() => windowText(port, 'main').then((t) => (t.includes(T.good) ? true : null)), 8000)
        await sleep(500)
        r.jobs = await probe(port, 'main', Object.values(T))
        // expand the bad job: its step row is tinted on its own; its tag opens MatchFix
        await cdpEval(port, 'main', `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(T.bad)})); b?.click(); return !!b })()`)
        await until(() => windowText(port, 'main').then((t) => (t.includes(`Deliver Scrap to ${BAD}`) ? true : null)), 8000)
        await sleep(500)
        r.step = await probe(port, 'main', [`Deliver Scrap to ${BAD}`], Object.values(T))
        r.fix = await cdpEval(
          port,
          'main',
          `(async () => {
            const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
            const tag = [...document.querySelectorAll('button, [role="button"]')].filter((x) => vis(x) && ${TAG.none}.test(x.textContent.trim())).sort((a, b) => a.textContent.length - b.textContent.length)[0]
            if (!tag) return { tag: false }
            tag.click()
            await new Promise((res) => setTimeout(res, 500))
            return { tag: true, dialog: !!document.querySelector('[role="dialog"][aria-label="Fix this match"]') }
          })()`
        )
        // Needs your eye: filled from the seen reporter (debounced ~5 s)
        await until(() => memGet(port).then((d) => ((d?.entries ?? []).length >= 2 ? true : null)), 15000)
        await cdpEval(port, 'main', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        r.learned = (await openLearnedData(port)).text
        await sleep(500)
        r.needs = await cdpEval(
          port,
          'main',
          `[...document.querySelectorAll('[data-testid="learned-needs-row"]')].map((x) => ({ text: x.textContent.slice(0, 80), level: x.getAttribute('data-issue') ?? x.querySelector('[data-issue]')?.getAttribute('data-issue') ?? null }))`
        )
      } catch (x) {
        r.err = String(x?.message ?? x)
      }
      await stop()
      return r
    }
    // the overlay shows one current stop: one run per kind of stop
    const overlay = async (kind, step) => {
      const { port, stop } = await memLaunch(`issue-tint-overlay-${kind}`, { jobs: [{ ref: 'J85', title: 'Overlay Run', steps: [step] }] })
      let v = null
      let err = ''
      const read = () =>
        cdpEval(
          port,
          'overlay',
          `(() => {
            const n = document.querySelector('[data-testid="overlay-stop-name"]')
            if (!n) return null
            return {
              name: n.textContent,
              level: n.getAttribute('data-issue'),
              aboveName: n.parentElement?.closest('[data-issue]') ? n.parentElement.closest('[data-issue]').getAttribute('data-testid') || n.parentElement.closest('[data-issue]').tagName : null,
              all: [...document.querySelectorAll('[data-issue]')].map((x) => (x.getAttribute('data-testid') || x.tagName) + '=' + x.getAttribute('data-issue'))
            }
          })()`
        )
      try {
        v = await until(() => read().then((x) => (x?.name ? x : null)), 15000)
        await sleep(800)
        v = (await read()) ?? v
      } catch (x) {
        err = String(x?.message ?? x)
      }
      await stop()
      return { v, err }
    }
    // two jobs: the current stop is Port Tressler (has a distance), the "Next Location" line names the other one
    const nextLoc = async (kind, place) => {
      const { port, stop } = await memLaunch(`issue-tint-next-${kind}`, {
        jobs: [
          { ref: 'J86', title: 'Overlay Run', steps: [goStep('s1', 'Port Tressler')] },
          { ref: 'J87', title: 'Overlay Run Two', steps: [goStep('s1', place)] }
        ]
      })
      let v = null
      let err = ''
      const read = () =>
        cdpEval(
          port,
          'overlay',
          `(() => {
            const n = document.querySelector('[data-testid="overlay-next-location"]')
            const cur = document.querySelector('[data-testid="overlay-stop-name"]')?.textContent ?? null
            if (!n) return { found: false, cur }
            const own = n.getAttribute('data-issue')
            return { found: true, cur, text: n.textContent, level: own ?? n.querySelector('[data-issue]')?.getAttribute('data-issue') ?? null }
          })()`
        )
      try {
        v = await until(() => read().then((x) => (x?.found && x.text ? x : null)), 15000)
        await sleep(800)
        v = (await read()) ?? v
      } catch (x) {
        err = String(x?.message ?? x)
      }
      await stop()
      return { v, err }
    }
    const [m, oBad, oUnsure, oGood, nBad, nGood] = await Promise.all([
      main(),
      overlay('bad', goStep('s1', BAD)),
      overlay('unsure', goStep('s1', SHUBIN)),
      overlay('good', goStep('s1', 'Port Tressler')),
      nextLoc('bad', BAD),
      nextLoc('good', 'Everus Harbor')
    ])
    const j = m.jobs ?? {}
    const hdr = (t) => (j[t] ?? [])[0] ?? null
    const n = m.next ?? {}
    const stepHits = (m.step ?? {})[`Deliver Scrap to ${BAD}`] ?? []
    const needs = m.needs ?? []
    const okOnlyWords = (o) => !o.v?.aboveName && (o.v?.all ?? []).every((x) => /^overlay-stop-(name|objective)=/.test(x))
    return [
      ['Jobs: not-found job header red + issue-chip', hdr(T.bad)?.level === 'red' && hdr(T.bad)?.chip, `hit=${short(hdr(T.bad))} ${m.err}`],
      ['Jobs: no-place job header red + issue-chip', hdr(T.none)?.level === 'red' && hdr(T.none)?.chip, `hit=${short(hdr(T.none))}`],
      ['Jobs: not-sure job header amber + issue-chip', hdr(T.unsure)?.level === 'amber' && hdr(T.unsure)?.chip, `hit=${short(hdr(T.unsure))}`],
      ['Jobs: exact job header has no data-issue and no chip', !!hdr(T.good) && !hdr(T.good).level && !hdr(T.good).chip, `hit=${short(hdr(T.good))}`],
      ['Jobs: expanded bad job, its step row has its own data-issue red', stepHits.some((h) => h.level === 'red' && !h.holdsTitle), `hits=${short(stepHits)}`],
      ['Jobs: clicking the step\'s "✗ not found" tag opens MatchFix', !!m.fix?.tag && !!m.fix.dialog, `fix=${short(m.fix)}`],
      ['Next: not-found stop row red', lvl(n[BAD]) === 'red', `hits=${short(n[BAD])} next=${short(lineWith(m.nextText, /Qzxv|not found/i))}`],
      ['Next: no-place stop row red', lvl(n[NOPLACE]) === 'red', `hits=${short(n[NOPLACE])} next=${short(lineWith(m.nextText, /Prescription/i))}`],
      ['Next: not-sure stop row amber', lvl(n[SHUBIN]) === 'amber', `hits=${short(n[SHUBIN])}`],
      ['Next: exact stop (Port Tressler) has no data-issue', (n['Port Tressler'] ?? []).length > 0 && !lvl(n['Port Tressler']), `hits=${short(n['Port Tressler'])}`],
      ['Learned Data: Needs your eye rows all carry data-issue', needs.length >= 2 && needs.every((x) => x.level === 'red' || x.level === 'amber'), `needs=${short(needs, 600)}`],
      ['Learned Data: not-found row red, not-sure row amber', needs.find((x) => /Qzxv/.test(x.text))?.level === 'red' && needs.find((x) => /Shubin/.test(x.text))?.level === 'amber', `needs=${short(needs, 600)}`],
      ['Overlay: not-found stop name red', oBad.v?.level === 'red', `v=${short(oBad.v)} ${oBad.err}`],
      ['Overlay: not-found, only the words carry data-issue (not the card)', !!oBad.v?.level && okOnlyWords(oBad), `v=${short(oBad.v)}`],
      ['Overlay: not-sure stop name amber, only the words', oUnsure.v?.level === 'amber' && okOnlyWords(oUnsure), `v=${short(oUnsure.v)} ${oUnsure.err}`],
      ['Overlay: exact stop has no data-issue anywhere', !!oGood.v?.name && !oGood.v.level && (oGood.v.all ?? []).length === 0, `v=${short(oGood.v)} ${oGood.err}`],
      ['Overlay: "Next Location" on a not-found place has data-issue red', /Qzxv/.test(nBad.v?.text ?? '') && nBad.v?.level === 'red', `v=${short(nBad.v)} ${nBad.err}`],
      ['Overlay: "Next Location" on an exact place has no data-issue', !!nGood.v?.found && /Everus|Port Tressler/.test(nGood.v.text ?? '') && !nGood.v.level, `v=${short(nGood.v)} ${nGood.err}`]
    ]
  },

  // the overlay's current stop stays put (user 2026-10-14): a WHERE AM I read at the same place or a job-file save
  // used to send it back to STOP 1 (setIdx(0) on every new origin point). It only goes back to 1 by the
  // return-to-first timer (overlayReturnToFirst + overlayReturnSeconds) or a real start change (another place).
  'overlay-stays-on-stop': async () => {
    const jobs = ['Port Tressler', 'Lorville', 'Everus Harbor', 'Seraphim Station', 'Area18'].map((p, i) => ({ title: `Stay Run ${i + 1}`, steps: [goStep(`s${i + 1}`, p)] }))
    const go = (port, n) =>
      cdpEval(port, 'overlay', `(async () => { let k = 0; for (let i = 0; i < ${n}; i++) { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '\\u203a'); if (!b || b.disabled) break; b.click(); k++; await new Promise((r) => setTimeout(r, 300)) } return k })()`)
    const stopNo = (port) => overlayHeader(port).then((v) => v?.stop ?? [])
    const ready = (port) => until(() => stopNo(port).then((s) => (s[1] >= 4 ? s : null)), 20000)
    const toThree = async (port) => {
      await ready(port)
      await go(port, 2)
      return until(() => stopNo(port).then((s) => (s[0] === 3 ? s : null)), 5000)
    }
    // A: return-to-first off; same-place reads and a job-file save must leave it on stop 3
    const stays = async () => {
      const { e, port, stop, textFile } = await memLaunch('overlay-stays-on-stop', { jobs, read: true, settings: { overlayReturnToFirst: false } })
      const r = { reads: [], save: null, err: '' }
      try {
        await until(() => (e.jobs()?.where?.name === COVALEX ? true : null), 15000)
        r.at3 = await toThree(port)
        r.name3 = (await overlayHeader(port))?.name ?? null
        for (let i = 0; i < 3; i++) {
          const w = await memRead(e, port, textFile)
          await sleep(1500)
          r.reads.push({ saved: !!w, stop: await stopNo(port), name: (await overlayHeader(port))?.name ?? null })
        }
        // back on stop 3 before the save, so this check stands on its own
        await cdpEval(port, 'overlay', `(async () => { for (let i = 0; i < 6; i++) { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '\\u2039'); if (!b || b.disabled) break; b.click(); await new Promise((r) => setTimeout(r, 200)) } return true })()`)
        r.preSave = await toThree(port)
        const before = (e.jobs()?.jobs ?? []).length
        e.append(L.accept(mission(), 'Bounty Hunt')) // a job-file save that adds no stop
        r.saved = await until(() => ((e.jobs()?.jobs ?? []).length > before ? true : null), 10000)
        await sleep(1500)
        r.save = await stopNo(port)
      } catch (x) {
        r.err = String(x?.message ?? x)
      }
      await stop()
      return r
    }
    // B: return-to-first on, 2 s: back to stop 1 after ~2 s, not at once
    const timer = async () => {
      const { port, stop } = await memLaunch('overlay-stays-on-stop-timer', { jobs, settings: { overlayReturnToFirst: true, overlayReturnSeconds: 2 } })
      const r = { err: '' }
      try {
        r.at3 = await toThree(port)
        const t0 = Date.now()
        await sleep(600)
        r.early = await stopNo(port)
        r.back = await until(() => stopNo(port).then((s) => (s[0] === 1 ? s : null)), 6000)
        r.ms = Date.now() - t0
      } catch (x) {
        r.err = String(x?.message ?? x)
      }
      await stop()
      return r
    }
    // C: return-to-first on with a long wait (20 s): a read at another named place returns to stop 1 right away
    const moved = async () => {
      const { e, port, stop, textFile } = await memLaunch('overlay-stays-on-stop-moved', { jobs, read: true, settings: { overlayReturnToFirst: true, overlayReturnSeconds: 20 } })
      const r = { err: '' }
      try {
        await until(() => (e.jobs()?.where?.name === COVALEX ? true : null), 15000)
        r.at3 = await toThree(port)
        const prev = e.jobs()?.where?.at
        fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_SERAPHIM_HANGAR, zone1: '' }))
        await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
        r.where = await until(() => (e.jobs()?.where?.at !== prev && /Seraphim/.test(e.jobs()?.where?.name ?? '') ? e.jobs().where.name : null), 10000)
        const t0 = Date.now()
        r.back = await until(() => stopNo(port).then((s) => (s[0] === 1 ? s : null)), 4000)
        r.ms = Date.now() - t0
      } catch (x) {
        r.err = String(x?.message ?? x)
      }
      await stop()
      return r
    }
    // D: return-to-first off, Distance order: a read at another place re-orders the stops; the card follows the
    // chosen stop (same overlay-stop-name), whatever its STOP n/m number becomes
    const follows = async () => {
      const { e, port, stop, textFile } = await memLaunch('overlay-stays-on-stop-follows', { jobs, read: true, settings: { overlayReturnToFirst: false } })
      const r = { err: '' }
      const name = () => overlayHeader(port).then((v) => v?.name ?? null)
      try {
        await until(() => (e.jobs()?.where?.name === COVALEX ? true : null), 15000)
        r.at3 = await toThree(port)
        r.before = await name()
        const prev = e.jobs()?.where?.at
        fs.writeFileSync(textFile, JSON.stringify({ zone2: OCR_SERAPHIM_HANGAR, zone1: '' }))
        await cdpEval(port, 'main', 'window.supercargo.otherWhereRun()')
        r.where = await until(() => (e.jobs()?.where?.at !== prev && /Seraphim/.test(e.jobs()?.where?.name ?? '') ? e.jobs().where.name : null), 10000)
        await sleep(2000)
        r.after = await name()
        r.stop = await stopNo(port)
      } catch (x) {
        r.err = String(x?.message ?? x)
      }
      await stop()
      return r
    }
    const [a, b, c, d] = await Promise.all([stays(), timer(), moved(), follows()])
    return [
      ['A: overlay at STOP 3/n (n >= 4) after two ›', a.at3?.[0] === 3 && a.at3[1] >= 4, `at3=${short(a.at3)} ${a.err}`],
      ['A: three WHERE AM I reads at the same place saved', a.reads.length === 3 && a.reads.every((x) => x.saved), `reads=${short(a.reads)} ${a.err}`],
      ['A: same stop (overlay-stop-name) after each same-place read', !!a.name3 && a.reads.length === 3 && a.reads.every((x) => x.name === a.name3), `name3=${a.name3} reads=${short(a.reads)}`],
      ['A: job file saved (new job from the log)', a.saved === true, `saved=${a.saved}`],
      ['A: still STOP 3 after the job-file save', a.preSave?.[0] === 3 && a.save?.[0] === 3, `preSave=${short(a.preSave)} stop=${short(a.save)}`],
      ['B: return on (2 s): at STOP 3, still 3 at 0.6 s', b.at3?.[0] === 3 && b.early?.[0] === 3, `at3=${short(b.at3)} early=${short(b.early)} ${b.err}`],
      ['B: back to STOP 1 within ~2-5 s', b.back?.[0] === 1 && b.ms >= 1000 && b.ms <= 5500, `back=${short(b.back)} ms=${b.ms}`],
      ['C: read at another named place (Seraphim) saved', !!c.where, `where=${c.where} at3=${short(c.at3)} ${c.err}`],
      ['C: start change returns to STOP 1 right away (< 3 s, timer is 20 s)', c.at3?.[0] === 3 && c.back?.[0] === 1 && c.ms < 3000, `at3=${short(c.at3)} back=${short(c.back)} ms=${c.ms}`],
      ['D: return off, read at another place (Seraphim) saved', d.at3?.[0] === 3 && !!d.where, `at3=${short(d.at3)} where=${d.where} ${d.err}`],
      ['D: card still shows the same stop name after the re-order', !!d.before && d.after === d.before, `before=${d.before} after=${d.after} stop=${short(d.stop)}`]
    ]
  },

  // Jobs tab: a tinted job (not-found place) and a fine job keep their KIND cell (job-kind) at the same left edge
  'jobs-kind-aligned': async () => {
    const T = { bad: 'Kind Bad Run', good: 'Kind Good Run' }
    const { port, stop } = await memLaunch('jobs-kind-aligned', {
      jobs: [
        { ref: 'J88', title: T.bad, steps: [goStep('s1', 'Qzxv Brellin Outpost CR-9')] },
        { ref: 'J89', title: T.good, steps: [goStep('s1', 'Port Tressler')] }
      ]
    })
    let v = null
    let err = ''
    try {
      await clickButton(port, 'main', /^JOBS$/)
      await until(() => windowText(port, 'main').then((t) => (t.includes(T.good) && t.includes(T.bad) ? true : null)), 10000)
      await sleep(600)
      v = await cdpEval(
        port,
        'main',
        `(() => {
          const rows = {}
          for (const [k, t] of Object.entries(${JSON.stringify(T)})) {
            const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t))
            // by test id; else (old code) the kind badge by its own text
            const badge = (root) => root ? [...root.querySelectorAll('span, div')].find((el) => /^(DELIVERY|COLLECTION|MINING PO|SALVAGE|HAULING)$/.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())) : null
            const kind = b?.querySelector('[data-testid="job-kind"]') ?? b?.parentElement?.querySelector('[data-testid="job-kind"]') ?? badge(b)
            const r = kind?.getBoundingClientRect()
            const ref = b ? [...b.querySelectorAll('span')].find((el) => /^J8[89]$/.test(el.textContent.trim())) : null
            const rr = ref?.getBoundingClientRect()
            rows[k] = { row: !!b, kind: !!kind, left: r ? Math.round(r.left * 10) / 10 : null, refLeft: rr ? Math.round(rr.left * 10) / 10 : null, issue: b?.closest('[data-issue]')?.getAttribute('data-issue') ?? b?.querySelector('[data-issue]')?.getAttribute('data-issue') ?? null }
          }
          return rows
        })()`
      )
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    return [
      ['both job rows and their job-kind cells found; the bad one is tinted red', !!v?.bad?.kind && !!v?.good?.kind && v.bad.issue === 'red', `v=${short(v)} ${err}`],
      ['job-kind left edge the same (±1 px) on the tinted and the fine row', v?.bad?.left != null && v?.good?.left != null && Math.abs(v.bad.left - v.good.left) <= 1, `bad=${v?.bad?.left} good=${v?.good?.left}`],
      ['ref column (J88 / J89) left edge the same (±1 px) on the tinted and the fine row', v?.bad?.refLeft != null && v?.good?.refLeft != null && Math.abs(v.bad.refLeft - v.good.refLeft) <= 1, `bad=${v?.bad?.refLeft} good=${v?.good?.refLeft}`]
    ]
  },

  // overlay: the Fix panel (MatchFix) opened from the current stop's tag closes when the stop changes (›), or at
  // least never keeps showing the old stop's text
  'overlay-fix-closes': async () => {
    const A = 'Qzxv Brellin Outpost CR-9'
    const B = 'Vxqq Drennor Outpost KT-4'
    const { port, stop } = await memLaunch('overlay-fix-closes', {
      jobs: [
        { ref: 'J90', title: 'Fix Run One', steps: [goStep('s1', A)] },
        { ref: 'J91', title: 'Fix Run Two', steps: [goStep('s1', B)] }
      ]
    })
    const dlg = () =>
      cdpEval(port, 'overlay', `(() => { const d = document.querySelector('[role="dialog"][aria-label="Fix this match"]'); return { open: !!d, text: d?.textContent?.slice(0, 400) ?? '', name: document.querySelector('[data-testid="overlay-stop-name"]')?.textContent ?? null } })()`)
    const r = { err: '' }
    try {
      await until(() => overlayHeader(port).then((v) => (v?.stop?.[1] >= 2 ? v : null)), 15000)
      r.tag = await cdpEval(port, 'overlay', `(() => { const w = document.querySelector('[data-testid="overlay-stop-tag"]'); const b = w?.querySelector('button, [role="button"]') ?? w?.firstElementChild ?? [...document.querySelectorAll('button, [role="button"]')].filter((x) => ${TAG.none}.test(x.textContent.trim())).sort((a, c) => a.textContent.length - c.textContent.length)[0]; if (!b) return false; b.click(); return true })()`)
      r.opened = await until(() => dlg().then((d) => (d.open ? d : null)), 5000)
      r.moved = await cdpEval(port, 'overlay', `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '\\u203a'); if (!b || b.disabled) return false; b.click(); return true })()`)
      await sleep(800)
      r.after = await dlg()
    } catch (x) {
      r.err = String(x?.message ?? x)
    }
    await stop()
    const oldName = r.opened?.name ?? ''
    const newName = r.after?.name ?? ''
    return [
      ['Fix panel opened from the current stop\'s tag', r.tag === true && !!r.opened?.open && !!oldName && r.opened.text.includes(oldName), `tag=${r.tag} opened=${short(r.opened)} ${r.err}`],
      ['› moved to the other stop', r.moved === true && !!newName && newName !== oldName, `old=${oldName} new=${newName}`],
      // user, 2026-10-14: the fix panel closes when its stop changes (never re-targets an open panel)
      ['after ›: Fix panel closed', !!r.after && !r.after.open, `after=${short(r.after)}`]
    ]
  },

  // SCAN CONTRACT confirm screen: the "→ place" text (scan-place) is tinted by the shared stopIssue rule: red for a
  // not-found place, none for an exact one
  'scan-place-tint': async () => {
    const BAD = 'Qzxv Brellin Outpost CR-9'
    const TITLE = 'Scan Tint Delivery'
    const id = mission()
    const RAW = ['Reward 12,500 aUEC', 'Primary Objectives', `Deliver Scrap to ${BAD}`, 'Go to Port Tressler'].join('\n')
    const e = setup('scan-place-tint', { otherStartMode: 'fixed' }, { jobs: [logJob(id, { ref: 'J96', title: TITLE, steps: [] })], history: [], listOrder: 'distance', startLocation: 'Lorville', startTypedAt: iso(ago(60)) })
    const port = await freePort()
    const iport = await freePort()
    const stop = await launch(e, [...cdpArgs(port), ...inspectArgs(iport)])
    let scan = null
    let places = []
    let err = ''
    try {
      scan = await scanToConfirm(port, iport, TITLE, RAW, TAG.none)
      await sleep(500)
      places = await cdpEval(port, 'main', `[...document.querySelectorAll('[data-testid="scan-place"]')].map((x) => ({ text: x.textContent, level: x.getAttribute('data-issue') }))`)
    } catch (x) {
      err = String(x?.message ?? x)
    }
    await stop()
    const bad = (places ?? []).find((p) => /Qzxv/.test(p.text))
    const good = (places ?? []).find((p) => /Port Tressler/.test(p.text))
    return [
      ['UI: OCR stub, JOBS, job row, IMPORT FROM OCR, CAPTURE found', !!scan?.ui && Object.values(scan.ui).every(Boolean), `ui=${short(scan?.ui)} ${err}`],
      ['confirm screen: "→ place" for the not-found place has data-issue red', bad?.level === 'red', `places=${short(places, 600)} confirm=${short(lineWith(confirmPart(scan?.text), /Qzxv|not found/i), 300)}`],
      ['confirm screen: "→ place" for Port Tressler has no data-issue', !!good && !good.level, `places=${short(places, 600)}`]
    ]
  }
}

// --log <file> [--mode live|scan] [--since ISO] [--out result.json] replays a real Game.log and prints
// what Other mode made of each mission. --since seeds lastLogEventAt (scan mode watermark).
async function replayRealLog(file, mode, since, outFile) {
  const text = fs.readFileSync(file, 'utf8')
  const name = `real-${mode}-${path.basename(file).replace(/\W+/g, '_').slice(0, 40)}`
  const e = setup(name, {}, since ? { jobs: [], history: [], lastLogEventAt: since } : undefined)
  let stop
  if (mode === 'scan') {
    fs.writeFileSync(e.gameLog, text)
    stop = await launch(e)
  } else {
    stop = await launch(e)
  }
  if (!stop.ready) {
    await stop()
    console.error(`${name}: APP NOT READY (start-up only, no checks run)`)
    process.exit(3)
  }
  if (mode !== 'scan') {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 300) {
      e.append(...lines.slice(i, i + 300))
      await sleep(150)
    }
    // wait until the app has caught up and saved: the jobs file's watermark reaches the log's last event time
    // and the app log has been quiet for 2 s (a fixed wait lost jobs on a busy machine: 47 of 121 handled, none saved)
    const stamps = text.match(/^<(\d{4}-\d\d-\d\dT[^>]+)>/gm) ?? []
    const lastAt = stamps.length ? stamps[stamps.length - 1].slice(1, -1) : null
    let size = -1
    let quietSince = Date.now()
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      await sleep(500)
      const now = e.log().length
      if (now !== size) {
        size = now
        quietSince = Date.now()
      }
      const mark = e.jobs()?.lastLogEventAt ?? null
      const caughtUp = !lastAt || (mark != null && Date.parse(mark) >= Date.parse(lastAt) - 1)
      if (caughtUp && Date.now() - quietSince >= 2000) break
    }
  }
  await stop()
  const doc = e.jobs() ?? { jobs: [], history: [] }
  const out = { file, mode, since: since ?? null, lastLogEventAt: doc.lastLogEventAt ?? null, jobs: doc.jobs ?? [], history: doc.history ?? [], log: e.log() }
  const dest = outFile ?? path.join(runRoot, `${name}.json`)
  fs.writeFileSync(dest, JSON.stringify(out, null, 1))
  console.log(`${name}: jobs=${out.jobs.length} history=${out.history.length} -> ${dest}`)
  return out
}

const argv = process.argv.slice(2)
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
if (argv[0] === '--log') {
  await replayRealLog(argv[1], opt('--mode') ?? 'live', opt('--since'), opt('--out'))
  process.exit(0)
}

const pick = argv
const names = pick.length ? pick : Object.keys(scenarios)
let failed = 0
console.log(`replay: ${names.length} scenario(s), data under ${runRoot}${useXvfb ? ' (xvfb)' : ''}`)
// scenarios are independent (own data dir, own X display), so run REPLAY_JOBS at once
const jobs = Math.max(1, Number(process.env.REPLAY_JOBS) || os.cpus().length)
const results = new Map()
let next = 0
await Promise.all(
  Array.from({ length: Math.min(jobs, names.length) }, async () => {
    while (next < names.length) {
      const name = names[next++]
      try {
        results.set(name, scenarios[name] ? await scenarios[name]() : [['unknown scenario', false, `try: ${Object.keys(scenarios).join(' ')}`]])
      } catch (e) {
        results.set(name, [['scenario threw', false, String(e?.stack ?? e)]])
      }
    }
  })
)
for (const name of names) {
  for (const [what, ok, detail] of results.get(name)) {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
