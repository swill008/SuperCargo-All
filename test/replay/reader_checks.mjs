// One OCR reader check (batch 15): bundles src/other/main/ocrReader.ts and drives createReaderCore with a fake
// worker factory (records setParameters / recognize / terminate, controllable recognize delays) and a fake timer
// for the time limit.
// Usage: node test/replay/reader_checks.mjs   (no build needed)
//        READER_SRC=<path to another ocrReader.ts> node test/replay/reader_checks.mjs   (run against a variant)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-reader-'))
const outfile = path.join(tmp, 'ocrReader.mjs')
// logger and paths import electron: stub them, the core never touches them
const stubMain = {
  name: 'stub-main',
  setup(b) {
    b.onResolve({ filter: /\/main\/(logger|paths)$/ }, (a) => ({ path: a.path, namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
      contents: a.path.endsWith('logger')
        ? 'export const logger = { info() {}, warn() {}, error() {}, debug() {} }'
        : 'export const cachePath = (...p) => "/nonexistent/" + p.join("/")',
      loader: 'js'
    }))
  }
}
await esbuild.build({
  entryPoints: [process.env.READER_SRC ? path.resolve(process.env.READER_SRC) : path.join(root, 'src/other/main/ocrReader.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  external: ['electron', 'tesseract.js'],
  plugins: [stubMain],
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const R = await import(pathToFileURL(outfile).href)
fs.rmSync(tmp, { recursive: true, force: true })

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const j = (v) => JSON.stringify(v)
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** fake tesseract: every worker records into the shared log; recognize waits `delays[job]` (or 5 ms) */
function fakeFactory(opts = {}) {
  const f = { created: 0, loads: 0, alive: 0, maxAlive: 0, log: [], params: {}, failLoad: opts.failLoad ?? 0, delay: opts.delay ?? 5 }
  f.createWorker = async () => {
    f.loads++
    await tick(1)
    if (f.failLoad > 0) {
      f.failLoad--
      throw new Error('load failed')
    }
    const id = ++f.created
    f.alive++
    f.maxAlive = Math.max(f.maxAlive, f.alive)
    let dead = false
    const params = {}
    return {
      async setParameters(p) {
        f.log.push(['set', id, { ...p }])
        Object.assign(params, p)
      },
      async recognize(png, o, out) {
        const tag = png.toString()
        f.log.push(['rec', id, tag, out ?? null, { ...params }])
        const ms = typeof f.delay === 'function' ? f.delay(tag) : f.delay
        if (ms === Infinity) await new Promise(() => undefined) // hung: never settles
        await tick(ms)
        if (dead) throw new Error('terminated')
        return {
          data: {
            text: 'text:' + tag,
            confidence: 90,
            blocks: out?.blocks ? [{ paragraphs: [{ lines: [{ words: [{ text: tag, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }] }] }] }] : undefined
          }
        }
      },
      async terminate() {
        f.log.push(['term', id])
        await tick(2)
        if (!dead) f.alive--
        dead = true
      }
    }
  }
  return f
}
const png = (s) => Buffer.from(s)
/** settle, or { ok: false, e: 'still pending' } after ms of real time (so a never-stopped job fails, not hangs) */
const within = (p, ms = 300) => Promise.race([settle(p), tick(ms).then(() => ({ ok: false, e: new Error(`still pending after ${ms} ms`) }))])
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
const isTimeout = (r) => !r.ok && r.e instanceof R.ReaderTimeoutError && r.e.name === 'ReaderTimeoutError'
const isTrashed = (r) => !r.ok && r.e instanceof R.ReaderTrashedError && r.e.name === 'ReaderTrashedError'
/** fake timer: setTimer records each timer; fire() runs one by hand */
function fakeTimers() {
  const t = { list: [] }
  t.setTimer = (fn, ms) => {
    const e = { fn, ms, cancelled: false, fired: false }
    t.list.push(e)
    return () => (e.cancelled = true)
  }
  t.live = () => t.list.filter((e) => !e.cancelled && !e.fired)
  t.fire = (e) => {
    e.fired = true
    e.fn()
  }
  return t
}
const recs = (f) => f.log.filter((e) => e[0] === 'rec').map((e) => e[2])

async function safe(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(name, 'runs', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '))
  }
}


// --- profiles: the contract's values; zones from ocrPrep zoneParams ---
await safe('profiles', async () => {
  const P = R.READER_PROFILES
  check('profiles', 'contract psm 3, keep spaces, thresholding 0', j(P.contract) === j({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', thresholding_method: '0' }), j(P.contract))
  check('profiles', 'zone1 psm 3, keep spaces, thresholding 0 (zoneParams(1))', j(P.zone1) === j({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', thresholding_method: '0' }), j(P.zone1))
  check('profiles', 'zone2 psm 6, keep spaces, Sauvola 2 (zoneParams(2))', j(P.zone2) === j({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', thresholding_method: '2' }), j(P.zone2))
})

// --- one worker for all three jobs (fails on the 1.0.2 shape: contract and WHERE AM I each made a worker) ---
await safe('one worker', async () => {
  const f = fakeFactory()
  const c = R.createReaderCore({ createWorker: f.createWorker })
  const a = await c.recognize(png('C1'), 'contract')
  await c.recognize(png('Z2'), 'zone2')
  await c.recognize(png('Z1'), 'zone1')
  check('one worker', 'contract + zone2 + zone1 create exactly 1 worker', f.created === 1, `created=${f.created}`)
  check('one worker', 'never more than one alive', f.maxAlive === 1, `maxAlive=${f.maxAlive}`)
  check('one worker', 'stats started=1 alive=1', c.stats().started === 1 && c.stats().alive === 1, j(c.stats()))
  check('one worker', 'contract gets blocks output', j(f.log.find((e) => e[0] === 'rec' && e[2] === 'C1')[3]) === j({ blocks: true }))
  check('one worker', 'contract result carries blocks', Array.isArray(a.blocks) && a.text === 'text:C1', j(a))
  check('one worker', 'zones use default output', f.log.filter((e) => e[0] === 'rec' && e[2] !== 'C1').every((e) => e[3] === null))
  await c.dispose()
  check('one worker', 'dispose leaves 0 alive', f.alive === 0 && c.stats().alive === 0, `alive=${f.alive}`)
  const after = await settle(c.recognize(png('X'), 'zone1'))
  check('one worker', 'no restart after dispose', !after.ok && f.created === 1, `created=${f.created}`)
})

// --- profile per job applied in full, also when jobs alternate ---
await safe('profiles applied', async () => {
  const f = fakeFactory()
  const c = R.createReaderCore({ createWorker: f.createWorker })
  for (const [t, job] of [['A', 'contract'], ['B', 'zone2'], ['C', 'zone1'], ['D', 'zone2'], ['E', 'contract'], ['F', 'zone1']])
    await c.recognize(png(t), job)
  const recEntries = f.log.filter((e) => e[0] === 'rec')
  const jobOf = { A: 'contract', B: 'zone2', C: 'zone1', D: 'zone2', E: 'contract', F: 'zone1' }
  check('profiles applied', "every read runs with its job's full profile", recEntries.every((e) => j(e[4]) === j(R.READER_PROFILES[jobOf[e[2]]])), j(recEntries.map((e) => [e[2], e[4]])))
  const sets = f.log.filter((e) => e[0] === 'set')
  check('profiles applied', 'each setParameters is a full profile (never partial)', sets.every((e) => Object.keys(e[2]).length === 3), j(sets))
  // A(set) B(set) C(set) D(set) E(set) F(none: contract == zone1 values)
  check('profiles applied', 'switch only when the profile differs (5 sets for 6 alternating jobs)', sets.length === 5 && c.stats().switches === 5, `sets=${sets.length}`)
  check('profiles applied', 'lastSwitchMs recorded', typeof c.stats().lastSwitchMs === 'number')
  await c.dispose()
})

// --- priority: contract before waiting zones, FIFO within a kind; contractPending ---
await safe('priority', async () => {
  const f = fakeFactory({ delay: 10 })
  const c = R.createReaderCore({ createWorker: f.createWorker })
  check('priority', 'contractPending() false when idle', c.contractPending() === false)
  const first = c.recognize(png('C0'), 'contract') // running
  await tick(3)
  check('priority', 'contractPending() true while a contract job runs', c.contractPending() === true)
  const ps = [c.recognize(png('Z1a'), 'zone1'), c.recognize(png('Z2a'), 'zone2'), c.recognize(png('C1'), 'contract'), c.recognize(png('C2'), 'contract'), c.recognize(png('Z1b'), 'zone1')]
  check('priority', 'busy while jobs run/queue', c.busy())
  await Promise.all([first, ...ps])
  check('priority', 'order C0 C1 C2 Z1a Z2a Z1b', j(recs(f)) === j(['C0', 'C1', 'C2', 'Z1a', 'Z2a', 'Z1b']), j(recs(f)))
  check('priority', 'not busy, no contract pending after', !c.busy() && !c.contractPending())
  await c.dispose()
})

// --- a contract job arriving trashes a running zone job; queued zones wait behind it, then run ---
await safe('contract trashes zone', async () => {
  const f = fakeFactory({ delay: (t) => (t.startsWith('Z') ? 40 : 5) })
  const logs = []
  const c = R.createReaderCore({ createWorker: f.createWorker, log: (m) => logs.push(m) })
  const run = settle(c.recognize(png('Zrun'), 'zone2'))
  const queued = settle(c.recognize(png('Zq'), 'zone1'))
  await tick(10)
  check('contract trashes zone', 'contractPending() false while only zones', !c.contractPending())
  const crP = c.recognize(png('Cnow'), 'contract')
  check('contract trashes zone', 'contractPending() true once the contract job arrives', c.contractPending())
  const cr = await crP
  const [rr, rq] = await Promise.all([run, queued])
  check('contract trashes zone', 'running zone job rejected with ReaderTrashedError', isTrashed(rr), String(rr.e))
  check('contract trashes zone', 'contract read done', cr.text === 'text:Cnow')
  check('contract trashes zone', 'queued zone job not rejected, runs after the contract', rq.ok && recs(f).indexOf('Cnow') < recs(f).indexOf('Zq'), j(recs(f)))
  check('contract trashes zone', 'terminate before create: never two alive', f.maxAlive === 1 && f.created === 2, `maxAlive=${f.maxAlive} created=${f.created}`)
  const termIdx = f.log.findIndex((e) => e[0] === 'term')
  const w2Idx = f.log.findIndex((e) => e[1] === 2)
  check('contract trashes zone', 'old worker terminated before the new one is used', termIdx >= 0 && termIdx < w2Idx)
  check('contract trashes zone', 'after restart the profile is applied again', f.log.some((e) => e[0] === 'set' && e[1] === 2))
  check('contract trashes zone', 'stats trashed=1 restarts=1', c.stats().trashed === 1 && c.stats().restarts === 1, j(c.stats()))
  check('contract trashes zone', 'log: ocr reader trashed for contract / ready / settings switch', ['ocr reader trashed for contract', 'ocr reader ready', 'ocr reader settings switch'].every((m) => logs.includes(m)), j(logs))
  await c.dispose()
  check('contract trashes zone', 'dispose leaves 0 alive', f.alive === 0 && c.stats().alive === 0)
})

// --- a running contract job is never trashed (a second contract waits) ---
await safe('contract kept', async () => {
  const f = fakeFactory({ delay: 20 })
  const c = R.createReaderCore({ createWorker: f.createWorker })
  const p = settle(c.recognize(png('Crun'), 'contract'))
  await tick(8)
  const p2 = c.recognize(png('C2'), 'contract')
  const r = await p
  await p2
  check('contract kept', 'running contract job survives a second contract', r.ok && r.v.text === 'text:Crun', String(r.e))
  check('contract kept', 'no terminate', !f.log.some((e) => e[0] === 'term'))
  await c.dispose()
})

// --- restarts counts only real terminations (trash while the first worker is still loading) ---
await safe('restarts', async () => {
  const f = fakeFactory({ delay: 5 })
  const slow = f.createWorker
  const c = R.createReaderCore({ createWorker: async () => (await tick(20), slow()) })
  const z = settle(c.recognize(png('Zload'), 'zone2'))
  await tick(5) // worker still loading
  const cr = await c.recognize(png('Cload'), 'contract')
  const zr = await z
  check('restarts', 'zone job trashed while loading', isTrashed(zr))
  check('restarts', 'contract read done on the loading worker', cr.text === 'text:Cload' && f.created === 1, `created=${f.created}`)
  check('restarts', 'restarts=0 (nothing terminated), trashed=1', c.stats().restarts === 0 && c.stats().trashed === 1, j(c.stats()))
  await c.dispose()
})

// --- load failure fails that job; the next job loads again and succeeds; one load at a time ---
await safe('load retry', async () => {
  const f = fakeFactory({ failLoad: 1 })
  const c = R.createReaderCore({ createWorker: f.createWorker })
  const a = await settle(c.recognize(png('C'), 'contract'))
  check('load retry', 'first job rejects with the load error (not trashed/timeout)', !a.ok && !isTrashed(a) && !isTimeout(a) && /load failed/.test(String(a.e)), String(a.e))
  check('load retry', 'not busy after the failure', !c.busy())
  const b = await settle(c.recognize(png('Z'), 'zone2'))
  check('load retry', 'next job loads again and succeeds', b.ok && b.v.text === 'text:Z' && f.loads === 2 && f.created === 1, `ok=${b.ok} loads=${f.loads} created=${f.created} ${String(b.e ?? '')}`)
  check('load retry', 'available() true after the retry', (await c.available()) === true)
  await c.dispose()

  const g = fakeFactory({ failLoad: 1 })
  const c2 = R.createReaderCore({ createWorker: g.createWorker })
  check('load retry', 'available() false on a failed load ...', (await c2.available()) === false)
  check('load retry', '... and true on the next call (load retried)', (await c2.available()) === true && g.loads === 2)
  await c2.dispose()

  const h = fakeFactory()
  const c3 = R.createReaderCore({ createWorker: h.createWorker })
  await Promise.all([c3.available(), c3.available(), c3.recognize(png('Q'), 'zone1')])
  check('load retry', 'one load at a time (3 concurrent callers, 1 load)', h.loads === 1, `loads=${h.loads}`)
  await c3.dispose()
})

// --- time limit: a hung job is stopped, next job on a fresh worker; a quick job untouched; load not counted ---
await safe('time limit', async () => {
  const f = fakeFactory()
  const t = fakeTimers()
  const logs = []
  const c = R.createReaderCore({ createWorker: f.createWorker, setTimer: t.setTimer, timeLimitMs: () => 10000, log: (m, d) => logs.push([m, d]) })
  await c.recognize(png('Quick'), 'zone2')
  check('time limit', 'a quick job: one 10000 ms timer, cancelled when the job finishes', t.list.length === 1 && t.list[0].ms === 10000 && t.list[0].cancelled, j(t.list.map((e) => [e.ms, e.cancelled])))
  check('time limit', 'quick job untouched (no timeout, no terminate)', c.stats().timeouts === 0 && !f.log.some((e) => e[0] === 'term') && !logs.some((e) => e[0] === 'ocr reader time limit hit'))
  await c.dispose()

  // a hung contract job (a contract is never trashed, so only the limit can stop it)
  const f2 = fakeFactory({ delay: (tag) => (tag === 'Hang' ? Infinity : 5) })
  const t2 = fakeTimers()
  const logs2 = []
  const c2 = R.createReaderCore({ createWorker: f2.createWorker, setTimer: t2.setTimer, timeLimitMs: () => 10000, log: (m, d) => logs2.push([m, d]) })
  const h = c2.recognize(png('Hang'), 'contract')
  h.catch(() => undefined)
  const q = c2.recognize(png('Next'), 'zone2') // queued behind the hung job
  await tick(15)
  const live = t2.live()
  check('time limit', 'hung job has a live timer', live.length === 1 && live[0].ms === 10000, j(t2.list.map((e) => [e.ms, e.cancelled, e.fired])))
  check('time limit', 'not stopped before the limit', !recs(f2).includes('Next') && c2.stats().timeouts === 0)
  if (live[0]) t2.fire(live[0])
  const hr = await within(h)
  check('time limit', 'hung job rejects with ReaderTimeoutError', isTimeout(hr), String(hr.e))
  const qs = await within(q)
  const qr = qs.ok ? qs.v : {}
  check('time limit', 'next job runs on a fresh worker', qr.text === 'text:Next' && f2.log.find((e) => e[0] === 'rec' && e[2] === 'Next')?.[1] === 2, j(f2.log))
  check('time limit', 'worker terminated, never two alive', f2.log.some((e) => e[0] === 'term' && e[1] === 1) && f2.maxAlive === 1, `maxAlive=${f2.maxAlive}`)
  check('time limit', 'stats timeouts=1', c2.stats().timeouts === 1, j(c2.stats()))
  const hit = logs2.find((e) => e[0] === 'ocr reader time limit hit')
  check('time limit', "log 'ocr reader time limit hit' with job and ms", !!hit && hit[1]?.job === 'contract' && typeof hit[1]?.ms === 'number', j(hit))
  await c2.dispose()
  check('time limit', 'dispose leaves 0 alive', f2.alive === 0)

  // the load is not counted: no timer while the worker loads
  const f3 = fakeFactory()
  const t3 = fakeTimers()
  let release
  const gate = new Promise((r) => (release = r))
  const c3 = R.createReaderCore({ createWorker: async () => (await gate, f3.createWorker()), setTimer: t3.setTimer, timeLimitMs: () => 10000 })
  const p3 = c3.recognize(png('L'), 'zone2')
  await tick(10)
  check('time limit', 'no timer while the worker loads (load excluded)', t3.list.length === 0, `timers=${t3.list.length}`)
  release()
  await p3
  check('time limit', 'timer starts once the job begins on the loaded worker', t3.list.length === 1)
  await c3.dispose()

  // the limit is read per job
  const f4 = fakeFactory()
  const t4 = fakeTimers()
  let lim = 7000
  const c4 = R.createReaderCore({ createWorker: f4.createWorker, setTimer: t4.setTimer, timeLimitMs: () => lim })
  await c4.recognize(png('a'), 'zone1')
  lim = 20000
  await c4.recognize(png('b'), 'zone1')
  check('time limit', 'limit read per job (7000 then 20000)', j(t4.list.map((e) => e.ms)) === j([7000, 20000]), j(t4.list.map((e) => e.ms)))
  await c4.dispose()

  // default without a limit dep: 10 s
  const f5 = fakeFactory()
  const t5 = fakeTimers()
  const c5 = R.createReaderCore({ createWorker: f5.createWorker, setTimer: t5.setTimer })
  await c5.recognize(png('d'), 'zone2')
  check('time limit', 'default limit 10000 ms', t5.list[0]?.ms === 10000, j(t5.list.map((e) => e.ms)))
  await c5.dispose()
})

// --- the setting: missing/invalid -> 10, clamp 5-30 ---
await safe('limit setting', async () => {
  const n = R.normalizeTimeLimitSec
  const cases = [[undefined, 10], [null, 10], ['abc', 10], ['15', 10], [NaN, 10], [Infinity, 10], [10, 10], [12, 12], [5, 5], [30, 30], [1, 5], [0, 5], [-3, 5], [31, 30], [999, 30]]
  const bad = cases.filter(([v, want]) => n(v) !== want).map(([v, want]) => `${String(v)}->${n(v)} want ${want}`)
  check('limit setting', 'missing/invalid -> 10; clamp to 5..30', bad.length === 0, bad.join(', '))
})

// --- dispose with a running and queued jobs ---
await safe('dispose', async () => {
  const f = fakeFactory({ delay: 30 })
  const t = fakeTimers()
  const c = R.createReaderCore({ createWorker: f.createWorker, setTimer: t.setTimer })
  const a = settle(c.recognize(png('A'), 'zone2'))
  const b = settle(c.recognize(png('B'), 'contract'))
  const z = settle(c.recognize(png('Z'), 'zone1'))
  await tick(10)
  await c.dispose()
  const rs = await Promise.all([a, b, z])
  check('dispose', 'every pending job rejects', rs.every((r) => !r.ok), j(rs.map((r) => r.ok)))
  check('dispose', 'leaves 0 alive, no live timers', f.alive === 0 && c.stats().alive === 0 && t.live().length === 0, `alive=${f.alive} timers=${t.live().length}`)
  check('dispose', 'available() false after dispose', (await c.available()) === false)
})

let fail = 0
for (const r of results) {
  if (!r.ok) fail++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.name}] ${r.what}${r.ok || !r.detail ? '' : '  -> ' + r.detail}`)
}
console.log(`\nreader checks: ${results.length - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
