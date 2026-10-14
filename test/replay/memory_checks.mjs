// Match memory checks: bundles src/other/otherMemory.ts and checks every function: keys, seen log, proofs,
// user set, reset (KEEP MINE), forget, undo (of set / reset / forget / proof), caps, the disputed rule, learnedPlace thresholds, labels.
// Usage: node test/replay/memory_checks.mjs   (no build needed)   --verbose prints every check

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-memory-'))
const outfile = path.join(tmp, 'otherMemory.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherMemory.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json'),
  alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
})
const M = await import(pathToFileURL(outfile).href)
const verbose = process.argv.includes('--verbose')

const results = []
const check = (name, what, ok, detail = '') => results.push({ name, what, ok: !!ok, detail })
const safe = (name, fn) => {
  try {
    fn()
  } catch (e) {
    check(name, 'threw', false, e?.stack ?? String(e))
  }
}
const T = (n) => new Date(Date.UTC(2026, 9, 14, 12, 0, n)).toISOString()
const J = (x) => JSON.stringify(x)
const seen = (key, place, status = 'unsure', extra = {}) => ({ key, text: key.toUpperCase(), place, status, confidence: 3, evidence: ['a', 'b'], ...extra })
const where = (name, meters = 2000) => ({ name, meters, at: T(0) })

safe('constants', () => {
  check('constants', 'MEMORY_MAX 500', M.MEMORY_MAX === 500)
  check('constants', 'CHANGES_MAX 50', M.CHANGES_MAX === 50)
  check('constants', 'PROOF_WINDOW_MS 10 min', M.PROOF_WINDOW_MS === 600_000)
  check('constants', 'PROOF_METERS 1.5 km', M.PROOF_METERS === 1500)
  const d = M.emptyMemoryDoc()
  check('emptyMemoryDoc', 'empty lists, fresh each call', d.entries.length === 0 && d.changes.length === 0 && d !== M.emptyMemoryDoc())
})

safe('memoryKey', () => {
  const k = M.memoryKey('Shubin Mining Facility SAL-2')
  check('memoryKey', 'case/spacing folded', k === M.memoryKey('  shubin  mining facility sal-2 '), k)
  check('memoryKey', 'no context: no @', !k.includes('@'), k)
  check('memoryKey', "'' context: same as none", M.memoryKey('Security Compound', '') === M.memoryKey('Security Compound'))
  const c = M.memoryKey('Security Compound', 'Alpha Station')
  check('memoryKey', 'context appended with @', c.endsWith('@' + M.memoryKey('Alpha Station')) && c.startsWith(M.memoryKey('Security Compound')), c)
  check('memoryKey', 'different context, different key', c !== M.memoryKey('Security Compound', 'Beta Station'))
})

