// Blocked list checks (batch 16): bundles src/other/otherBlocked.ts and checks normalize (bad input), add (dedupe by
// kind+key, newest first), remove, isBlockedIn, request validation and the delete orchestration with stubs.
// Usage: node test/replay/blocked_checks.mjs   (no build needed)   --verbose prints every check

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-blocked-'))
const outfile = path.join(tmp, 'otherBlocked.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/other/otherBlocked.ts')],
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
const T = (n) => new Date(Date.UTC(2026, 9, 15, 12, 0, n)).toISOString()
const J = (x) => JSON.stringify(x)
const item = (kind, key, at, label = key.toUpperCase()) => ({ kind, key, label, at })

safe('normalizeBlockedDoc', () => {
  for (const bad of [null, undefined, 3, 'x', [], {}, { items: 'no' }]) {
    check('normalizeBlockedDoc', `bad doc ${J(bad)} -> empty`, J(M.normalizeBlockedDoc(bad)) === J({ items: [] }))
  }
  const d = M.normalizeBlockedDoc({
    items: [
      item('place', 'a', T(1)),
      item('place', 'a', T(5), 'A new'),
      item('site', 'a', T(2)),
      { kind: 'other', key: 'x', label: 'x', at: T(1) },
      { kind: 'place', key: '', label: 'x', at: T(1) },
      { kind: 'place', key: 'nolabel', at: T(3) },
      { kind: 'planet', key: 'p', label: 'P' },
      null,
      7
    ]
  })
  check('normalizeBlockedDoc', 'bad items dropped, dupes keep newest', d.items.length === 3, J(d))
  check('normalizeBlockedDoc', 'newest first', d.items[0].key === 'a' && d.items[0].kind === 'place' && d.items[0].label === 'A new', J(d.items[0]))
  check('normalizeBlockedDoc', 'missing label falls back to key', d.items.find((i) => i.key === 'nolabel')?.label === 'nolabel')
  check('normalizeBlockedDoc', 'same key, other kind kept', d.items.some((i) => i.kind === 'site' && i.key === 'a'))
  const many = M.normalizeBlockedDoc({ items: Array.from({ length: 5000 }, (_, n) => item('place', `k${n}`, T(n % 60))) })
  check('normalizeBlockedDoc', 'no cap: 5000 items all kept', many.items.length === 5000)
  check('normalizeBlockedDoc', 'no BLOCKED_MAX export', M.BLOCKED_MAX === undefined)
})

safe('addBlocked', () => {
  const d0 = M.emptyBlockedDoc()
  check('addBlocked', 'nothing to add: same doc', M.addBlocked(d0, []) === d0)
  const d1 = M.addBlocked(d0, [item('place', 'a', T(1)), item('site', 's', T(1))])
  check('addBlocked', 'adds two', d1.items.length === 2 && d0.items.length === 0)
  const d2 = M.addBlocked(d1, [item('place', 'a', T(9), 'relabel')])
  check('addBlocked', 'dedupe by kind+key', d2.items.length === 2, J(d2))
  check('addBlocked', 'refreshed item moves to front with new at/label', d2.items[0].key === 'a' && d2.items[0].at === T(9) && d2.items[0].label === 'relabel')
  const d3 = M.addBlocked(d2, [item('planet', 'a', T(10)), item('planet', 'a', T(10))])
  check('addBlocked', 'same key other kind is separate; dupes in one call once', d3.items.length === 3)
  const d4 = M.addBlocked(d0, [{ kind: 'place', key: 'x', label: '', at: T(1) }])
  check('addBlocked', 'empty label -> key', d4.items[0].label === 'x')
  let big = M.emptyBlockedDoc()
  big = M.addBlocked(big, Array.from({ length: 3000 }, (_, n) => item('site', `s${n}`, T(1))))
  big = M.addBlocked(big, Array.from({ length: 3000 }, (_, n) => item('place', `p${n}`, T(2))))
  check('addBlocked', 'no cap: 6000 blocks kept', big.items.length === 6000 && big.items[5999].key === 's2999')
  check('addBlocked', 'bad kind ignored', M.addBlocked(d0, [{ kind: 'nope', key: 'x', label: 'x', at: T(1) }]) === d0)
})

safe('removeBlocked / isBlockedIn', () => {
  const d = M.addBlocked(M.emptyBlockedDoc(), [item('place', 'a', T(1)), item('site', 'a', T(2)), item('planet', 'p', T(3))])
  check('isBlockedIn', 'place a', M.isBlockedIn(d, 'place', 'a'))
  check('isBlockedIn', 'planet a not', !M.isBlockedIn(d, 'planet', 'a'))
  check('removeBlocked', 'nothing matched: same doc', M.removeBlocked(d, [{ kind: 'planet', key: 'a' }]) === d)
  check('removeBlocked', 'bad input: same doc', M.removeBlocked(d, [null, { kind: 'x', key: 'a' }]) === d)
  const r = M.removeBlocked(d, [{ kind: 'place', key: 'a' }, { kind: 'planet', key: 'p' }])
  check('removeBlocked', 'removes only kind+key matches', r.items.length === 1 && r.items[0].kind === 'site', J(r))
  check('removeBlocked', 'input doc unchanged', d.items.length === 3)
})

