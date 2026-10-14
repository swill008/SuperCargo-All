// Job import checks: bundles src/other/otherLog.ts (stepFromParse / stepFromObjectiveText) with the resolver
// and checks the import rules of contract 10: places go in as read (locationRaw), `location` is the roster
// name only when importPlace is sure, scan text gets the OCR rules, and match memory applies to imports.
// Usage: node test/replay/import_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-import-'))
const outfile = path.join(tmp, 'otherImport.mjs')
esbuild.buildSync({
  stdin: {
    contents: "export * from './otherLog'\nexport { importPlace, placeKey } from './otherResolve'\nexport { memoryKey } from './otherMemory'\n",
    resolveDir: path.join(root, 'src/other'),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const L = await import(pathToFileURL(outfile).href)

const uex = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/locations.json'), 'utf8')).locations
const positions = JSON.parse(fs.readFileSync(path.join(root, 'data/uex/other-positions.json'), 'utf8')).places
const uexNames = new Set(uex.map((l) => l.name))
const roster = [...uex, ...positions.filter((p) => !uexNames.has(p.name))]

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}

const SURE = new Set(['exact', 'corrected', 'user', 'learned'])
const parse = (text) => L.parseOtherObjectiveText(text)
const step = (text, opts, locations = roster) => L.stepFromParse('s1', parse(text), locations, opts)

// real objective lines (log and scan forms); every place stays as read on locationRaw
const LINES = [
  'Deliver 0/4 SCU of Medical Supplies to Port Tressler',
  "Collect Food Supplies From Red Crossroads Station at microTech's L4 Lagrange point",
  'Go to Rayari Cantwell',
  'Go to Rayari',
  'Go to Shubin SM0-18',
  'Go to Stanton System',
  'Go to Patrol Coordinates',
  'Deliver 0/2 SCU of Waste to a Landing Pad Locker in New Babbage',
  'Go to Lorville',
  'Go to Keeger Belt Wreck Site',
  'Neutralize Nine Tails Lead'
]

// the step's place agrees with importPlace: roster name only when sure, else the text as read
safe('import rule', () => {
  for (const line of LINES) {
    for (const ocr of [false, true]) {
      const p = parse(line)
      const s = L.stepFromParse('s1', p, roster, { ocr })
      const tag = `${ocr ? 'scan' : 'log'}: ${line}`
      check('as read', `${tag} -> locationRaw is the text as read`, s.locationRaw === p.location, `${s.locationRaw} vs ${p.location}`)
      check('snapped flag', `${tag} -> locationSnapped = location !== locationRaw`, s.locationSnapped === (s.location !== s.locationRaw), JSON.stringify(s))
      if (!p.location) continue
      const imp = L.importPlace(p.location, { locations: roster, useMarker: false }, { ocr, label: p.label })
      check('same answer', `${tag} -> step uses importPlace's answer`, imp.location === s.location, `${s.location} vs ${imp.location}`)
      if (s.location !== s.locationRaw) {
        check('sure only', `${tag} -> renamed only when sure (${imp.match.status} c${imp.match.confidence})`, SURE.has(imp.match.status) && imp.match.confidence >= 8, s.location)
      }
    }
  }
})

safe('pass through', () => {
  const n = step('Neutralize Nine Tails Lead')
  check('neutralize', 'Neutralize target is not a place', n.location === 'Nine Tails Lead' && !n.locationSnapped, JSON.stringify(n))
  for (const t of ['Go to Stanton System', 'Go to Patrol Coordinates']) {
    const s = step(t)
    check('pass', `${t} stays as read`, s.location === s.locationRaw && !s.locationSnapped, s.location)
  }
  const none = L.stepFromParse('s1', parse('Go to Rayari Cantwell'))
  check('no roster', 'without a roster nothing is resolved', none.location === 'Rayari Cantwell' && none.locationRaw === 'Rayari Cantwell' && !none.locationSnapped, JSON.stringify(none))
})

safe('exact', () => {
  const s = step('Deliver 0/4 SCU of Medical Supplies to Port Tressler')
  check('exact', 'Port Tressler stays Port Tressler, not snapped', s.location === 'Port Tressler' && !s.locationSnapped, JSON.stringify(s))
})

safe('pickup', () => {
  const rows = L.mergeCollectIntoDeliver([
    parse('Collect Waste From Port Tressler'),
    parse('Deliver 0/2 SCU of Waste to Everus Harbor')
  ])
  const s = L.stepFromParse('s1', rows[0], roster)
  check('pickup', 'pickup place resolved and kept as read', s.pickupLocationRaw === 'Port Tressler' && s.pickupLocation === 'Port Tressler' && s.pickedUp === false, JSON.stringify(s))
})

// scan: OCR Lagrange misread ("CRU-LS5") is read as the place through importPlace's OCR rules; it is a
// correction (≈), not sure, so the step keeps the text as read and the stop resolves it with that tag
safe('ocr', () => {
  const raw = 'CRU-LS5 Beautiful Glen Station'
  const s = step(`Go to ${raw}`, { ocr: true })
  const imp = L.importPlace(raw, { locations: roster, useMarker: false }, { ocr: true, label: `Go to ${raw}` })
  check('ocr', `scan "${raw}" -> matched CRU-L5 Beautiful Glen Station (${imp.match.status} c${imp.match.confidence})`, imp.match.match?.name === 'CRU-L5 Beautiful Glen Station' && imp.match.status !== 'exact', JSON.stringify(imp.match.evidence))
  check('ocr', 'scan step keeps the text as read unless sure', s.locationRaw === raw && s.location === imp.location, JSON.stringify(s))
})

// match memory: a user fix keyed by the text as read applies to a log import and a scan import alike
safe('memory', () => {
  const target = roster.find((l) => l.name === 'Rayari Deltana Research Outpost' && l.x != null) ?? roster.find((l) => l.x != null)
  const raw = 'Rayari'
  const key = L.memoryKey(raw)
  const now = new Date().toISOString()
  const entry = { key, text: raw, place: target.name, origin: 'user', confirmed: 0, wrong: 0, seen: 1, firstAt: now, lastAt: now }
  const memory = (k) => (k === key ? entry : undefined)
  const before = step('Go to Rayari')
  check('memory', 'without memory "Rayari" is not renamed to one outpost', before.location !== target.name, before.location)
  for (const ocr of [false, true]) {
    const s = step('Go to Rayari', { memory, ocr })
    check('memory', `${ocr ? 'scan' : 'log'}: user fix applies (Rayari -> ${target.name}), raw kept`, s.location === target.name && s.locationRaw === raw && s.locationSnapped, JSON.stringify(s))
  }
  const t = L.stepFromObjectiveText('Go to Rayari', roster, { memory })
  check('memory', 'stepFromObjectiveText passes memory through', t.location === target.name && t.logText === 'Go to Rayari', JSON.stringify(t))
})

const failed = results.filter((r) => !r.ok)
for (const r of results) if (!r.ok || process.argv.includes('--verbose')) console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${r.name}] ${r.what}${r.ok ? '' : `\n     ${r.detail}`}`)
console.log(`import checks: ${results.length - failed.length}/${results.length} passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed.length ? 1 : 0)
