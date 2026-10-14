// Replays a made-up Game.log through the real app (watcher -> main -> both windows -> other-jobs.json).
// Each scenario gets a fresh data folder. Expectations are the intended behaviour, so a FAIL is a bug.
// Usage: npm run build && node test/replay/replay.mjs [scenario-name ...]
// Real logs: node test/replay/run_all.mjs (every fixture in test/replay/fixtures, live and scan)
// Linux runs under xvfb-run when it is installed; Windows opens real windows.

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-replay-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const useXvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0

let seq = 0
let nextDisplay = 90 + (process.pid % 50) * 20 // distinct X display per launch, so parallel runs don't race
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

function dataDir(home) {
  return process.platform === 'win32' ? path.join(home, 'AppData', 'Roaming', 'supercargo') : path.join(home, '.config', 'supercargo')
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
    jobs: () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(data, 'other-jobs.json'), 'utf8'))
      } catch {
        return null
      }
    },
    log: () => {
      try {
        return fs.readFileSync(path.join(data, 'logs', 'supercargo.log'), 'utf8')
      } catch {
        return ''
      }
    }
  }
}

async function launch(env, extraArgs = [], extraEnv = {}) {
  const appEnv = { ...process.env, HOME: env.home, USERPROFILE: env.home, APPDATA: path.join(env.home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(env.home, '.config'), ...extraEnv }
  delete appEnv.ELECTRON_RENDERER_URL
  const args = [root, '--no-sandbox', ...extraArgs]
  const child = useXvfb
    ? spawn('xvfb-run', ['-n', String(nextDisplay++), electron, ...args], { env: appEnv, detached: true, stdio: 'ignore' })
    : spawn(electron, args, { env: appEnv, detached: process.platform !== 'win32', stdio: 'ignore' })
  // ready once the main window has bound its listeners (and, in Other mode, run the start-up scan);
  // a fixed wait was flaky with several apps starting at once
  const logFile = path.join(env.data, 'logs', 'supercargo.log')
  const ready = /\[main\] (startup scan|init loaded)/
  const t0 = Date.now()
  while (Date.now() - t0 < 45000) {
    let text = ''
    try {
      text = fs.readFileSync(logFile, 'utf8')
    } catch {
      // not written yet
    }
    if (ready.test(text) && (!/workMode=other/.test(text) || /\[main\] startup scan/.test(text) || /startup scan skipped/.test(text))) break
    await sleep(250)
  }
  await sleep(1000)
  return async () => {
    await sleep(1500) // let saves and the 500 ms log flush land
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      else process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    await sleep(1500)
  }
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
  const ws = new WebSocket(t.webSocketDebuggerUrl)
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
    return Object.values(d).flat().filter((l) => l && typeof l === 'object' && l.name)
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

// --export-diagnostics <file>: the app writes it ~6 s after the main window loads
const DIAG_SECTIONS = ['SUMMARY', 'SETTINGS', 'SNAPSHOT', 'UNKNOWN LINES', 'DECISIONS', 'PERF', 'USAGE', 'ERRORS', 'DEBUG LOG', 'LOG EXCERPT']
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
    const afterAbandon = findJob(e.jobs(), id)?.status
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
      try {
        overlay = await until(() => windowText(port, 'overlay').then((t) => (/Port Tressler/.test(t) ? t : '')), 8000)
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
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 300) {
      e.append(...lines.slice(i, i + 300))
      await sleep(150)
    }
    await sleep(4000)
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
