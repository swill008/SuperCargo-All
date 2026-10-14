// Updater rules: bundles src/main/releaseNotes.ts (no electron) and checks whatsNew, the version filter and order of
// fetchNotes with a stubbed fetch, Skip This Version and the "Updated — now R1 x" notice.
// Usage: node test/replay/update_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-update-'))
const outfile = path.join(tmp, 'releaseNotes.mjs')
await esbuild.build({
  entryPoints: [path.join(root, 'src/main/releaseNotes.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared') }
})
const R = await import(pathToFileURL(outfile).href)

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}
const J = (x) => JSON.stringify(x)

// whatsNew
const body = [
  'SuperCargo-OtherModes R1 1.2.0',
  '',
  "## What's new in R1 1.2.0",
  '',
  '### New',
  '- **Update window** with notes',
  '',
  '### Fixed',
  '- steady card height',
  '',
  '## Install',
  'Run the Setup.'
].join('\r\n')
const wn = R.whatsNew(body, '1.2.0')
check('whatsNew: R1 heading found', wn?.startsWith('### New'), J(wn))
check('whatsNew: keeps "###" sub-headings', wn?.includes('### Fixed') && wn?.includes('- steady card height'), J(wn))
check('whatsNew: next "## " heading stops it', !wn?.includes('Install') && !wn?.includes('Setup'), J(wn))
check('whatsNew: trimmed', wn === wn?.trim())
check('whatsNew: plain "## What\'s new in <v>"', R.whatsNew("## What's new in 1.1.0\n- a\n# Top\n- b", '1.1.0') === '- a')
check('whatsNew: "# " heading stops it too', !R.whatsNew("## What's new in 1.1.0\n- a\n# Top\n- b", '1.1.0')?.includes('b'))
check('whatsNew: curly apostrophe', R.whatsNew('## What’s new in R1 1.1.0\n- a', '1.1.0') === '- a')
check('whatsNew: to the end when no next heading', R.whatsNew("## What's new in 1.1.0\n- a\n- b\n", '1.1.0') === '- a\n- b')
check('whatsNew: other version -> null', R.whatsNew(body, '1.1.0') === null)
check('whatsNew: missing -> null', R.whatsNew('Just text\n## Install\n- x', '1.2.0') === null)
check('whatsNew: empty/null body -> null', R.whatsNew('', '1.0.0') === null && R.whatsNew(null, '1.0.0') === null)
check('whatsNew: empty section -> null', R.whatsNew("## What's new in 1.1.0\n\n## Install", '1.1.0') === null)
check('whatsNew: 1.1.0 does not match 1.1.00 or 1.1.0.1', R.whatsNew("## What's new in 1.1.0.1\n- a", '1.1.0') === null)

// versions
check('versionFromTag: product tag', R.versionFromTag('SuperCargo-OtherModes-R1-1.2.0') === '1.2.0')
check('versionFromTag: v tag', R.versionFromTag('v1.2.0') === '1.2.0' && R.versionFromTag('1.2.0') === '1.2.0')
check('versionFromTag: others -> null', R.versionFromTag('Other-Thing-2.0') === null && R.versionFromTag('v1.2.0-beta') === null)
check('compareVersions', R.compareVersions('1.10.0', '1.9.0') === 1 && R.compareVersions('1.0', '1.0.0') === 0 && R.compareVersions('1.0.0', '1.0.1') === -1)

