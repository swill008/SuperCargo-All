// Other-mode place list checks: bundles src/other/main/uex.ts with a stub 'electron' and a counting fetch, then checks
// that two refreshes started together share one download (start-up refresh + the window's own refresh used to pull the
// UEX lists twice) and that a later refresh downloads again.
// Usage: node test/replay/places_checks.mjs   (no build needed)
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-places-'))
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home')
fs.mkdirSync(process.env.HOME, { recursive: true })
globalThis.__scUserData = path.join(tmp, 'userData')

// any electron export: app.getPath -> temp folder, everything else a harmless no-op
const electronSrc = `
const noop = () => {}
const handler = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, { get: () => noop, apply: () => undefined })) }
export const app = new Proxy({ getPath: () => globalThis.__scUserData, isPackaged: false, getVersion: () => '1.0.0', getAppPath: () => process.cwd(), on: noop }, handler)
export const ipcMain = { handle: noop, on: noop }
export const BrowserWindow = { getAllWindows: () => [] }
export const nativeImage = {}
export const screen = {}
export const shell = {}
export const dialog = {}
export const net = {}
export default { app, ipcMain, BrowserWindow }
`
const outfile = path.join(tmp, 'uex.mjs')
await esbuild.build({
  entryPoints: [path.join(root, 'src/other/main/uex.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') },
  plugins: [
    {
      name: 'electron-stub',
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: electronSrc, loader: 'js' }))
      }
    }
  ],
  external: ['electron-updater']
})

const calls = []
globalThis.fetch = async (url) => {
  calls.push(String(url))
  await new Promise((r) => setTimeout(r, 30))
  const name = String(url).split('/').pop()
  const data = [{ id: 1, name: `Made Up ${name}`, star_system_name: 'Stanton', planet_name: 'Hurston', is_visible: 1 }]
  return { ok: true, status: 200, json: async () => ({ data }) }
}
console.log = () => {}
const U = await import(pathToFileURL(outfile).href)

const results = []
const check = (what, ok, detail = '') => results.push({ what, ok: !!ok, detail })

const a = U.refreshOtherPlaces([])
const b = U.refreshOtherPlaces([])
check('two refreshes started together share one promise', a === b)
const [ra, rb] = await Promise.all([a, b])
check('one download of the three lists, not two', calls.length === 3, `fetches=${calls.length}`)
check('both callers get the same places', ra === rb && Array.isArray(ra) && ra.length > 0, `places=${ra?.length}`)
check('cache written once to the data folder', fs.existsSync(path.join(process.env.HOME, 'SuperCargo-OtherModes', 'other-uex-places.json')))
await U.refreshOtherPlaces([])
check('a later refresh downloads again', calls.length === 6, `fetches=${calls.length}`)

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  if (!r.ok || process.argv.includes('--verbose')) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}  ${r.detail}\n`)
}
process.stdout.write(`${results.length - failed}/${results.length} passed\n`)
process.exit(failed ? 1 : 0)