safe('recordSeen', () => {
  let d = M.emptyMemoryDoc()
  const ex = M.recordSeen(d, seen('k1', 'P', 'exact'), T(1))
  check('recordSeen', 'exact is not remembered (same doc back)', ex === d)
  d = M.recordSeen(d, seen('k1', 'Place A'), T(1))
  const e = M.lookupMemory(d, 'k1')
  check('recordSeen', 'new entry: game origin, seen 1, place, status, evidence', e && e.origin === 'game' && e.seen === 1 && e.place === 'Place A' && e.lastStatus === 'unsure' && e.lastConfidence === 3 && J(e.lastEvidence) === J(['a', 'b']) && e.firstAt === T(1), J(e))
  check('recordSeen', "new entry logs 'seen-new' (before null)", d.changes.length === 1 && d.changes[0].what === 'seen-new' && d.changes[0].by === 'game' && d.changes[0].before === null && d.changes[0].after?.key === 'k1', J(d.changes))
  const d0 = d
  d = M.recordSeen(d, seen('k1', 'Place A', 'guess', { text: 'k1 v2' }), T(2))
  const e2 = M.lookupMemory(d, 'k1')
  check('recordSeen', 'repeat bumps seen, updates text/status/lastAt, keeps firstAt', e2.seen === 2 && e2.text === 'k1 v2' && e2.lastStatus === 'guess' && e2.lastAt === T(2) && e2.firstAt === T(1), J(e2))
  check('recordSeen', 'repeat logs nothing', d.changes.length === 1)
  check('recordSeen', 'input doc unchanged', M.lookupMemory(d0, 'k1').seen === 1 && d0.entries.length === 1)
  const many = M.recordSeen(d, seen('k1', 'Place A', 'unsure', { evidence: Array.from({ length: 12 }, (_, i) => `e${i}`) }), T(3))
  check('recordSeen', 'evidence capped at 8', M.lookupMemory(many, 'k1').lastEvidence.length === 8)
  const ctx = M.recordSeen(d, seen('k2', null, 'none', { context: 'alpha station' }), T(3))
  check('recordSeen', 'context kept; null place ok', M.lookupMemory(ctx, 'k2').context === 'alpha station' && M.lookupMemory(ctx, 'k2').place === null)
  // game entry with proofs, resolver now says another place: counts reset
  let g = M.recordProof(d, { key: 'k1', text: 'K1', place: 'Place A', ok: true, actual: where('Place A', 10) }, T(4))
  g = M.recordSeen(g, seen('k1', 'Place B'), T(5))
  const gb = M.lookupMemory(g, 'k1')
  check('recordSeen', 'game entry follows a new place; counts reset', gb.place === 'Place B' && gb.confirmed === 0 && gb.wrong === 0, J(gb))
  // user entries keep their place
  let u = M.setUserPlace(d, { key: 'k1', text: 'K1', place: 'Mine' }, T(4))
  u = M.recordSeen(u, seen('k1', 'Other'), T(5))
  const ue = M.lookupMemory(u, 'k1')
  check('recordSeen', 'user entry keeps its place and origin', ue.place === 'Mine' && ue.origin === 'user' && ue.seen === 3, J(ue))
})

safe('recordProof', () => {
  let d = M.recordSeen(M.emptyMemoryDoc(), seen('k', 'A'), T(1))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: true, actual: where('A', 30) }, T(2))
  let e = M.lookupMemory(d, 'k')
  check('recordProof', 'ok -> confirmed +1', e.confirmed === 1 && e.wrong === 0, J(e))
  check('recordProof', "logs 'proof' by game with before/after", d.changes[0].what === 'proof' && d.changes[0].by === 'game' && d.changes[0].before.confirmed === 0 && d.changes[0].after.confirmed === 1)
  check('learnedPlace', 'game confirmed 1: not learned', M.learnedPlace(e) === null)
  check('memoryLabel', 'unproven', M.memoryLabel(e) === 'unproven', M.memoryLabel(e))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: true, actual: where('A', 30) }, T(3))
  e = M.lookupMemory(d, 'k')
  check('learnedPlace', 'game confirmed 2 > wrong 0: learned', J(M.learnedPlace(e)) === J({ place: 'A', strength: 'learned' }), J(M.learnedPlace(e)))
  check('memoryLabel', 'game confirmed ×2', M.memoryLabel(e) === 'game confirmed ×2', M.memoryLabel(e))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('B', 4000) }, T(4))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('C', 5000) }, T(5))
  e = M.lookupMemory(d, 'k')
  check('recordProof', 'not ok -> wrong +1, wrongAt newest first', e.wrong === 2 && e.wrongAt[0].name === 'C' && e.wrongAt[1].name === 'B', J(e))
  check('learnedPlace', 'confirmed 2 == wrong 2: not learned', M.learnedPlace(e) === null)
  check('memoryLabel', 'game wrong >= 2: the game disagrees', M.memoryLabel(e) === '⚠ the game disagrees', M.memoryLabel(e))
  check('recordProof', 'game entry never disputed', !e.disputed)
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('D', 6000) }, T(6))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('E', 7000) }, T(7))
  e = M.lookupMemory(d, 'k')
  check('recordProof', 'wrongAt keeps last 3', e.wrongAt.length === 3 && J(e.wrongAt.map((w) => w.name)) === J(['E', 'D', 'C']), J(e.wrongAt))
  const fresh = M.recordProof(M.emptyMemoryDoc(), { key: 'n', text: 'N', context: 'ctx', place: 'A', ok: true, actual: where('A', 5) }, T(1))
  const fe = M.lookupMemory(fresh, 'n')
  check('recordProof', 'no entry yet: creates a game entry', fe && fe.origin === 'game' && fe.confirmed === 1 && fe.context === 'ctx' && fresh.changes[0].before === null, J(fe))
  const moved = M.recordProof(d, { key: 'k', text: 'K', place: 'Z', ok: true, actual: where('Z', 5) }, T(8))
  const me = M.lookupMemory(moved, 'k')
  check('recordProof', 'game entry, proof for another place: follows it, counts reset', me.place === 'Z' && me.confirmed === 1 && me.wrong === 0 && !me.wrongAt, J(me))
})

