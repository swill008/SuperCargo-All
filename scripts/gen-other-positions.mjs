// Rebuilds data/uex/other-positions.json: named starmap places (outposts,
// research/mining sites, aid shelters, landing zones, stations) with
// system-frame coords, so Other mode can place UEX outposts the haul cache lacks.
// Same frame as locations.json (both read scunpacked starmap_positions x/y/z).
// The rules live in src/other/otherSiteCodes.ts (buildStarmapPlaces), shared with the app's "Update game data".
// node scripts/gen-other-positions.mjs                 (downloads starmap_positions.json)
// node scripts/gen-other-positions.mjs --from <file>   (uses a local starmap_positions.json)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT = path.join(ROOT, 'data', 'uex', 'other-positions.json')
const URL_ = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master/starmap_positions.json'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-positions-'))
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
const { buildStarmapPlaces } = await import(pathToFileURL(outfile).href)

const fromIdx = process.argv.indexOf('--from')
let starmap
if (fromIdx > 0 && process.argv[fromIdx + 1]) {
  starmap = JSON.parse(fs.readFileSync(process.argv[fromIdx + 1], 'utf8'))
} else {
  const res = await fetch(URL_, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`starmap: HTTP ${res.status}`)
  starmap = await res.json()
}
if (!Array.isArray(starmap?.entities)) throw new Error('starmap: expected { entities: [...] }')

const doc = buildStarmapPlaces(starmap)
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n')
console.log(`wrote ${doc.places.length} places to ${path.relative(ROOT, OUT)}`)
fs.rmSync(tmp, { recursive: true, force: true })
