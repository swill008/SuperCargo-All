// REFRESH re-scan checks: bundles src/other/main/scanLog.ts (electron stubbed) and calls
// pickRefreshEvents (pure) and scanMarkersFor (real files: logbackups newest + Game.log, no watermark).
// Reference data checks: bundles src/main/dataSync.ts with SC_TEST_REFDATA_BASE at a local file:// dir and checks each
// file state (up to date, updated, wrong hash, bad shape, missing file, unreachable list) and the saved status.
// Usage: node test/replay/refresh_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-refresh-checks-'))
const outfile = path.join(tmp, 'scanLog.mjs')
const stubElectron = {
  name: 'stub-electron',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `const ud = ${JSON.stringify(path.join(tmp, 'userData'))};
        export const app = { getPath: () => ud, getVersion: () => '0', on() {}, isPackaged: false };
        export const BrowserWindow = { getAllWindows: () => [] };
        export const ipcMain = { handle() {}, on() {} };
        export const screen = {}; export const shell = {}; export const net = {};
        export default { app, BrowserWindow, ipcMain };`,
      loader: 'js'
    }))
  }
}
await esbuild.build({
  entryPoints: [path.join(root, 'src/other/main/scanLog.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  plugins: [stubElectron],
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
})
fs.mkdirSync(path.join(tmp, 'userData'), { recursive: true })
// the app's data folder is <HOME>/SuperCargo (src/main/paths.ts, os.homedir()): point HOME at the temp folder so a
// module that logs or saves never touches the real user folder
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home')
fs.mkdirSync(process.env.HOME, { recursive: true })
const S = await import(pathToFileURL(outfile).href)

let fails = 0
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || info === undefined ? '' : '  ' + JSON.stringify(info)}`)
  if (!ok) fails++
}

// ---- pure filter
const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const evs = [
  { kind: 'session', at: '2026-10-14T10:00:00.000Z', build: '12913470' },
  { kind: 'accepted', at: '2026-10-14T10:01:00.000Z', missionId: A, title: 'x' },
  { kind: 'marker', at: '2026-10-14T10:01:01.000Z', missionId: A, objectiveId: 'o1', zoneHostId: '1', x: 1, y: 2, z: 3 },
  { kind: 'objective', at: '2026-10-14T10:01:02.000Z', missionId: A, text: 'Deliver' },
  { kind: 'marker', at: '2026-10-14T10:02:00.000Z', missionId: B, objectiveId: 'o2', zoneHostId: '1', x: 4, y: 5, z: 6 },
  { kind: 'ended', at: '2026-10-14T10:03:00.000Z', missionId: B, outcome: 'complete', completionType: 'Complete' },
  { kind: 'session', at: '2026-10-14T11:00:00.000Z' }
]
const picked = S.pickRefreshEvents(evs, [A])
check('pick: only sessions + markers of the asked missions, in order',
  JSON.stringify(picked.map((e) => `${e.kind}:${e.missionId ?? ''}`)) === JSON.stringify(['session:', `marker:${A}`, 'session:']),
  picked)
check('pick: empty mission list keeps only sessions', S.pickRefreshEvents(evs, []).every((e) => e.kind === 'session'))

// ---- real files: backup (older session, has A's marker) + Game.log (newer session, B's marker)
const stamp = (at) => `<${at}>`
const marker = (id, at) =>
  `${stamp(at)} [Notice] <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [${id}], generator name [FTL_Courier], contract [FTL_Courier_Stanton_Iron_Rank1], contractDefinitionId[0d41bca1-0bd1-4aad-bf63-9436567a221a], objectiveId [dropoff_x_0], markerEntityId [7145], zoneHostId [862321816216], position [x: -790556.763184, y: 614240.106819, z: -6055.992337] [Team_MissionFeatures][Missions]`
const accept = (id, at) =>
  `${stamp(at)} [Notice] <SHUDEvent_OnNotification> Added notification "Contract Accepted:  Deliver Iron: " [3] to queue. New queue size: 1, MissionId: [${id}], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]`
const session = (at, txt) => [
  `${stamp(at)} BackupNameAttachment=" Build(12913470) 14 Oct 26 (10 12 26)"  -- used by backup system`,
  `${stamp(at)} Log started on ${txt}`
]
const logDir = path.join(tmp, 'game')
fs.mkdirSync(path.join(logDir, 'logbackups'), { recursive: true })
const older = path.join(logDir, 'logbackups', 'Game_old.log')
const newest = path.join(logDir, 'logbackups', 'Game_new.log')
fs.writeFileSync(older, [...session('2026-10-10T08:00:00.000Z', 'Sat Oct 10 08:00:00 2026'), marker(A, '2026-10-10T08:01:00.000Z')].join('\n'))
fs.writeFileSync(newest, [
  ...session('2026-10-13T08:00:00.000Z', 'Tue Oct 13 08:00:00 2026'),
  accept(A, '2026-10-13T08:00:30.000Z'),
  marker(A, '2026-10-13T08:01:00.000Z')
].join('\n'))
const past = new Date('2026-10-10T00:00:00Z')
fs.utimesSync(older, past, past)
const game = path.join(logDir, 'Game.log')
fs.writeFileSync(game, [
  ...session('2026-10-14T09:00:00.000Z', 'Wed Oct 14 09:00:00 2026'),
  accept(B, '2026-10-14T09:00:30.000Z'),
  marker(B, '2026-10-14T09:01:00.000Z'),
  marker(A, '2026-10-14T09:02:00.000Z')
].join('\n'))

const r = await S.scanMarkersFor(game, [A])
check('scan: reads newest backup then Game.log', JSON.stringify(r.files) === JSON.stringify([newest, game]), r.files)
const shape = r.events.map((e) => `${e.kind}@${e.at.slice(0, 10)}${e.kind === 'marker' ? ':' + e.missionId.slice(0, 1) : ''}`)
check('scan: sessions + A markers only, backup first, no watermark',
  JSON.stringify(shape) === JSON.stringify(['session@2026-10-13', 'marker@2026-10-13:a', 'session@2026-10-14', 'marker@2026-10-14:a']),
  shape)
check('scan: session carries build', r.events[0].kind === 'session' && r.events[0].build === '12913470', r.events[0])
check('scan: ms is a number', typeof r.ms === 'number' && r.ms >= 0)
const none = await S.scanMarkersFor(game, [])
check('scan: no missions -> no events', none.events.length === 0)
const nolog = await S.scanMarkersFor(undefined, [A])
check('scan: no log path -> empty', nolog.events.length === 0 && nolog.files.length === 0)

// ---- reference data status (dataSync.ts)
const dsOut = path.join(tmp, 'dataSync.mjs')
await esbuild.build({
  stdin: {
    contents: "export * from './src/main/dataSync'; export { dataPath } from './src/main/paths'",
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: dsOut,
  logLevel: 'error',
  plugins: [stubElectron],
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
})
const crypto = await import('node:crypto')
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const base = path.join(tmp, 'refbase')
fs.mkdirSync(base, { recursive: true })
process.env.SC_TEST_REFDATA_BASE = pathToFileURL(base).href
const D = await import(pathToFileURL(dsOut).href)
const FILES = [
  ['ships', 'ships.json', 'uex-vehicles.json'],
  ['locations', 'locations.json', 'uex-locations.json'],
  ['commodities', 'commodities.json', 'uex-commodities.json'],
  ['gridFaces', 'grid-faces.json', 'uex-grid-faces.json'],
  ['contractOverrides', 'contract-overrides.json', 'uex-contract-overrides.json']
]
const body = (key, n) => JSON.stringify({ [key]: [{ id: n }] })
const stateOf = (st) => Object.fromEntries(st.files.map((f) => [f.key, f.state]))

const fresh = D.loadRefDataStatus()
check('refdata: never checked -> notChecked for all 5, checkedAt null',
  fresh.checkedAt === null && fresh.files.length === 5 && fresh.files.every((f) => f.state === 'notChecked'), fresh)
check('refdata: labels', fresh.files.map((f) => f.label).join('|') === 'Ships|Locations|Commodities|Cargo grids|Contract box sizes', fresh.files)

// unreachable list (no hashes.json at the base)
let sent = []
D.setRefDataBroadcast((s) => sent.push(s))
const before = Date.now()
let res = await D.refreshFromRepo()
check('refdata: list unreachable -> reached false, all downloadFailed',
  res.reached === false && res.status && res.status.files.every((f) => f.state === 'downloadFailed' && f.detail === "couldn't reach the list" && f.at >= before), res)
check('refdata: broadcast after the check', sent.length === 1 && sent[0].checkedAt === res.status.checkedAt)

// local copies: ships current, locations old; base: locations new (good), commodities wrong hash, gridFaces bad shape,
// contractOverrides listed but missing from the base
for (const [key, , cache] of FILES) fs.writeFileSync(D.dataPath(cache), body(key, 0))
const hashes = {}
for (const [key, repo] of FILES) {
  const b = key === 'ships' ? body(key, 0) : key === 'gridFaces' ? JSON.stringify({ wrong: [] }) : body(key, 1)
  if (key !== 'contractOverrides') fs.writeFileSync(path.join(base, repo), b)
  hashes[key] = key === 'commodities' ? sha('something else') : sha(key === 'contractOverrides' ? body(key, 1) : b)
}
fs.writeFileSync(path.join(base, 'hashes.json'), JSON.stringify(hashes))
res = await D.refreshFromRepo()
const st = stateOf(res.status)
check('refdata: reached true', res.reached === true && res.status.reached === true)
check('refdata: ships same fingerprint -> upToDate', st.ships === 'upToDate', st)
check('refdata: locations new -> updated + written', st.locations === 'updated' &&
  fs.readFileSync(D.dataPath('uex-locations.json'), 'utf8') === body('locations', 1), st)
check('refdata: commodities wrong hash -> hashMismatch, old kept', st.commodities === 'hashMismatch' &&
  fs.readFileSync(D.dataPath('uex-commodities.json'), 'utf8') === body('commodities', 0), st)
check('refdata: gridFaces bad shape -> badFormat, old kept', st.gridFaces === 'badFormat' &&
  fs.readFileSync(D.dataPath('uex-grid-faces.json'), 'utf8') === body('gridFaces', 0), st)
check('refdata: contractOverrides missing -> downloadFailed', st.contractOverrides === 'downloadFailed', st)
check('refdata: result lists only updated', res.changed === true && JSON.stringify(res.updated) === JSON.stringify(['locations']), res.updated)
check('refdata: every file has a detail', res.status.files.every((f) => typeof f.detail === 'string' && f.detail.length > 0))

// saved and reloaded
const saved = D.loadRefDataStatus()
check('refdata: status saved to the data folder', fs.existsSync(D.dataPath('reference-data-status.json')))
check('refdata: reload keeps states, times, checkedAt',
  JSON.stringify(stateOf(saved)) === JSON.stringify(st) && saved.checkedAt === res.status.checkedAt &&
  saved.files.every((f, i) => f.at === res.status.files[i].at), saved)
check('refdata: refDataStatus() = saved', JSON.stringify(D.refDataStatus().files) === JSON.stringify(saved.files))

// fix the wrong hash: next check updates it; locations now up to date
hashes.commodities = sha(fs.readFileSync(path.join(base, 'commodities.json'), 'utf8'))
fs.writeFileSync(path.join(base, 'hashes.json'), JSON.stringify(hashes))
res = await D.refreshFromRepo()
const st2 = stateOf(res.status)
check('refdata: fixed file -> updated, done one -> upToDate', st2.commodities === 'updated' && st2.locations === 'upToDate', st2)

// two checks at once share one run
const [p1, p2] = [D.refreshFromRepo(), D.refreshFromRepo()]
check('refdata: concurrent checks share one run', p1 === p2)
await p1

// garbage status file -> notChecked, no throw
fs.writeFileSync(D.dataPath('reference-data-status.json'), '{nope')
const bad = D.loadRefDataStatus()
check('refdata: unreadable status -> notChecked', bad.checkedAt === null && bad.files.every((f) => f.state === 'notChecked'), bad)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILED` : '\nall refresh checks passed')
process.exit(fails ? 1 : 0)
