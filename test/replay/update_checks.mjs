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

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`update checks: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
