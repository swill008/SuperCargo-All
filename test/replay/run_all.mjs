// Replays every cleaned real log in test/replay/fixtures through the built app, live (lines appended while
// the app runs) and scan (whole log present at start-up), then checks each result with compare_log.py.
// Usage: npm run build && node test/replay/run_all.mjs [--mode live|scan] [fixture-name-part ...]
// Fixtures are made by make_fixture.py from real Game.log files.

import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const fixtures = path.join(here, 'fixtures')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-replay-all-'))
const python = ['python3', 'python', 'py'].find((p) => spawnSync(p, ['--version']).status === 0)

const argv = process.argv.slice(2)
const modeAt = argv.indexOf('--mode')
const modes = modeAt >= 0 ? [argv[modeAt + 1]] : ['live', 'scan']
const filters = argv.filter((a, i) => a !== '--mode' && i !== modeAt + 1)
const files = fs
  .readdirSync(fixtures)
  .filter((f) => f.endsWith('.log'))
  .filter((f) => !filters.length || filters.some((p) => f.includes(p)))
  .sort()

if (!python) {
  console.error('run_all: no python on PATH (python3 / python / py)')
  process.exit(2)
}
console.log(`run_all: ${files.length} fixture(s) x ${modes.join('+')}, results under ${outDir}`)

// release notes for package.json's version must exist and pass the release rules (release_checks.mjs)
const releaseRun = spawnSync(process.execPath, [path.join(here, 'release_checks.mjs')], { encoding: 'utf8' })
const releaseOk = releaseRun.status === 0
const releaseOut = `${releaseRun.stdout ?? ''}\n${releaseRun.stderr ?? ''}`.trim()
console.log(`${releaseOk ? 'PASS' : 'FAIL'}  release_checks.mjs  ${releaseOut.split('\n').slice(-1)[0] ?? ''}`)
if (!releaseOk) for (const r of releaseOut.split('\n').slice(0, -1)) console.log(`      ${r}`)

// each replay is its own app instance and data dir, so run REPLAY_JOBS at once
const run = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { encoding: 'utf8' })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('close', (status) => resolve({ status, stdout, stderr }))
  })

const tasks = files.flatMap((f) => modes.map((mode) => ({ f, mode })))
const jobs = Math.max(1, Number(process.env.REPLAY_JOBS) || os.cpus().length)
const results = []
let next = 0
await Promise.all(
  Array.from({ length: Math.min(jobs, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      const { f, mode } = tasks[i]
      const log = path.join(fixtures, f)
      const out = path.join(outDir, `${f.replace(/\.log$/, '')}.${mode}.json`)
      const t0 = Date.now()
      const replay = () => run(process.execPath, [path.join(here, 'replay.mjs'), '--log', log, '--mode', mode, '--out', out])
      let rep = await replay()
      // exit 3 = the app never became ready (start-up only, no checks ran): retry that once, never a real failure
      let retried = ''
      if (rep.status === 3) {
        retried = ' (retried: app not ready on first start)'
        console.log(`RETRY ${f} [${mode}]: app never became ready, starting it once more | ${(rep.stderr || '').trim().split('\n').slice(-2).join(' | ')}`)
        rep = await replay()
      }
      let line
      let detail = ''
      if (rep.status !== 0 || !fs.existsSync(out)) {
        line = 'FAIL'
        detail = `replay failed: ${(rep.stderr || rep.stdout || '').trim().split('\n').slice(-3).join(' | ')}`
      } else {
        const cmp = await run(python, [path.join(here, 'compare_log.py'), log, out])
        line = cmp.status === 0 ? 'PASS' : 'FAIL'
        detail = (cmp.stdout || cmp.stderr || '').trim()
      }
      results[i] = { line, f, mode, secs: ((Date.now() - t0) / 1000).toFixed(0), detail, retried }
    }
  })
)
let failed = releaseOk ? 0 : 1
for (const { line, f, mode, secs, detail, retried } of results) {
  if (line === 'FAIL') failed++
  const [summary, ...rest] = detail.split('\n')
  console.log(`${line}  ${f} [${mode}] ${secs}s${retried}  ${summary}`)
  if (line === 'FAIL') for (const r of rest) console.log(`      ${r}`)
}
console.log(failed ? `\n${failed} check(s) failed${releaseOk ? '' : ' (including release_checks.mjs)'}` : '\nall replays passed')
process.exit(failed ? 1 : 0)