// fetchNotes: current < version <= offered, newest first, with a stubbed fetch
const rel = (tag, v, extra = {}) => ({ tag_name: tag, body: `## What's new in R1 ${v}\n- change ${v}\n## Install\n- x`, ...extra })
const list = [
  rel('SuperCargo-OtherModes-R1-1.0.0', '1.0.0'),
  rel('SuperCargo-OtherModes-R1-1.1.0', '1.1.0'),
  rel('SuperCargo-OtherModes-R1-1.3.0', '1.3.0'),
  rel('SuperCargo-OtherModes-R1-1.2.0', '1.2.0'),
  rel('SuperCargo-OtherModes-R1-1.4.0', '1.4.0'),
  rel('SuperCargo-OtherModes-R1-1.2.5', '1.2.5', { draft: true }),
  rel('SuperCargo-OtherModes-R1-1.2.6', '1.2.6', { prerelease: true }),
  { tag_name: 'SuperCargo-OtherModes-R1-1.2.7', body: 'no what is new part' },
  rel('Something-Else-9', '1.2.8')
]
let seen = null
const okFetch = async (url, init) => {
  seen = { url, init }
  return { ok: true, json: async () => list }
}
const notes = await R.fetchNotes('1.0.0', '1.3.0', null, okFetch)
check('fetchNotes: versions in (current, offered], newest first', J(notes?.map((n) => n.version)) === J(['1.3.0', '1.2.0', '1.1.0']), J(notes))
check('fetchNotes: each note is its What\'s new', notes?.[0]?.markdown === '- change 1.3.0', J(notes?.[0]))
check('fetchNotes: GitHub releases API', seen?.url?.startsWith('https://api.github.com/repos/swill008/SuperCargo-All/releases'), seen?.url)
check('fetchNotes: Accept header', seen?.init?.headers?.Accept === 'application/vnd.github+json')
check('fetchNotes: has a timeout signal', !!seen?.init?.signal)
const one = await R.fetchNotes('1.2.0', '1.3.0', null, okFetch)
check('fetchNotes: one version', J(one?.map((n) => n.version)) === J(['1.3.0']), J(one))
const offline = async () => {
  throw new Error('offline')
}
const fb = await R.fetchNotes('1.0.0', '1.3.0', "## What's new in R1 1.3.0\n- own notes", offline)
check('fetchNotes: no network -> the offered release\'s own notes', J(fb) === J([{ version: '1.3.0', markdown: '- own notes' }]), J(fb))
check('fetchNotes: no network, no own notes -> null', (await R.fetchNotes('1.0.0', '1.3.0', null, offline)) === null)
const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) })
check('fetchNotes: HTTP error, no own notes -> null', (await R.fetchNotes('1.0.0', '1.3.0', 'html text', notFound)) === null)
check('fetchNotes: nothing in range -> null', (await R.fetchNotes('1.4.0', '1.4.0', null, okFetch)) === null)

check('releaseNotesText: string', R.releaseNotesText('x', '1.0.0') === 'x')
check('releaseNotesText: list', R.releaseNotesText([{ version: '1.0.0', note: 'a' }, { version: '1.1.0', note: 'b' }], '1.1.0') === 'b')
check('releaseNotesText: none', R.releaseNotesText(null, '1.0.0') === null)

// Skip This Version
check('skip: start-up check, skipped version -> quiet', R.isSkipped('1.3.0', '1.3.0', false) === true)
check('skip: by hand always shows it', R.isSkipped('1.3.0', '1.3.0', true) === false)
check('skip: newer than the skipped one is offered', R.isSkipped('1.4.0', '1.3.0', false) === false)
check('skip: nothing skipped', R.isSkipped('1.3.0', undefined, false) === false)

// Updated notice
check('notice: older last run -> {from,to}', J(R.updatedNoticeFor('1.0.0', '1.1.0')) === J({ from: '1.0.0', to: '1.1.0' }))
check('notice: first run (no lastRunVersion) -> null', R.updatedNoticeFor(undefined, '1.1.0') === null)
check('notice: same version -> null', R.updatedNoticeFor('1.1.0', '1.1.0') === null)
check('notice: older version running -> null', R.updatedNoticeFor('1.2.0', '1.1.0') === null)

// updater.ts wiring (source text): asks first, no install on quit, test feed hook
const upd = fs.readFileSync(path.join(root, 'src/main/updater.ts'), 'utf8')
check('updater: autoDownload = false', /au\.autoDownload = false/.test(upd))
check('updater: autoInstallOnAppQuit = false', /au\.autoInstallOnAppQuit = false/.test(upd))
check('updater: SC_TEST_UPDATE_FEED hook', upd.includes('SC_TEST_UPDATE_FEED') && upd.includes("'update install (test)'"))
const store = fs.readFileSync(path.join(root, 'src/main/store.ts'), 'utf8')
check('store: autoCheckUpdates defaults to true', /autoCheckUpdates: true/.test(store) && !/autoCheckUpdates = false/.test(store))

