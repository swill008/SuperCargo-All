// Rebuilds data/uex/site-codes.json: game location codes -> display names, each with the place it
// belongs to (DC_Stan_Covalex_S1_S1DC06_FOB -> "Security Compound" at "Covalex Distribution Center S1DC06").
// Source: Star Citizen Wiki game data (scunpacked-data) trade_locations.json. The rules live in
// src/other/otherSiteCodes.ts (buildSiteCodes), shared with the app's "Update game data".
// node scripts/gen-site-codes.mjs                 (downloads trade_locations.json)
// node scripts/gen-site-codes.mjs --from <file>   (uses a local trade_locations.json)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT = path.join(ROOT, 'data', 'uex', 'site-codes.json')
const URL_ = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/trade_locations.json'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sitecodes-'))
const outfile = path.join(tmp, 'otherSiteCodes.mjs')
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/other/otherSiteCodes.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.node.json'),
  alias: { '@shared': path.join(ROOT, 'src/shared'), '@other': path.join(ROOT, 'src/other') }
})
const { buildSiteCodes } = await import(pathToFileURL(outfile).href)

const fromIdx = process.argv.indexOf('--from')
let trade
if (fromIdx > 0 && process.argv[fromIdx + 1]) {
  trade = JSON.parse(fs.readFileSync(process.argv[fromIdx + 1], 'utf8'))
} else {
  const res = await fetch(URL_, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`trade_locations: HTTP ${res.status}`)
  trade = await res.json()
}
if (!Array.isArray(trade)) throw new Error('trade_locations: expected an array')

const doc = buildSiteCodes(trade)
fs.writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: doc.generatedAt, source: 'Star Citizen Wiki game data (scunpacked-data) trade_locations.json', sites: doc.sites }, null, 1) + '\n'
)
const withParent = doc.sites.filter((s) => s.parentCode).length
console.log(`wrote ${doc.sites.length} sites (${withParent} with a parent place) to ${path.relative(ROOT, OUT)}`)
fs.rmSync(tmp, { recursive: true, force: true })