safe('setUserPlace', () => {
  let d = M.recordSeen(M.emptyMemoryDoc(), seen('k', 'A'), T(1))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: true, actual: where('A', 5) }, T(2))
  const right = M.setUserPlace(d, { key: 'k', text: 'K', place: 'A' }, T(3))
  const r = M.lookupMemory(right, 'k')
  check('setUserPlace', '✓ Right on the same place: user origin, counts kept', r.origin === 'user' && r.place === 'A' && r.confirmed === 1, J(r))
  check('setUserPlace', "logs 'set' by user", right.changes[0].what === 'set' && right.changes[0].by === 'user' && right.changes[0].before.origin === 'game')
  check('learnedPlace', 'user: always', J(M.learnedPlace(r)) === J({ place: 'A', strength: 'user' }))
  check('memoryLabel', 'you set it', M.memoryLabel(r) === 'you set it')
  const pick = M.setUserPlace(d, { key: 'k', text: 'K', place: 'B' }, T(3))
  const p = M.lookupMemory(pick, 'k')
  check('setUserPlace', 'pick another place: counts reset', p.place === 'B' && p.confirmed === 0 && p.wrong === 0, J(p))
  const fresh = M.setUserPlace(M.emptyMemoryDoc(), { key: 'n', text: 'N', context: 'c', place: 'Q' }, T(1))
  const f = M.lookupMemory(fresh, 'n')
  check('setUserPlace', 'no entry yet: creates a user entry', f.origin === 'user' && f.place === 'Q' && f.context === 'c' && fresh.changes[0].before === null, J(f))
})

safe('disputed', () => {
  let d = M.setUserPlace(M.emptyMemoryDoc(), { key: 'k', text: 'K', place: 'A' }, T(1))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('B', 3000) }, T(2))
  let e = M.lookupMemory(d, 'k')
  check('disputed', 'user wrong 1: not disputed', e.wrong === 1 && !e.disputed && M.memoryLabel(e) === 'you set it', J(e))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('B', 2500) }, T(3))
  e = M.lookupMemory(d, 'k')
  check('disputed', 'user wrong 2: disputed, flagged, place kept', e.disputed === true && e.place === 'A' && e.origin === 'user' && e.wrongAt[0].name === 'B', J(e))
  check('disputed', 'label: the game disagrees', M.memoryLabel(e) === '⚠ the game disagrees')
  check('disputed', 'learnedPlace still the user place (user wins)', J(M.learnedPlace(e)) === J({ place: 'A', strength: 'user' }))
  const reset = M.setUserPlace(d, { key: 'k', text: 'K', place: 'B' }, T(4))
  check('disputed', 'user picks again: counts reset, no longer disputed', !M.lookupMemory(reset, 'k').disputed && M.lookupMemory(reset, 'k').wrong === 0)
  // proof resolved to a different place than the user set
  let u = M.setUserPlace(M.emptyMemoryDoc(), { key: 'u', text: 'U', place: 'A' }, T(1))
  u = M.recordProof(u, { key: 'u', text: 'U', place: 'X', ok: true, actual: where('X', 10) }, T(2))
  check('recordProof', 'user entry, proof ok at another place: wrong for the user place', M.lookupMemory(u, 'u').wrong === 1 && M.lookupMemory(u, 'u').place === 'A')
  u = M.recordProof(u, { key: 'u', text: 'U', place: 'X', ok: false, actual: where('A', 100) }, T(3))
  check('recordProof', 'user entry, proof elsewhere but you were at the user place: confirmed', M.lookupMemory(u, 'u').confirmed === 1)
})

