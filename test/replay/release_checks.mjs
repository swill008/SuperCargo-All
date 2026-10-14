// Release setup checks (no build needed): release notes, electron-builder.yml names /
// targets / publish repo, the NSIS shortcut include, the release workflows, and the
// shared release naming (src/shared/release.ts). Usage: node test/replay/release_checks.mjs

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
// line endings normalised: the release runs on a Windows checkout (CRLF), and '.' in these patterns never matches \r
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const pkg = JSON.parse(read('package.json'))
const version = pkg.version
const base = `SuperCargo-OtherModes-R1-${version}`

// --- version + notes --------------------------------------------------------
check('package.json version is plain semver', /^\d+\.\d+\.\d+$/.test(version), version)
check('package.json version is 1.0.0 (R1 1.0.0)', version === '1.0.0', version)
const lock = JSON.parse(read('package-lock.json'))
check('package-lock.json version matches', lock.version === version && lock.packages[''].version === version)
const notesFile = path.join(root, 'release-notes', `${version}.md`)
check(`release-notes/${version}.md exists`, fs.existsSync(notesFile))
if (fs.existsSync(notesFile)) {
  const first = fs.readFileSync(notesFile, 'utf8').replace(/^﻿/, '').replace(/^\s+/, '').split(/\r?\n/, 1)[0]
  check('notes start with the R1 heading', first === `## What's new in R1 ${version}`, first)
}
check('release-notes/README.md exists', fs.existsSync(path.join(root, 'release-notes', 'README.md')))

const body = await import(pathToFileURL(path.join(root, 'scripts', 'release-body.mjs')).href)
let text = ''
try { text = body.buildBody(version) } catch (e) { check(`release-notes/${version}.md passes the release rules`, false, e.message) }
check('release body ends with How to install', text.includes('## How to install') && text.includes(`${base}-Setup.exe`) && text.includes(`${base}-Portable.zip`))
check('install text names the data folder', body.installText(version).includes('%USERPROFILE%\\SuperCargo-OtherModes;'))
const tmpNotes = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-notes-'))
let threw = ''
try { body.buildBody('9.9.9', tmpNotes) } catch (e) { threw = e.message }
check('release body refuses a missing notes file', threw.includes('No release notes'), threw)
fs.writeFileSync(path.join(tmpNotes, '9.9.9.md'), "## What's new in 9.9.9\n")
threw = ''
try { body.buildBody('9.9.9', tmpNotes) } catch (e) { threw = e.message }
check('release body refuses a heading without R1', threw.includes("must start with"), threw)

