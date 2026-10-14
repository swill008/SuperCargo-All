// Problem-stop checks (pure): bundles src/other/renderer/stopIssue.ts and checks every match status.
// Usage: node test/replay/stopissue_checks.mjs   (no build needed)
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = process.env.SC_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-stopissue-'))
const outfile = path.join(tmp, 'stopIssue.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/renderer/stopIssue.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: {
    '@shared': path.join(root, 'src/shared'),
    '@other': path.join(root, 'src/other'),
    '@renderer': path.join(root, 'src/renderer/src')
  }
})
const S = await import(pathToFileURL(outfile).href)
fs.rmSync(tmp, { recursive: true, force: true })

const results = []
const check = (what, ok, detail = '') => results.push({ what, ok: !!ok, detail })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const step = { location: 'Port Tressler' }

// fine statuses -> no issue
for (const status of ['exact', 'corrected', 'marker', 'user', 'learned']) {
  const got = S.stopIssue({ status }, step)
  check(`${status} -> null`, got === null, JSON.stringify(got))
}
// amber statuses
for (const [status, reason] of [['guess', 'guess'], ['unsure', 'not sure'], ['mismatch', 'mismatch']]) {
  const got = S.stopIssue({ status }, step)
  check(`${status} -> amber "${reason}"`, same(got, { level: 'amber', reason }), JSON.stringify(got))
}
// none -> red
const red = (what, st, reason) => {
  const got = S.stopIssue({ status: 'none' }, st)
  check(what, same(got, { level: 'red', reason }), JSON.stringify(got))
}
red('none with a place -> red "not found"', step, 'not found')
red('none, no step -> red "not found"', undefined, 'not found')
red('none, empty location -> red "no place"', { location: '' }, 'no place')
red('none, blank location -> red "no place"', { location: '   ' }, 'no place')
red('none, missing location -> red "no place"', {}, 'no place')
// no match
check('null match -> null', S.stopIssue(null, step) === null)
check('undefined match -> null', S.stopIssue(undefined, step) === null)

// worstIssue
const A = { level: 'amber', reason: 'guess' }
const R = { level: 'red', reason: 'not found' }
let w = S.worstIssue([A, null, R, undefined, A])
check('worstIssue: red beats amber', w?.level === 'red' && w.reason === 'not found', JSON.stringify(w))
check('worstIssue: count of non-null', w?.count === 3, JSON.stringify(w))
w = S.worstIssue([null, A])
check('worstIssue: amber only -> amber, count 1', w?.level === 'amber' && w.count === 1, JSON.stringify(w))
check('worstIssue: all null -> null', S.worstIssue([null, undefined, null]) === null)
check('worstIssue: empty -> null', S.worstIssue([]) === null)

// styles
for (const level of ['red', 'amber']) {
  const row = S.issueRowStyle(level)
  check(`issueRowStyle(${level}) has a background`, typeof row.background === 'string' && row.background.length > 0, JSON.stringify(row))
  check(
    `issueRowStyle(${level}) has an inset left stripe in the level colour`,
    typeof row.boxShadow === 'string' && /^inset 3px 0 0 /.test(row.boxShadow) && row.boxShadow.endsWith(S.issueColor(level)),
    JSON.stringify(row)
  )
  const text = S.issueTextStyle(level)
  check(`issueTextStyle(${level}) has a colour`, typeof text.color === 'string' && text.color.length > 0, JSON.stringify(text))
}
check('red and amber rows differ', S.issueRowStyle('red').background !== S.issueRowStyle('amber').background)

let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}  (${r.detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
