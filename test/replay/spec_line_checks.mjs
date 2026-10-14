// Change control: every commit that touches program code (src/) names the spec it follows
// ("Spec: <file> <refs>") or says it changes no behaviour ("Spec: none (no behaviour change)").
// Checked for the commits made after the one that added this script (older history is left as it is).
// See "Rules carried over from Gremlin-Platforms" in CLAUDE.md (rule 3).
// Usage: node test/replay/spec_line_checks.mjs   (SC_ROOT=<repo> to check another checkout)

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = process.env.SC_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const THIS = 'test/replay/spec_line_checks.mjs'
const SPEC = /^Spec:\s*\S/m

let failed = 0
let passed = 0
function check(name, ok, detail = '') {
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const touchesProgram = (paths) => paths.some((p) => p && p.startsWith('src/'))

// --- the rule itself -------------------------------------------------------
check('accepts a Spec line with refs', SPEC.test('Fix a thing\n\nSpec: STANDALONE.md R12, D4\n'))
check('accepts Spec: none', SPEC.test('Tidy\n\nSpec: none (no behaviour change)\n'))
check('rejects a message without a Spec line', !SPEC.test('Fix a thing\n\nNo spec here\n'))
check('rejects an empty Spec line', !SPEC.test('Spec:\n'))
check('rejects Spec: not at line start', !SPEC.test('Fix a thing, see Spec: x\n'))
check('src/ main file counts as program code', touchesProgram(['src/main/index.ts']))
check('src/ renderer file counts as program code', touchesProgram(['src/renderer/src/App.tsx']))
check('docs/ and test/ do not count', !touchesProgram(['docs/TODO.md', 'test/replay/x.mjs', 'electron-builder.yml']))

// --- the history -----------------------------------------------------------
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60000 })
  if (r.error || r.status !== 0) return { ok: false, err: (r.error?.message || r.stderr || '').trim() }
  return { ok: true, out: r.stdout }
}

let note = ''
const hasGit = !spawnSync('git', ['--version'], { encoding: 'utf8' }).error
if (!hasGit) note = 'git not installed: history not checked'
else if (!fs.existsSync(path.join(root, '.git'))) note = 'not a git checkout: history not checked'
else {
  const added = git('log', '--diff-filter=A', '--format=%H', '--', THIS)
  if (!added.ok) note = `git log failed (${added.err}): history not checked`
  else {
    const shas = added.out.split(/\s+/).filter(Boolean)
    if (!shas.length) note = `${THIS} not committed yet: nothing to check`
    else {
      const base = shas[shas.length - 1]
      const log = git('log', '--reverse', '--format=%x1e%H%x1f%B%x1f', '--name-only', `${base}..HEAD`)
      if (!log.ok) note = `git log failed (${log.err}): history not checked`
      else {
        const missing = []
        let n = 0
        for (const record of log.out.split('\x1e')) {
          if (!record.trim()) continue
          const [sha = '', message = '', files = ''] = record.split('\x1f')
          n++
          const paths = files.split(/\r?\n/).map((f) => f.trim())
          if (touchesProgram(paths) && !SPEC.test(message.replace(/\r\n/g, '\n'))) {
            missing.push(`${sha.trim().slice(0, 8)} ${message.trim().split(/\r?\n/)[0] || ''}`)
          }
        }
        note = `${n} commit(s) since ${base.slice(0, 8)} checked`
        check(
          'commits that change src/ have a Spec line',
          !missing.length,
          `need 'Spec: <file> <refs>' (or 'Spec: none (no behaviour change)'):\n  ${missing.join('\n  ')}`,
        )
      }
    }
  }
}

if (note) console.log(`note: ${note}`)
console.log(`${passed}/${passed + failed} passed`)
process.exit(failed ? 1 : 0)
