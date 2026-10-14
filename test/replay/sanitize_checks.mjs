// OS-user sanitiser check: bundles src/main/sanitize.ts and calls makeSanitizer directly.
// The name is cleaned only in home paths and as a whole value, never inside words or JSON keys.
// Usage: node test/replay/sanitize_checks.mjs   (no build needed)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-sanitize-'))
const outfile = path.join(tmp, 'sanitize.mjs')
esbuild.buildSync({
  entryPoints: [path.join(root, 'src/main/sanitize.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  tsconfig: path.join(root, 'tsconfig.node.json')
})
const S = await import(pathToFileURL(outfile).href)

let fails = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`)
}

// common-word name: "root"
{
  const c = S.makeSanitizer(S.emptyIdentity(), 'root')
  eq('root: JSON key kept', S.sanitizeDeep({ root: true, zone: { root: 'x' } }, c), { root: true, zone: { root: 'x' } })
  eq('root: word in sentence kept', c('the root zone was rooted at Root level'), 'the root zone was rooted at Root level')
  eq('root: JSON text key kept', c('{"root": true}'), '{"root": true}')
  eq('root: Windows path', c('C:\\Users\\root\\AppData\\Roaming\\x'), 'C:\\Users\\%USERNAME%\\AppData\\Roaming\\x')
  eq('root: JSON-escaped Windows path', c('"C:\\\\Users\\\\root\\\\AppData"'), '"C:\\\\Users\\\\%USERNAME%\\\\AppData"')
  eq('root: Windows path case-insensitive', c('c:\\users\\ROOT\\AppData'), 'c:\\users\\%USERNAME%\\AppData')
  eq('root: path end of string', c('home is C:\\Users\\Root'), 'home is C:\\Users\\%USERNAME%')
  eq('root: /home path', c('/home/root/x'), '/home/%USERNAME%/x')
  eq('root: /Users path', c('/Users/root/y'), '/Users/%USERNAME%/y')
  eq('root: other path segment kept', c('/srv/root/x and /home/rootkit/y'), '/srv/root/x and /home/rootkit/y')
  eq('root: whole value', c('root'), '%USERNAME%')
  eq('root: whole value in object', S.sanitizeDeep({ user: 'Root' }, c), { user: '%USERNAME%' })
}

// distinctive name
{
  const c = S.makeSanitizer(S.emptyIdentity(), 'jdoe42')
  eq('jdoe42: Windows path', c('D:\\Users\\JDoe42\\Saved Games'), 'D:\\Users\\%USERNAME%\\Saved Games')
  eq('jdoe42: forward-slash Windows path', c('C:/Users/jdoe42/Documents'), 'C:/Users/%USERNAME%/Documents')
  eq('jdoe42: /home path', c('cwd=/home/jdoe42/sc'), 'cwd=/home/%USERNAME%/sc')
  eq('jdoe42: whole value', S.sanitizeDeep(['jdoe42', ' jdoe42 '], c), ['%USERNAME%', '%USERNAME%'])
  eq('jdoe42: key equal to name kept', S.sanitizeDeep({ jdoe42: 1 }, c), { jdoe42: 1 })
  // a distinctive name is also cleaned as a whole word in ordinary text (error messages, user=…); not inside other words
  eq('jdoe42: whole word in text', c('error: user=jdoe42 not allowed'), 'error: user=%USERNAME% not allowed')
  eq('jdoe42: not inside another word', c('jdoe421 xjdoe42'), 'jdoe421 xjdoe42')
  // a common-word name stays path-only even in text
  const r = S.makeSanitizer(S.emptyIdentity(), 'admin')
  eq('admin: word in text kept', r('ask your admin to allow it'), 'ask your admin to allow it')
}

// player-handle / id rules unchanged (made-up handle)
{
  const id = S.learnIdentity([
    '<x> Player[Zyxwvut_Test] PlayerId[123456789] joined',
    'something ownerId[987654321] here',
    'nickname="Zyxwvut_Test" playerGEID=123456789 remoteAddr=1.2.3.4:5'
  ])
  const c = S.makeSanitizer(id, 'jdoe42')
  eq('handle: Player/PlayerId', c('<x> Player[Zyxwvut_Test] PlayerId[123456789] joined'), '<x> Player[PLAYER] PlayerId[1] joined')
  eq('handle: other owner id', c('box ownerId[987654321] at 10.0.0.1:80'), 'box ownerId[OWNER-1] at 0.0.0.0')
  eq('handle: dropped fields + handle in text', c('a nickname="Zyxwvut_Test" playerGEID=123456789 b, hi zyxwvut_test'), 'a b, hi PLAYER')
  eq('handle: own id in text', c('geid 123456789 seen'), 'geid 1 seen')
  eq('handle: handle as key cleaned', S.sanitizeDeep({ Zyxwvut_Test: 'C:\\Users\\jdoe42\\x' }, c), { PLAYER: 'C:\\Users\\%USERNAME%\\x' })
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILED` : '\nall sanitize checks passed')
process.exit(fails ? 1 : 0)
