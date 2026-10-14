// Resolver guard (CONTRACT10): every name/place lookup in Other mode goes through src/other/otherResolve.ts.
// Fails when a file under src/other matches place names itself (a roster find/filter by name, a lower-cased name
// compare, a folded name compare) outside the allowlist below.
// Usage: node test/replay/resolver_guard.mjs   (no build needed; reads the source files)   --all lists allowed hits too

import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const base = path.join(root, 'src', 'other')

// files that may match names themselves, each with why
const ALLOW = {
  'otherResolve.ts': 'the one resolver: text -> place, start text, import place, body by name, nearest place',
  'otherSiteCodes.ts': 'the one code table: wiki site codes, city and Lagrange codes -> place (placeForCode)',
  'renderer/state/otherPlaces.ts': 'builds the roster: merges sources (UEX, starmap) by name before anything resolves',
  'main/uex.ts': 'builds the places cache: fills / adds starmap positions by name (the source merge, before anything resolves)',
  'otherGeo.ts': 'gateway / gatewayLocation: exact jump-point rules (geometry, not text matching)',
  'otherMarkers.ts': 'locationByZ: the marker zone host -> place by position (geometry)',
  'otherBodies.ts': 'the body table (planets / moons by their own names) the resolver and findBody read'
}

// a roster find/filter/some counts only when its callback (this line or the next few) looks at a name or code:
// `locations.filter(hasCoords)` is a count, not a lookup
const ROSTER_CALL = /\b(?:locations|locs|roster|places|merged|uexLocations)\s*\.\s*(?:find|filter|some|findIndex|every)\s*\(/
const NAMEISH = /\.(?:name|code|aliases)\b|\b(?:norm|fold)\s*\(/
const CALLBACK_LINES = 4
// a name lookup done in place. Each rule: what it catches, the pattern (a function gets the lines and the index).
const RULES = [
  ['roster find/filter/some by name', (lines, i) => ROSTER_CALL.test(lines[i]) && NAMEISH.test(lines.slice(i, i + CALLBACK_LINES).join(' ').slice(lines[i].search(ROSTER_CALL)))],
  ['lower-cased name compare', /\.name\s*\.\s*toLowerCase\(\)\s*[!=]==?/],
  ['lower-cased name compare (right side)', /[!=]==?\s*[\w.?]+\.name\s*\.\s*toLowerCase\(\)/],
  ['folded name compare', /\b(?:norm|fold|foldPlaceName|normName|canon)\s*\(\s*\w+\.name\b/],
  ['legacy lookup helper', /\b(?:findRosterLocation|findFolded|snapLocationToUex|explainPlaceLookup|rosterNameForCode|nearestRosterPlace)\s*\(/]
]

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(d.name) && !/\.d\.ts$/.test(d.name) ? [p] : []
  })

// strip comments (line and block) so a note about an old helper is not a hit; strings are kept
function codeLines(text) {
  let inBlock = false
  return text.split(/\r?\n/).map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      if (inBlock) {
        if (line.startsWith('*/', i)) {
          inBlock = false
          i++
        }
        continue
      }
      if (line.startsWith('/*', i)) {
        inBlock = true
        i++
        continue
      }
      if (line.startsWith('//', i) && line[i - 1] !== ':') break
      out += line[i]
    }
    return out
  })
}

const all = process.argv.includes('--all')
const hits = []
const allowed = []
for (const file of walk(base)) {
  const rel = path.relative(base, file).split(path.sep).join('/')
  const lines = codeLines(fs.readFileSync(file, 'utf8'))
  lines.forEach((line, i) => {
    for (const [what, re] of RULES) {
      if (!(typeof re === 'function' ? re(lines, i) : re.test(line))) continue
      const hit = { file: `src/other/${rel}`, line: i + 1, what, code: line.trim().slice(0, 160) }
      ;(ALLOW[rel] ? allowed : hits).push(hit)
      break
    }
  })
}

for (const [f, why] of Object.entries(ALLOW)) {
  if (!fs.existsSync(path.join(base, f))) console.log(`note: allowlisted file not found: src/other/${f} (${why})`)
}
if (all && allowed.length) {
  console.log(`allowed (${allowed.length}):`)
  for (const h of allowed) console.log(`  ${h.file}:${h.line}  [${h.what}]  ${h.code}`)
}
if (hits.length) {
  const byFile = new Map()
  for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
  console.log(`FAIL resolver guard: ${hits.length} place-name lookup(s) outside otherResolve in ${byFile.size} file(s)`)
  for (const [f, list] of byFile) {
    console.log(`  ${f}`)
    for (const h of list) console.log(`    ${h.line}  [${h.what}]  ${h.code}`)
  }
  console.log('Fix: call the resolver (resolvePlaceText / resolveStartText / importPlace / findBody / nearestPlace / placeForCode).')
  process.exit(1)
}
console.log(`PASS resolver guard: no place-name lookups outside the allowlist (${allowed.length} allowed hit(s) in ${Object.keys(ALLOW).length} files)`)