safe('cleanDeleteRequest / cleanUnblockList', () => {
  for (const bad of [null, {}, { kind: 'place' }, { kind: 'x', keys: ['a'] }, { kind: 'place', keys: [] }, { kind: 'place', keys: [1, ''] }]) {
    check('cleanDeleteRequest', `bad ${J(bad)} -> null`, M.cleanDeleteRequest(bad) === null)
  }
  const big = { kind: 'place', keys: Array.from({ length: M.DELETE_KEYS_MAX + 1 }, (_, n) => `k${n}`) }
  check('cleanDeleteRequest', 'too many keys -> null', M.cleanDeleteRequest(big) === null)
  const r = M.cleanDeleteRequest({ kind: 'site', keys: ['a', 'a', 3, 'b'], block: 'yes' })
  check('cleanDeleteRequest', 'deduped, non-strings dropped, block only when true', J(r) === J({ kind: 'site', keys: ['a', 'b'], block: false }), J(r))
  const l = M.cleanDeleteRequest({ kind: 'place', keys: ['a', 'b', 'c'], block: true, labels: { a: '  Alpha  ', b: 5, c: '   ', z: 'Other' } })
  check('cleanDeleteRequest', 'labels: strings only, trimmed, only request keys', J(l.labels) === J({ a: 'Alpha' }), J(l))
  check('cleanDeleteRequest', 'labels: none usable -> no field', !('labels' in M.cleanDeleteRequest({ kind: 'place', keys: ['a'], labels: { a: 1 } })))
  check('cleanDeleteRequest', 'labels: not an object -> no field', !('labels' in M.cleanDeleteRequest({ kind: 'place', keys: ['a'], labels: ['x'] })))
  check('cleanDeleteRequest', 'labels: inherited keys ignored', !('labels' in M.cleanDeleteRequest({ kind: 'place', keys: ['toString'], labels: {} })))
  check('cleanUnblockList', 'not an array -> []', M.cleanUnblockList({}).length === 0)
  const u = M.cleanUnblockList([{ kind: 'place', key: 'a', extra: 1 }, { kind: 'x', key: 'b' }, { kind: 'site', key: '' }, null])
  check('cleanUnblockList', 'keeps valid, strips extras', J(u) === J([{ kind: 'place', key: 'a' }]), J(u))
})

safe('runDelete', () => {
  const calls = []
  const deps = {
    labels: (kind, keys) => {
      calls.push(['labels', kind, keys.length])
      return new Map([['a', 'Alpha text']])
    },
    remove: (kind, keys) => {
      calls.push(['remove', kind, keys.length])
      return keys.filter((k) => k !== 'missing').length
    }
  }
  const d0 = M.emptyBlockedDoc()
  const bad = M.runDelete(d0, { kind: 'place', keys: [] }, deps, T(1))
  check('runDelete', 'bad request: not ok, nothing called', !bad.reply.ok && bad.reply.error && bad.doc === d0 && calls.length === 0)
  const plain = M.runDelete(d0, { kind: 'place', keys: ['a', 'b'], block: false }, deps, T(1))
  check('runDelete', 'delete only: counts, no labels read, doc same', J(plain.reply) === J({ ok: true, deleted: 2, blocked: 0 }) && plain.doc === d0 && J(calls) === J([['remove', 'place', 2]]), J(calls))
  calls.length = 0
  const blk = M.runDelete(d0, { kind: 'place', keys: ['a', 'missing'], block: true }, deps, T(2))
  check('runDelete', 'labels read before delete', J(calls) === J([['labels', 'place', 2], ['remove', 'place', 2]]), J(calls))
  check('runDelete', 'reply: deleted 1, blocked 2', J(blk.reply) === J({ ok: true, deleted: 1, blocked: 2 }), J(blk.reply))
  check('runDelete', 'label from deps, fallback to key', blk.doc.items.find((i) => i.key === 'a')?.label === 'Alpha text' && blk.doc.items.find((i) => i.key === 'missing')?.label === 'missing')
  const lab = M.runDelete(d0, { kind: 'place', keys: ['a', 'b', 'c'], block: true, labels: { a: 'req A', b: 'req B' } }, deps, T(3))
  const L = (k) => lab.doc.items.find((i) => i.key === k)?.label
  check('runDelete', 'label order: learned entry, then request, then key', L('a') === 'Alpha text' && L('b') === 'req B' && L('c') === 'c', J(lab.doc))
  const again = M.runDelete(blk.doc, { kind: 'place', keys: ['a', 'new1', 'new2'], block: true }, deps, T(4))
  check('runDelete', 'blocked counts only newly added keys', again.reply.blocked === 2 && again.doc.items.length === 4, J(again.reply))
  const same = M.runDelete(blk.doc, { kind: 'site', keys: ['a'], block: true }, deps, T(4))
  check('runDelete', 'same key, other kind counts as new', same.reply.blocked === 1)
  check('runDelete', 'blocked items carry kind + at', blk.doc.items.every((i) => i.kind === 'place' && i.at === T(2)))
})

safe('blockedDiag', () => {
  const d = M.addBlocked(M.emptyBlockedDoc(), [item('place', 'a', T(1)), item('place', 'b', T(1)), item('planet', 'p', T(1))])
  const g = M.blockedDiag(d)
  check('blockedDiag', 'counts per kind', J(g.counts) === J({ place: 2, site: 0, planet: 1 }), J(g.counts))
  check('blockedDiag', 'items listed', g.items.length === 3)
})

fs.rmSync(tmp, { recursive: true, force: true })
let failed = 0
for (const { name, what, ok, detail } of results) {
  if (!ok) failed++
  if (!ok || verbose) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${what}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
