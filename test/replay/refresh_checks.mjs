// REFRESH re-scan checks: bundles src/other/main/scanLog.ts (electron stubbed) and calls
// pickRefreshEvents (pure) and scanMarkersFor (real files: logbackups newest + Game.log, no watermark).
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

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILED` : '\nall refresh checks passed')
process.exit(fails ? 1 : 0)
