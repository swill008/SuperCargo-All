// AFK button checks: bundles src/other/otherAfk.ts and drives the pure cycle with a fake clock;
// also sanity-checks the PowerShell/C# helper text in src/other/main/afk.ts (it can only run on Windows).
// Usage: node test/replay/afk_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-afk-'))
const outfile = path.join(tmp, 'otherAfk.mjs')

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherAfk.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const A = await import(pathToFileURL(outfile).href)

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const j = (v) => JSON.stringify(v)

// key names -> scan codes (PS/2 set 1)
const want = { F1: 0x3b, F2: 0x3c, F10: 0x44, F11: 0x57, F12: 0x58, Escape: 0x01, Tab: 0x0f, M: 0x32, A: 0x1e, Z: 0x2c, 1: 0x02, 0: 0x0b }
for (const [k, scan] of Object.entries(want)) {
  const sc = A.afkScanCode(k)
  check('scan', `${k} = 0x${scan.toString(16)}`, sc && sc.scan === scan && sc.ext === false, j(sc))
}
check('scan', 'lower case f2 works', A.afkScanCode('f2')?.scan === 0x3c)
check('scan', 'esc alias', A.normaliseAfkKey('esc') === 'Escape')
check('scan', 'unknown -> null', A.afkScanCode('F13') === null && A.afkScanCode('') === null && A.afkScanCode(5) === null)
check('scan', 'every listed name has a code', A.AFK_KEY_NAMES.every((k) => A.afkScanCode(k)), A.AFK_KEY_NAMES.length + ' names')
const codes = A.AFK_KEY_NAMES.map((k) => A.afkScanCode(k).scan)
check('scan', 'codes are unique', new Set(codes).size === codes.length)

// next-key sequence
const seq = [0, 1, 2, 3].map((i) => A.afkKeyForPress(i, 'F2', 'F1'))
check('keys', 'F2 once, then F1', j(seq) === j(['F2', 'F1', 'F1', 'F1']), j(seq))

// config
const def = A.afkConfig({})
check('config', 'defaults', def.intervalMs === 15000 && def.firstKey === 'F2' && def.cycleKey === 'F1' && def.maxMs === 120 * 60000 && def.whereRead === true, j(def))
check('config', 'interval clamped', A.afkConfig({ otherAfkIntervalSec: 1 }).intervalMs === 5000 && A.afkConfig({ otherAfkIntervalSec: 99999 }).intervalMs === 600000)
check('config', 'test override', A.afkConfig({ otherAfkIntervalSec: 15 }, 50).intervalMs === 50)
check('config', 'bad key -> default', A.afkConfig({ otherAfkFirstKey: 'Ctrl', otherAfkCycleKey: 'm' }).firstKey === 'F2' && A.afkConfig({ otherAfkCycleKey: 'm' }).cycleKey === 'M')
check('config', '0 = no limit', A.afkConfig({ otherAfkMaxMin: 0 }).maxMs === 0)
check('config', 'where read off', A.afkConfig({ otherAfkWhereRead: false }).whereRead === false)

// cycle with a fake clock: 15 s interval, 1 min limit
const T0 = Date.parse('2026-10-14T12:00:00Z')
const cfg = A.afkConfig({ otherAfkIntervalSec: 15, otherAfkMaxMin: 1 })
let s = A.afkStart(T0, cfg, true)
check('cycle', 'start: on, first press due now, ends in 1 min', s.on && s.presses === 0 && Date.parse(s.nextAt) === T0 && Date.parse(s.endsAt) === T0 + 60000 && s.dryRun === true, j(s))
const sent = []
let now = T0
let stopped = null
for (let n = 0; n < 10; n++) {
  const why = A.afkStopReason(s, now)
  if (why) {
    stopped = why
    s = A.afkStopped(s)
    break
  }
  const key = A.afkNextKey(s, cfg)
  sent.push(key)
  s = A.afkPressed(s, now, cfg, key)
  check('cycle', `press ${n + 1}: next in 15 s`, Date.parse(s.nextAt) === now + 15000 && A.afkMsToNext(s, now + 3000) === 12000)
  now = Date.parse(s.nextAt)
}
check('cycle', 'presses at 0,15,30,45 s then time limit', j(sent) === j(['F2', 'F1', 'F1', 'F1']) && stopped === 'time limit', `${j(sent)} ${stopped}`)
check('cycle', 'stopped state', !s.on && s.presses === 4 && s.nextAt === undefined && A.afkMsToNext(s, now) === null, j(s))
check('cycle', 'lastKeys newest last', j(s.lastKeys) === j(['F2', 'F1', 'F1', 'F1']))

