// Map check (port of Gremlin-Platforms test/unit/test_program_map_covers_files.py): every program file under
// src/ (*.ts, *.tsx, *.css, *.html) is named in docs/SYSTEM-MAP.md or src/other/STANDALONE.md, so each file
// has a place in the map. A file counts as named when a doc has its repo path (`src/main/store.ts`), or a
// backticked name that ends the path at a "/" boundary (`store.ts`, `main/store.ts`), or a backticked glob
// that matches the end of the path (`shared/*.ts`), or a backticked folder ending in "/" that contains it
// (`src/main/ocr/`, `ocr/`). As in Gremlin's, a bare name covers every file with that name: `index.ts`
// covers src/main/index.ts and src/preload/index.ts alike. Files with only whitespace are skipped.
// Usage: node test/replay/map_covers_files_checks.mjs   (env SC_ROOT = another repo root, for tests)

import * as fs from 'node:fs'
import * as path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const root = path.resolve(process.env.SC_ROOT || path.join(here, '../..'))
const DOCS = ['docs/SYSTEM-MAP.md', 'src/other/STANDALONE.md']
const EXTS = new Set(['.ts', '.tsx', '.css', '.html'])

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

// --- the docs -----------------------------------------------------------------
let text = ''
for (const rel of DOCS) {
  const file = path.join(root, rel)
  check(`${rel} exists`, fs.existsSync(file))
  if (fs.existsSync(file)) text += fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') + '\n'
}
// A backticked name that looks like a path: a file with an extension or a folder ending in "/".
const PATHLIKE = /^[\w.*-]+(\/[\w.*-]+)*(\.\w+|\/)$/
const ticked = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((t) => PATHLIKE.test(t))

// fnmatch-style: '*' and '?' never cross a "/" (each part is matched on its own).
function partMatch(part, pat) {
  if (!/[*?]/.test(pat)) return part === pat
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  return re.test(part)
}

// The file's repo path (and every folder above it inside src/) against the docs.
function covered(rel) {
  if (text.includes(rel)) return true
  const parts = rel.split('/')
  // the file itself, then each containing folder (src/main/ocr/, src/main/, src/)
  const names = [{ parts, folder: false }]
  for (let i = parts.length - 1; i >= 1; i--) names.push({ parts: parts.slice(0, i), folder: true })
  for (const { parts: p, folder } of names) {
    for (const token of ticked) {
      if (token.endsWith('/') !== folder) continue
      const want = token.replace(/\/$/, '').split('/')
      if (want.length > p.length) continue
      const tail = p.slice(p.length - want.length)
      if (tail.every((x, i) => partMatch(x, want[i]))) return true
    }
  }
  return false
}

// --- the program files ----------------------------------------------------------
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...walk(full))
    } else if (EXTS.has(path.extname(e.name))) out.push(full)
  }
  return out
}
const files = walk(path.join(root, 'src'))
  .filter((f) => fs.readFileSync(f, 'utf8').trim() !== '')
  .map((f) => path.relative(root, f).split(path.sep).join('/'))
  .sort()
check('src/ has program files', files.length > 0, root)

const missing = files.filter((f) => !covered(f))
for (const f of missing) check(`${f} is on the map`, false, 'add it to docs/SYSTEM-MAP.md (or src/other/STANDALONE.md) in the section that owns it')
check(`all ${files.length} program files under src/ are named in the map`, missing.length === 0, `${missing.length} missing`)

console.log(`map covers files: ${passed}/${passed + failed} passed`)
process.exit(failed ? 1 : 0)