// N1: content rules (a notes dir of its own per case so the "previous version" rule only sees what the case writes)
const H = "## What's new in R1 9.9.9\n\n"
function refusal(notes, prev = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-notes-'))
  if (prev != null) fs.writeFileSync(path.join(dir, '9.9.8.md'), prev)
  fs.writeFileSync(path.join(dir, '9.9.9.md'), notes)
  try { body.buildBody('9.9.9', dir); return '' } catch (e) { return e.message }
}
const good = H + '### Fixed\n- **Overlay.** The card keeps its height.\n'
check('N1: good notes pass', refusal(good) === '', refusal(good))
check('N1: good notes with CRLF pass', refusal(good.replace(/\n/g, '\r\n')) === '', refusal(good.replace(/\n/g, '\r\n')))
check('N1: refuses heading only', refusal(H).includes("'### New', '### Changed' or '### Fixed' section"), refusal(H))
check('N1: refuses a section without bullets', refusal(H + '### New\nSome words but no bullet.\n').includes("section with a '- ' bullet"))
check('N1: refuses bullets under another heading only', refusal(H + '### Notes\n- a line\n').includes("section with a '- ' bullet"))
check('N1: a bullet under ### Changed is enough', refusal(H + '### New\n\n### Changed\n- Updates come from the new repo.\n') === '')
for (const [name, bad, want] of [
  ['TODO', good + '- TODO write this\n', "placeholder 'TODO'"],
  ['TBD', good + '- Data folder: TBD\n', "placeholder 'TBD'"],
  ['FIXME', good + '- FIXME\n', "placeholder 'FIXME'"],
  ['… alone', good + '- …\n', "only '…' or '...'"],
  ['... alone', good + '-   ...  \n', "only '…' or '...'"],
  ['<', good + '- Moved to <folder>\n', "a '<'"],
  ['lorem', good + '- Lorem ipsum dolor\n', "'lorem'"]
]) {
  const msg = refusal(bad)
  check(`N1: refuses placeholder ${name}`, msg.includes(want) && msg.includes('on line'), msg)
}
check('N1: "…" inside a sentence is fine', refusal(good + '- CHANGE… uses the folder as it is.\n') === '')
check('N1: "TODOs" as part of a word is fine (word match)', refusal(good + '- Clearer todolist wording.\n') === '')
const same = refusal(good, good.replace('9.9.9', '9.9.8'))
check('N1: refuses notes identical to the previous version (after the heading)', same.includes('the same as release-notes/9.9.8.md'), same)
check('N1: different from the previous version passes', refusal(good, "## What's new in R1 9.9.8\n\n### New\n- Something else.\n") === '')
check('N1: every problem is listed', (() => { const m = refusal(H + '- TODO\n'); return m.includes('section') && m.includes('TODO') })())
check('N1: previousVersion picks the newest older file', (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-notes-'))
  for (const v of ['1.0.0', '1.0.10', '1.0.9', '1.1.0', '2.0.0']) fs.writeFileSync(path.join(dir, `${v}.md`), '')
  return body.previousVersion('1.1.0', dir) === '1.0.10' && body.previousVersion('1.0.0', dir) === null
})())

