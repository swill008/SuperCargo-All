// Replays a made-up Game.log through the real app (watcher -> main -> both windows -> other-jobs.json).
// Each scenario gets a fresh data folder. Expectations are the intended behaviour, so a FAIL is a bug.
// Usage: npm run build && node test/replay/replay.mjs [scenario-name ...]
// Linux runs under xvfb-run when it is installed; Windows opens real windows.

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-replay-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const useXvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0

let seq = 0
const mission = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const stamp = () => `<${new Date().toISOString()}>`
const L = {
  accept: (id, title) =>
    `${stamp()} [Notice] <SHUDEvent_OnNotification> Added notification "Contract Accepted:  ${title}: " [3] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions]`,
  objective: (id, text) =>
    `${stamp()} [Notice] <SHUDEvent_OnNotification> Added notification "New Objective: ${text}: " [4] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [obj_1] [Team_CoreGameplayFeatures][Missions]`,
  end: (id, type) =>
    `${stamp()} [Notice] <EndMission> Ending mission for player. MissionId[${id}] Player[Tester] PlayerId[1] CompletionType[${type}] Reason[] [Team_CoreGameplayFeatures][Missions]`,
  drop: () => `${stamp()} [Notice] <Channel Disconnected> cause=30018 reason="Remote Disconnect - Player requested disconnect" frame=1 isRemote=1 viewState=eCVS_InGame [Team_Network]`
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

async function launch(env) {
  const appEnv = { ...process.env, HOME: env.home, USERPROFILE: env.home, APPDATA: path.join(env.home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(env.home, '.config') }
  delete appEnv.ELECTRON_RENDERER_URL
  const args = [root, '--no-sandbox']
  const child = useXvfb
    ? spawn('xvfb-run', ['-a', electron, ...args], { env: appEnv, detached: true, stdio: 'ignore' })
    : spawn(electron, args, { env: appEnv, detached: process.platform !== 'win32', stdio: 'ignore' })
  await sleep(7000) // windows load, listeners bind, start-up scan runs
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

const count = (text, re) => (text.match(re) || []).length
const allJobs = (doc) => [...(doc?.jobs ?? []), ...(doc?.history ?? []).map((h) => h.job ?? h)]

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

  // #7 a job the user archived is not re-created by the start-up scan
  'archived-stays-archived': async () => {
    const id = mission()
    const job = { id, ref: 'J01', title: 'Bounty Hunt', kind: 'delivery', reward: 0, status: 'abandoned', steps: [], createdAt: Date.now(), missionId: id, source: 'log' }
    const e = setup('archived-stays-archived', {}, { jobs: [], history: [{ job, outcome: 'abandoned', movedBy: 'manual', at: Date.now() }] })
    e.append(L.accept(id, 'Bounty Hunt'))
    const stop = await launch(e)
    await stop()
    const active = (e.jobs()?.jobs ?? []).filter((j) => j.id === id || j.missionId === id)
    return [['archived mission not re-created as active', active.length === 0, `active copies=${active.length}`]]
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
  }
}

// --log <file> [--mode live|scan] replays a real Game.log and prints what Other mode made of each mission
async function replayRealLog(file, mode) {
  const text = fs.readFileSync(file, 'utf8')
  const name = `real-${mode}-${path.basename(file).replace(/\W+/g, '_').slice(0, 40)}`
  const e = setup(name)
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
  const out = { file, mode, jobs: doc.jobs ?? [], history: doc.history ?? [], log: e.log() }
  fs.writeFileSync(path.join(runRoot, `${name}.json`), JSON.stringify(out, null, 1))
  console.log(`${name}: jobs=${out.jobs.length} history=${out.history.length} -> ${path.join(runRoot, name + '.json')}`)
  return out
}

const argv = process.argv.slice(2)
if (argv[0] === '--log') {
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'live'
  await replayRealLog(argv[1], mode)
  process.exit(0)
}

const pick = argv
const names = pick.length ? pick : Object.keys(scenarios)
let failed = 0
console.log(`replay: ${names.length} scenario(s), data under ${runRoot}${useXvfb ? ' (xvfb)' : ''}`)
for (const name of names) {
  const checks = await scenarios[name]()
  for (const [what, ok, detail] of checks) {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