safe('reset', () => {
  let d = M.setUserPlace(M.emptyMemoryDoc(), { key: 'k', text: 'K', place: 'A' }, T(1))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: true, actual: where('A', 10) }, T(2))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('B', 3000) }, T(3))
  d = M.recordProof(d, { key: 'k', text: 'K', place: 'A', ok: false, actual: where('B', 2500) }, T(4))
  const before = M.lookupMemory(d, 'k')
  check('reset', 'setup: disputed user entry, confirmed 1', before.disputed === true && before.wrong === 2 && before.confirmed === 1 && before.wrongAt.length === 2, J(before))
  const plain = M.lookupMemory(M.setUserPlace(d, { key: 'k', text: 'K', place: 'A' }, T(5)), 'k')
  check('reset', 'without reset: same place keeps the dispute (as before)', plain.disputed === true && plain.wrong === 2, J(plain))
  const r = M.setUserPlace(d, { key: 'k', text: 'K', place: 'A', reset: true }, T(5))
  const e = M.lookupMemory(r, 'k')
  check('reset', 'KEEP MINE: wrong 0, no wrongAt, not disputed', e.wrong === 0 && !e.wrongAt && !e.disputed, J(e))
  check('reset', 'KEEP MINE: confirmed, place, origin kept', e.confirmed === 1 && e.place === 'A' && e.origin === 'user', J(e))
  check('reset', 'label back to you set it', M.memoryLabel(e) === 'you set it', M.memoryLabel(e))
  const c = r.changes[0]
  check('reset', "logs 'set' by user with before (disputed) and after (clear)", c.what === 'set' && c.by === 'user' && c.before.disputed === true && c.before.wrong === 2 && c.after.wrong === 0 && !c.after.disputed, J(c))
  check('reset', 'input doc unchanged', M.lookupMemory(d, 'k').disputed === true && M.lookupMemory(d, 'k').wrongAt.length === 2)
  const u = M.undoChange(r, 0, T(6))
  const ue = M.lookupMemory(u, 'k')
  check('reset', 'UNDO restores the disputed entry', ue.disputed === true && ue.wrong === 2 && ue.confirmed === 1 && J(ue.wrongAt) === J(before.wrongAt) && ue.place === 'A', J(ue))
  check('reset', "UNDO logs 'undo' (before = cleared, after = disputed)", u.changes[0].what === 'undo' && u.changes[0].before.wrong === 0 && u.changes[0].after.disputed === true)
  const use = M.lookupMemory(M.setUserPlace(d, { key: 'k', text: 'K', place: 'B' }, T(5)), 'k')
  check('reset', 'USE WHERE I WAS (another place): counts reset, not disputed', use.place === 'B' && use.confirmed === 0 && use.wrong === 0 && !use.wrongAt && !use.disputed, J(use))
  const fresh = M.setUserPlace(M.emptyMemoryDoc(), { key: 'n', text: 'N', place: 'Q', reset: true }, T(1))
  const f = M.lookupMemory(fresh, 'n')
  check('reset', 'reset on a new key: plain user entry', f.origin === 'user' && f.place === 'Q' && f.wrong === 0 && f.confirmed === 0 && !f.disputed, J(f))
})

safe('forgetEntry', () => {
  let d = M.recordSeen(M.emptyMemoryDoc(), seen('k', 'A'), T(1))
  const same = M.forgetEntry(d, 'nope', T(2))
  check('forgetEntry', 'unknown key: same doc', same === d)
  d = M.forgetEntry(d, 'k', T(2))
  check('forgetEntry', "removed; logs 'forget' by user (after null)", !M.lookupMemory(d, 'k') && d.changes[0].what === 'forget' && d.changes[0].by === 'user' && d.changes[0].after === null && d.changes[0].before.key === 'k')
})