// Cancel (user 2026-10-14, like Gremlin): updater.ts bundled with electron, electron-updater and the logger stubbed
const stubDir = path.join(tmp, 'stubs')
fs.mkdirSync(stubDir)
fs.writeFileSync(path.join(stubDir, 'electron.mjs'), "export const app = { getVersion: () => '1.0.0', isPackaged: true }\n")
fs.writeFileSync(path.join(stubDir, 'logger.mjs'), "export const logs = (globalThis.__updLogs = [])\nexport const logger = { info: (c, m, d) => logs.push(m), warn: (c, m, d) => logs.push(m), debug: () => {} }\n")
fs.writeFileSync(
  path.join(stubDir, 'electron-updater.mjs'),
  `class CancellationError extends Error { constructor() { super('cancelled') } }
class CancellationToken { constructor() { this.cancelled = false; this.subs = [] } cancel() { this.cancelled = true; this.subs.forEach((f) => f()) } }
const handlers = {}
export const fake = (globalThis.__updFake = { calls: [], handlers })
fake.CancellationError = CancellationError
const autoUpdater = {
  on: (ev, f) => { handlers[ev] = f },
  checkForUpdates: async () => {},
  downloadUpdate: (token) => {
    fake.calls.push(token)
    return new Promise((res, rej) => { token.subs.push(() => rej(new CancellationError())); fake.finish = res })
  }
}
export default { autoUpdater, CancellationToken }
export { CancellationError }
`
)
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(stubDir, 'electron.mjs') }))
    b.onResolve({ filter: /^electron-updater$/ }, () => ({ path: path.join(stubDir, 'electron-updater.mjs') }))
    b.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: path.join(stubDir, 'logger.mjs') }))
  }
}
async function loadUpdater(name) {
  const out = path.join(tmp, name)
  await esbuild.build({
    entryPoints: [path.join(root, 'src/main/updater.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    plugins: [stubPlugin],
    tsconfig: path.join(root, 'tsconfig.node.json'),
    alias: { '@shared': path.join(root, 'src/shared') },
  })
  const mod = await import(pathToFileURL(out).href)
  return { ...mod, fake: globalThis.__updFake, CancellationError: globalThis.__updFake.CancellationError, logs: globalThis.__updLogs }
}
// no network: release notes fall back to the offer's own text
globalThis.fetch = async () => {
  throw new Error('offline (test)')
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const offer = { kind: 'available', version: '1.3.0', notes: [{ version: '1.3.0', markdown: '- a' }], url: 'https://x/1.3.0', portable: false, sizeBytes: 5 }

{
  const U = await loadUpdater('updater_real.mjs')
  check('cancel: offerAfterCancel keeps the same offer', U.offerAfterCancel(offer, '1.3.0') === offer)
  const fbk = U.offerAfterCancel(null, '1.3.0')
  check('cancel: offerAfterCancel with no offer -> available for that version', fbk.kind === 'available' && fbk.version === '1.3.0' && fbk.url.includes('1.3.0') && fbk.portable === false, J(fbk))
  check('cancel: offerAfterCancel other version -> that version', U.offerAfterCancel(offer, '1.4.0').version === '1.4.0')
  check('cancel: isCancelError(CancellationError)', U.isCancelError(new U.CancellationError()) === true)
  check('cancel: isCancelError(other error) false', U.isCancelError(new Error('net::ERR_FAILED')) === false && U.isCancelError(null) === false && U.isCancelError('cancelled') === false)

  // real path with the stubbed autoUpdater
  const sent = []
  const win = { isDestroyed: () => false, webContents: { send: (_ch, st) => sent.push(st) } }
  U.initUpdater({ getWindow: () => win, getSettings: () => ({ lastRunVersion: '1.0.0' }), updateSettings: () => {} })
  U.fake.handlers['update-available']({ version: '1.3.0', files: [{ size: 5 }], releaseNotes: "## What's new in R1 1.3.0\n- a" })
  for (let i = 0; i < 50 && U.lastUpdateState()?.kind !== 'available'; i++) await tick(10)
  const shown = U.lastUpdateState()
  check('cancel(real): offer shown first', shown?.kind === 'available' && shown.version === '1.3.0', J(shown))
  const dl = U.downloadUpdate()
  await tick()
  const token = U.fake.calls[0]
  check('cancel(real): downloadUpdate gets a CancellationToken', !!token && token.cancelled === false && U.lastUpdateState()?.kind === 'downloading')
  U.cancelDownload()
  check('cancel(real): token cancelled', token?.cancelled === true)
  await dl
  await tick()
  const after = U.lastUpdateState()
  check('cancel(real): back to the same offer, not failed', after === shown, J(after))
  check('cancel(real): nothing sent as failed', !sent.some((st) => st.kind === 'failed'), J(sent.map((st) => st.kind)))
  check('cancel(real): logged', U.logs.includes('update download cancelled'))
  U.fake.handlers['download-progress']({ percent: 50, transferred: 1, total: 2 })
  check('cancel(real): late progress ignored', U.lastUpdateState() === shown)
  U.fake.handlers['error'](new U.CancellationError())
  check('cancel(real): cancel error event not failed', U.lastUpdateState() === shown)
  // Update Now again: a fresh token, download from the start
  const dl2 = U.downloadUpdate()
  await tick()
  const token2 = U.fake.calls[1]
  check('cancel(real): Update Now again starts a new download', !!token2 && token2 !== token && token2.cancelled === false && U.lastUpdateState()?.kind === 'downloading' && U.lastUpdateState().percent === 0)
  U.fake.handlers['error'](new Error('net down'))
  check('cancel(real): a real error still -> failed', U.lastUpdateState()?.kind === 'failed', J(U.lastUpdateState()))
  U.fake.finish()
  await dl2
  U.cancelDownload()
  check('cancel(real): cancel when not downloading does nothing', U.lastUpdateState()?.kind === 'failed')
}

{
  // test feed: cancel stops the timer steps and offers the version again
  const feedFile = path.join(tmp, 'feed.json')
  fs.writeFileSync(feedFile, J({ version: '1.3.0', notes: [{ version: '1.3.0', markdown: '- a' }] }))
  process.env.SC_TEST_UPDATE_FEED = feedFile
  const U = await loadUpdater('updater_feed.mjs')
  const sent = []
  const win = { isDestroyed: () => false, webContents: { send: (_ch, st) => sent.push(st) } }
  U.initUpdater({ getWindow: () => win, getSettings: () => ({ lastRunVersion: '1.0.0' }), updateSettings: () => {} })
  await U.checkForUpdates(true)
  const shown = U.lastUpdateState()
  const dl = U.downloadUpdate()
  await tick(200)
  check('cancel(feed): downloading', U.lastUpdateState()?.kind === 'downloading')
  U.cancelDownload()
  check('cancel(feed): back to the offer', U.lastUpdateState() === shown, J(U.lastUpdateState()))
  await dl
  await tick(500)
  check('cancel(feed): timer steps stopped (no ready, no more downloading)', U.lastUpdateState() === shown && !sent.some((st) => st.kind === 'ready'), J(sent.map((st) => st.kind)))
  check('cancel(feed): logged', U.logs.includes('update download cancelled'))
  const dl2 = U.downloadUpdate()
  await dl2
  check('cancel(feed): Update Now again runs to ready', U.lastUpdateState()?.kind === 'ready')
  delete process.env.SC_TEST_UPDATE_FEED
}

// source text: the cancel is not turned into "failed"
check('updater: downloadUpdate(token) with a CancellationToken', /new electronUpdater\.CancellationToken\(\)/.test(upd) && /downloadUpdate\(token\)/.test(upd))
check('updater: cancelDownload exported, calls token.cancel()', /export function cancelDownload\(\): void/.test(upd) && /downloadToken\?\.cancel\(\)/.test(upd))
check('updater: cancel error returns before failCurrent', /if \(token\.cancelled \|\| isCancelError\(e\)\) return[^\n]*\n\s*logger\.warn\('net', 'update download failed'[^\n]*\n\s*failCurrent/.test(upd))
check("updater: 'error' event ignores a cancel", /au\.on\('error', \(err\) => \{\s*if \(isCancelError\(err\)\) return/.test(upd))
const win = fs.readFileSync(path.join(root, 'src/renderer/src/components/UpdateWindow.tsx'), 'utf8')
check('window: closing while downloading cancels (state read at close time)', /if \(useStore\.getState\(\)\.update\?\.kind === 'downloading'\) void window\.supercargo\.cancelUpdateDownload\(\)/.test(win))
check('window: Cancel button while downloading (like Gremlin)', /kind === 'downloading' && <Act onClick=\{\(\) => void window\.supercargo\.cancelUpdateDownload\(\)\}>Cancel<\/Act>/.test(win))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`update checks: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
