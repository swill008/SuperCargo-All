// Other mode Game.log parser checks (pure): bundles src/other/otherLogParse.ts and feeds it made-up lines.
// Usage: node test/replay/logparse_checks.mjs   (no build needed)
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = process.env.SC_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-logparse-'))
const outfile = path.join(tmp, 'otherLogParse.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherLogParse.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const P = await import(pathToFileURL(outfile).href)
fs.rmSync(tmp, { recursive: true, force: true })

const results = []
const check = (what, ok, detail = '') => results.push({ what, ok: !!ok, detail })
const NOTE = '[Notice] <SHUDEvent_OnNotification> Added notification'
const TAGS = '[Team_CoreGameplayFeatures][Missions][Comms]'
const ID = '11111111-2222-3333-4444-555555555555'
const accept = (title) =>
  `<2026-10-14T12:00:00.000Z> ${NOTE} "Contract Accepted:  ${title}: " [47] to queue. New queue size: 5, MissionId: [${ID}], ObjectiveId: [] ${TAGS}`
const parse = (title) => P.createOtherLineParser().feed(accept(title))

const cases = [
  ['plain "[313 Rep]" unchanged', 'Package Recovery <EM4>[313 Rep]</EM4>', 313, undefined],
  ['en dash "[100–500 Rep]"', 'Courier Run <EM4>[100–500 Rep]</EM4>', 100, 500],
  ['hyphen "[100-500 Rep]"', 'Courier Run <EM4>[100-500 Rep]</EM4>', 100, 500],
  ['commas + spaces "[1,000 – 2,500 Rep]"', 'Courier Run <EM4>[1,000 – 2,500 Rep]</EM4>', 1000, 2500],
  ['spaces around a hyphen "[ 200 - 400 Rep ]"', 'Courier Run <EM4>[ 200 - 400 Rep ]</EM4>', 200, 400],
  ['high not above low "[500–500 Rep]" -> no repMax', 'Courier Run <EM4>[500–500 Rep]</EM4>', 500, undefined],
  ['high below low "[500–100 Rep]" -> no repMax', 'Courier Run <EM4>[500–100 Rep]</EM4>', 500, undefined],
  ['no rep tag', 'Courier Run', undefined, undefined]
]
for (const [what, title, rep, repMax] of cases) {
  const ev = parse(title)
  check(what, ev?.kind === 'accepted' && ev.rep === rep && ev.repMax === repMax && !('repMax' in ev && repMax === undefined), JSON.stringify(ev))
}
const ev = parse('Courier Run <EM4>[100–500 Rep]</EM4>')
check('range tag removed from the title', ev?.title === 'Courier Run', ev?.title)

let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}  (${r.detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