safe('undoChange', () => {
  let d = M.recordSeen(M.emptyMemoryDoc(), seen('k', 'A'), T(1))
  d = M.setUserPlace(d, { key: 'k', text: 'K', place: 'B' }, T(2))
  let u = M.undoChange(d, 0, T(3))
  let e = M.lookupMemory(u, 'k')
  check('undoChange', 'undo set: back to the game entry', e.origin === 'game' && e.place === 'A', J(e))
  check('undoChange', "logs 'undo' (before = now, after = restored)", u.changes[0].what === 'undo' && u.changes[0].before.place === 'B' && u.changes[0].after.place === 'A')
  const f = M.forgetEntry(d, 'k', T(3))
  u = M.undoChange(f, 0, T(4))
  e = M.lookupMemory(u, 'k')
  check('undoChange', 'undo forget: entry back', e && e.origin === 'user' && e.place === 'B', J(e))
  const p = M.recordProof(d, { key: 'k', text: 'K', place: 'B', ok: false, actual: where('C', 9000) }, T(3))
  u = M.undoChange(p, 0, T(4))
  e = M.lookupMemory(u, 'k')
  check('undoChange', 'undo proof: count back', e.wrong === 0 && !e.wrongAt, J(e))
  u = M.undoChange(d, d.changes.length - 1, T(4))
  check('undoChange', 'undo seen-new (before null): entry removed', !M.lookupMemory(u, 'k'))
  const twice = M.undoChange(u, 0, T(5))
  check('undoChange', 'undo the undo: entry back', !!M.lookupMemory(twice, 'k'))
  check('undoChange', 'bad index: same doc', M.undoChange(d, 99, T(5)) === d && M.undoChange(d, -1, T(5)) === d)
})

safe('caps', () => {
  let d = M.emptyMemoryDoc()
  d = M.setUserPlace(d, { key: 'user-old', text: 'U', place: 'A' }, '2025-01-01T00:00:00.000Z')
  for (let i = 0; i < M.MEMORY_MAX + 20; i++) d = M.recordSeen(d, seen(`k${i}`, 'P'), new Date(Date.UTC(2026, 0, 1) + (i + 1) * 1000).toISOString())
  check('caps', 'entries capped at 500', d.entries.length === M.MEMORY_MAX, String(d.entries.length))
  check('caps', 'user entry (oldest lastAt) kept', !!M.lookupMemory(d, 'user-old'))
  check('caps', 'oldest game entries dropped first', !M.lookupMemory(d, 'k0') && !M.lookupMemory(d, 'k20') && !!M.lookupMemory(d, 'k21') && !!M.lookupMemory(d, `k${M.MEMORY_MAX + 19}`))
  check('caps', 'changes capped at 50, newest first', d.changes.length === M.CHANGES_MAX && d.changes[0].key === `k${M.MEMORY_MAX + 19}`, String(d.changes.length))
  let all = M.emptyMemoryDoc()
  for (let i = 0; i < M.MEMORY_MAX + 3; i++) all = M.setUserPlace(all, { key: `u${i}`, text: 'U', place: 'A' }, T(i % 60))
  check('caps', 'user entries are never dropped (may exceed the cap)', all.entries.length === M.MEMORY_MAX + 3)
})

safe('learnedPlace', () => {
  const base = { key: 'k', text: 'K', place: 'A', origin: 'game', confirmed: 0, wrong: 0, seen: 1, firstAt: T(0), lastAt: T(0) }
  const rows = [
    [{ confirmed: 2, wrong: 0 }, 'learned'],
    [{ confirmed: 3, wrong: 2 }, 'learned'],
    [{ confirmed: 2, wrong: 2 }, null],
    [{ confirmed: 1, wrong: 0 }, null],
    [{ confirmed: 5, wrong: 0, place: null }, null],
    [{ origin: 'user' }, 'user'],
    [{ origin: 'user', place: null }, null]
  ]
  for (const [over, want] of rows) {
    const got = M.learnedPlace({ ...base, ...over })
    check('learnedPlace', J(over), (got?.strength ?? null) === want, J(got))
  }
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  if (!ok || verbose) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