let s2 = A.afkStart(T0, A.afkConfig({ otherAfkMaxMin: 0 }), false)
check('cycle', 'no limit: no endsAt, never time-stops', s2.endsAt === undefined && A.afkStopReason(s2, T0 + 1e9) === null && s2.dryRun === undefined)
for (let i = 0; i < 8; i++) s2 = A.afkPressed(s2, T0 + i, cfg, 'F1')
check('cycle', 'lastKeys capped', s2.lastKeys.length === A.AFK_LAST_KEYS_MAX && s2.presses === 8)
const sk = A.afkSkipped(s2, T0, cfg, 'could not bring the game to the front')
check('cycle', 'skip keeps count, sets error, reschedules', sk.presses === 8 && sk.lastError && Date.parse(sk.nextAt) === T0 + 15000)
check('cycle', 'next good press clears error', A.afkPressed(sk, T0, cfg, 'F1').lastError === undefined)
check('cycle', 'stop with error', A.afkStopped(s2, 'Star Citizen window closed').lastError === 'Star Citizen window closed')
check('cycle', 'off state stop reason', A.afkStopReason(A.afkOff(), T0) === 'off')

// where reads: first after the first press, then about once a minute
check('where', 'first read due', A.afkWhereDue(null, T0))
check('where', 'not again within a minute', !A.afkWhereDue(T0, T0 + 45000))
check('where', 'due after a minute', A.afkWhereDue(T0, T0 + 60000))
check('where', 'delay ~2 s', A.AFK_WHERE_DELAY_MS === 2000)

// helper script text (can't run here): pull the String.raw block out of afk.ts
const src = fs.readFileSync(path.join(root, 'src/other/main/afk.ts'), 'utf8')
const m = src.match(/AFK_HELPER_PS1 = String\.raw`([\s\S]*?)`\n/)
check('helper', 'script found', !!m)
if (m) {
  const ps = m[1]
  const cs = (ps.match(/@'\n([\s\S]*?)\n'@/) || [])[1] ?? ''
  const bal = (t, a, b) => t.split(a).length === t.split(b).length
  check('helper', 'C# block present', cs.includes('public static class ScAfk'))
  check('helper', 'C# braces balanced', bal(cs, '{', '}') && bal(cs, '(', ')'))
  check('helper', 'PS braces balanced', bal(ps.replace(cs, ''), '{', '}'))
  check('helper', 'scan-code flag 0x0008', /KEYEVENTF_SCANCODE = 0x0008/.test(cs))
  check('helper', 'key up flag 0x0002', /KEYEVENTF_KEYUP = 0x0002/.test(cs))
  check('helper', 'union with MOUSEINPUT (x64 size)', /FieldOffset\(0\)\] public MOUSEINPUT/.test(cs) && /Marshal\.SizeOf\(typeof\(INPUT\)\)/.test(cs))
  check('helper', 'finds StarCitizen process + title fallback', cs.includes('GetProcessesByName("StarCitizen")') && cs.includes('"Star Citizen"'))
  check('helper', 'foreground workaround', cs.includes('AttachThreadInput') && cs.includes('VK_MENU') && cs.includes('SW_RESTORE'))
  check('helper', 'no key when focus fails', /-not \[ScAfk\]::Focus\(\$h\)\) \{ Reply '\{"ok":false,"found":true/.test(ps))
  check('helper', 'no backtick or ${ in raw string', !ps.includes('`') && !ps.includes('${'))
  check('helper', 'one JSON reply per line', [...ps.matchAll(/Reply '(\{[^']*\})'/g)].every((x) => { try { JSON.parse(x[1]); return true } catch { return false } }))
}

let bad = 0
for (const r of results) {
  if (!r.ok) bad++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.what}${r.detail && !r.ok ? '  (' + r.detail + ')' : ''}`)
}
console.log(`\n${results.length - bad}/${results.length} passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