// N2: the README carries the "write notes as we go" rule and the release steps
const readme = read('release-notes/README.md')
check('N2: README rule: each batch commit adds its lines', readme.includes('each batch commit adds its lines to release-notes/<next version>.md'))
check('N2: README has the release steps', /## Release steps/.test(readme) && readme.includes('scripts/release-body.mjs') && readme.includes('already exists'))

// N3: run_all.mjs runs release_checks.mjs and counts it as a failure
const runAll = read('test/replay/run_all.mjs')
check('N3: run_all runs release_checks.mjs', /spawnSync\(process\.execPath, \[path\.join\(here, 'release_checks\.mjs'\)\]/.test(runAll) && /let failed = releaseOk \? 0 : 1/.test(runAll))

// --- scripts ----------------------------------------------------------------
check('dist builds Windows without publishing', /electron-builder --win\b.*--publish never/.test(pkg.scripts.dist ?? ''), pkg.scripts.dist)
check('no script publishes from electron-builder', !Object.values(pkg.scripts).some((s) => /--publish (always|onTag|onTagOrDraft)/.test(s)))

// --- electron-builder.yml ---------------------------------------------------
const cfg = yaml.load(read('electron-builder.yml'))
check('appId', cfg.appId === 'space.supercargo.othermodes', cfg.appId)
check('productName', cfg.productName === 'SuperCargo-OtherModes', cfg.productName)
const winTargets = (cfg.win?.target ?? []).map((t) => (typeof t === 'string' ? t : t.target)).sort()
check('win targets are nsis + zip only', JSON.stringify(winTargets) === '["nsis","zip"]', JSON.stringify(winTargets))
check('no portable exe config', cfg.portable == null)
const expand = (s) => s.replace('${version}', version).replace('${ext}', '§')
check('Setup name', expand(cfg.nsis?.artifactName ?? '') === `${base}-Setup.§`, cfg.nsis?.artifactName)
check('Portable zip name (win.artifactName; nsis overrides it)', expand(cfg.win?.artifactName ?? '') === `${base}-Portable.§`, cfg.win?.artifactName)
check('no top-level zip section (not in the builder schema)', cfg.zip == null)
check('AppImage name', expand(cfg.linux?.artifactName ?? '') === `${base}.§`, cfg.linux?.artifactName)
const n = cfg.nsis ?? {}
check('nsis per-user, assisted, choose folder', n.perMachine === false && n.oneClick === false && n.allowToChangeInstallationDirectory === true)
check('uninstall keeps app data', n.deleteAppDataOnUninstall === false)
check('builder does not manage the desktop shortcut', n.createDesktopShortcut === false)
check('nsis include is build/installer.nsh', n.include === 'build/installer.nsh')
const pub = Array.isArray(cfg.publish) ? cfg.publish[0] : cfg.publish
check('publish github swill008/SuperCargo-All', pub?.provider === 'github' && pub?.owner === 'swill008' && pub?.repo === 'SuperCargo-All', JSON.stringify(pub))
check('publish is not a draft/prerelease', pub?.releaseType == null || pub?.releaseType === 'release')

// the builder's own schema check (same as electron-builder runs before building)
{
  const { getConfig, validateConfiguration } = require(path.join(root, 'node_modules/app-builder-lib/out/util/config/config.js'))
  const { DebugLogger } = require(path.join(root, 'node_modules/builder-util'))
  let err = ''
  try {
    await validateConfiguration(await getConfig(root, null, null), new DebugLogger(false))
  } catch (e) {
    err = String(e.message).split('\n').slice(0, 3).join(' ')
  }
  check('electron-builder.yml passes the builder schema', err === '', err)
}

// --- NSIS include -----------------------------------------------------------
const nsh = read('build/installer.nsh')
for (const m of ['customPageAfterChangeDir', 'customInstall', 'customUnInstall']) {
  check(`installer.nsh defines ${m}`, new RegExp(`^!macro ${m}\\s*$`, 'm').test(nsh))
}
const macros = [...nsh.matchAll(/^!macro (\w+)[\s\S]*?^!macroend/gm)]
check('installer.nsh macros all closed', macros.length === (nsh.match(/^!macro /gm) ?? []).length)
const page = macros.find((m) => m[1] === 'customPageAfterChangeDir')?.[0] ?? ''
check('checkbox text', page.includes('"Create a desktop shortcut"'))
check('checkbox unticked unless chosen before', !/NSD_Check\b/.test(page.replace(/\$\{If\} \$1 == "1"\s*\n\s*\$\{NSD_Check\}/, '')))
check('page skipped on updates', /scShortcutPageCreate[\s\S]*?\$\{If\} \$\{isUpdated\}\s*\n\s*Abort/.test(page))
const inst = macros.find((m) => m[1] === 'customInstall')?.[0] ?? ''
check('update keeps an existing shortcut only', /\$\{If\} \$\{isUpdated\}\s*\n(?:\s*;.*\n)*\s*\$\{If\} \$\{FileExists\} "\$newDesktopLink"/.test(inst))
check('choice remembered in HKCU', inst.includes('WriteRegStr HKCU "${SC_SHORTCUT_KEY}" "DesktopShortcut" "1"'))
const uninst = macros.find((m) => m[1] === 'customUnInstall')?.[0] ?? ''
check('uninstall leaves shortcut on update', /\$\{IfNot\} \$\{isUpdated\}/.test(uninst))
check('uninstall never touches the data folder', !/RMDir|PROFILE|\$APPDATA|\$LOCALAPPDATA/i.test(uninst.replace(/^\s*;.*$/gm, '')))
// Vars and Functions only in installer-only macros (the uninstaller build uses -WX)
const outside = nsh.replace(/^!macro customPageAfterChangeDir[\s\S]*?^!macroend/m, '')
check('no Var/Function outside the installer page macro', !/^\s*(Var|Function)\b/m.test(outside))

// --- workflows --------------------------------------------------------------
const win = yaml.load(read('.github/workflows/release-win.yml'))
const winText = read('.github/workflows/release-win.yml')
check('release-win: manual with publish input', win.on?.workflow_dispatch?.inputs?.publish?.type === 'boolean')
check('release-win: windows-latest', win.jobs?.build?.['runs-on'] === 'windows-latest')
const steps = win.jobs?.build?.steps ?? []
const rel = steps.find((s) => String(s.uses ?? '').startsWith('softprops/action-gh-release'))
check('release-win: tag SuperCargo-OtherModes-R1-<ver>', rel?.with?.tag_name === '${{ steps.version.outputs.base }}' && winText.includes('base=SuperCargo-OtherModes-R1-$v'))
check('release-win: title', rel?.with?.name === 'SuperCargo-OtherModes R1 ${{ steps.version.outputs.version }}', rel?.with?.name)
check('release-win: repo', rel?.with?.repository === 'swill008/SuperCargo-All')
check('release-win: full release (updater reads releases/latest)', rel?.with?.draft === false && rel?.with?.prerelease === false)
for (const f of ['-Setup.exe', '-Setup.exe.blockmap', '-Portable.zip']) {
  check(`release-win uploads ${f}`, String(rel?.with?.files ?? '').includes(`release/\${{ steps.version.outputs.base }}${f}`))
}
check('release-win uploads latest.yml', String(rel?.with?.files ?? '').includes('release/latest.yml'))
check('release-win: notes step before build', steps.findIndex((s) => /release-body\.mjs/.test(s.run ?? '')) >= 0 &&
  steps.findIndex((s) => /release-body\.mjs/.test(s.run ?? '')) < steps.findIndex((s) => /electron-builder/.test(s.run ?? '')))
const notesAt = steps.findIndex((s) => /release-body\.mjs/.test(s.run ?? ''))
const summaryAt = steps.findIndex((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? '') && /release-body\.md/.test(s.run ?? ''))
check('N4: release-win writes the release text to the run summary', summaryAt > notesAt && notesAt >= 0)
const tagAt = steps.findIndex((s) => /git ls-remote --tags origin/.test(s.run ?? ''))
const buildAt = steps.findIndex((s) => /electron-vite build|electron-builder/.test(s.run ?? ''))
check('N5: release-win checks the tag before building', tagAt >= 0 && tagAt < buildAt && tagAt < steps.findIndex((s) => s.run === 'npm ci'))
check('N5: tag check looks for the release tag and stops', /refs\/tags\/\$base/.test(steps[tagAt]?.run ?? '') && /already exists/.test(steps[tagAt]?.run ?? '') && /throw/.test(steps[tagAt]?.run ?? ''))
check('release-win: builder never publishes', steps.some((s) => /electron-builder --win --publish never/.test(s.run ?? '')))
check('release-win: artifact when not publishing', steps.some((s) => String(s.uses ?? '').startsWith('actions/upload-artifact') && s.if?.includes('!inputs.publish')))
const lin = read('.github/workflows/release-linux.yml')
check('release-linux: same tag + repo', lin.includes('SuperCargo-OtherModes-R1-$v') && lin.includes('swill008/SuperCargo-All') && !/AquatikJustice/.test(lin))

// --- shared naming + portable detection ------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-release-'))
const outfile = path.join(tmp, 'release.mjs')
esbuild.buildSync({ entryPoints: [path.join(root, 'src/shared/release.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' })
const R = await import(pathToFileURL(outfile).href)
check('releaseLabel', R.releaseLabel('1.0.0') === 'R1 1.0.0')
check('releaseTag', R.releaseTag(version) === base)
check('releasePageUrl', R.releasePageUrl('1.0.1') === 'https://github.com/swill008/SuperCargo-All/releases/tag/SuperCargo-OtherModes-R1-1.0.1')
const upd = read('src/main/updater.ts')
const re = /\/\^Uninstall \.\*\\\.exe\$\/i/
check('updater: portable = no "Uninstall *.exe" beside the exe', re.test(upd))
const rx = /^Uninstall .*\.exe$/i
check('uninstaller name matches', rx.test(`Uninstall ${cfg.productName}.exe`) && !rx.test(`${cfg.productName}.exe`))

// electron-updater resolves the GitHub tag from releases/latest (any tag name) unless prerelease
const gh = fs.readFileSync(path.join(root, 'node_modules/electron-updater/out/providers/GitHubProvider.js'), 'utf8')
check('electron-updater reads tag_name from releases/latest', /releaseInfo\.tag_name/.test(gh) && /\/latest`/.test(gh))
check('electron-updater href regexp accepts the tag', /\/tag\/(v?[^/]+)$/.exec(`/swill008/SuperCargo-All/releases/tag/${base}`)?.[1] === base)

console.log(`release checks: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
