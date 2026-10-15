// WHERE AM I zone reader check (batch 15, docs/contracts/batch-15-one-reader.md): zones 1 and 2 go through the app's
// one shared Tesseract reader (src/other/main/ocrReader.ts readerRecognize 'zone1'/'zone2'); no own worker, no fallback.
// Bundles src/other/main/ocrPrep.ts (pure) and checks each zone's full parameter set; bundles
// src/other/main/whereRerun.ts (pure) and checks the trashed-run rules (answer 6: manual run re-runs after the contract
// read, at most 5 re-runs then fails; live run dropped silently); then source-checks src/other/main/whereAmI.ts and
// src/other/main/register.ts.
// Usage: node test/replay/zonereader_checks.mjs [whereAmI.ts] [ocrPrep.ts] [whereRerun.ts] [register.ts]
//   (optional paths point at old copies)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const arg = (i, rel) => path.resolve(process.argv[i] ?? path.join(root, rel))
const wherePath = arg(2, 'src/other/main/whereAmI.ts')
const prepPath = arg(3, 'src/other/main/ocrPrep.ts')
const rerunPath = arg(4, 'src/other/main/whereRerun.ts')
const registerPath = arg(5, 'src/other/main/register.ts')

let pass = 0
let fail = 0
function check(group, name, cond) {
  if (cond) pass++
  else {
    fail++
    console.log(`  FAIL [${group}] ${name}`)
  }
}

// ---- ocrPrep.ts: per-zone parameter sets ----
async function bundle(entry) {
  if (!fs.existsSync(entry)) return {}
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-zonereader-'))
  const outfile = path.join(tmp, 'm.mjs')
  try {
    esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' })
    return await import(pathToFileURL(outfile).href)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
const P = await bundle(prepPath)

const want = {
  1: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', thresholding_method: '0' },
  2: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', thresholding_method: '2' }
}
const same = (a, b) => !!a && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
check('params', 'zoneParams exported', typeof P.zoneParams === 'function')
for (const z of [1, 2]) {
  const got = typeof P.zoneParams === 'function' ? P.zoneParams(z) : undefined
  check('params', `zone ${z} = ${JSON.stringify(want[z])} (got ${JSON.stringify(got)})`, same(got, want[z]))
  check('params', `ZONE_PARAMS[${z}] matches`, same(P.ZONE_PARAMS?.[z], want[z]))
}
if (typeof P.zoneParams === 'function') {
  const a = P.zoneParams(1)
  a.tessedit_pageseg_mode = 'x'
  check('params', 'zoneParams returns a copy', P.zoneParams(1).tessedit_pageseg_mode === '3')
}
// exports test/replay/ocr_bench.mjs uses
check('bench', 'OCR_PARAMS kept (zone 2 spaces + Sauvola)', P.OCR_PARAMS?.preserve_interword_spaces === '1' && P.OCR_PARAMS?.thresholding_method === '2')
check('bench', "ZONE_PSM[2] = '6'", P.ZONE_PSM?.[2] === '6')

// ---- whereRerun.ts: trashed run rules (answer 6) ----
const R = await bundle(rerunPath)
check('rerun', 'runWithReruns + TRASHED exported', typeof R.runWithReruns === 'function' && typeof R.TRASHED === 'symbol')
check('rerun', 'WHERE_MAX_RERUNS = 5', R.WHERE_MAX_RERUNS === 5)
if (typeof R.runWithReruns === 'function') {
  // manual run trashed twice, contract still pending for 3 polls before the first re-run
  {
    const seq = [R.TRASHED, R.TRASHED, 'read']
    let attempts = 0
    let pending = 3
    const log = []
    const out = await R.runWithReruns({
      attempt: async () => {
        log.push(`attempt pending=${pending}`)
        return seq[attempts++]
      },
      live: false,
      contractPending: () => pending > 0,
      sleep: async (ms) => {
        log.push(`sleep ${ms}`)
        pending--
      }
    })
    check('rerun', `manual: trashed run re-runs, then done (got ${JSON.stringify(out)})`, out.kind === 'done' && out.value === 'read' && out.reruns === 2 && attempts === 3)
    check('rerun', `manual: re-run only once no contract is pending (${log.join(', ')})`, log[1] === 'sleep 100' && log.indexOf('attempt pending=0') === 4 && !log.slice(1).some((l) => /attempt pending=[1-9]/.test(l)))
  }
  // manual run trashed every time: 1 run + 5 re-runs, then failed
  {
    let attempts = 0
    const out = await R.runWithReruns({ attempt: async () => (attempts++, R.TRASHED), live: false, contractPending: () => false, sleep: async () => {} })
    check('rerun', `manual: at most 5 re-runs, 6th trash fails (got ${JSON.stringify(out)}, attempts ${attempts})`, out.kind === 'failed' && out.reruns === 5 && attempts === 6)
  }
  // trashed 5 times, ok on the 5th re-run: still done
  {
    let attempts = 0
    const out = await R.runWithReruns({ attempt: async () => (attempts++ < 5 ? R.TRASHED : 'ok'), live: false, contractPending: () => false, sleep: async () => {} })
    check('rerun', `manual: ok on re-run 5 is kept (got ${JSON.stringify(out)})`, out.kind === 'done' && out.reruns === 5)
  }
  // live run trashed: dropped, no re-run, no wait
  {
    let attempts = 0
    let slept = 0
    const out = await R.runWithReruns({ attempt: async () => (attempts++, R.TRASHED), live: true, contractPending: () => true, sleep: async () => void slept++ })
    check('rerun', `live: trashed run dropped, not re-run (got ${JSON.stringify(out)})`, out.kind === 'dropped' && attempts === 1 && slept === 0)
  }
  // not trashed: one attempt, no wait
  {
    let attempts = 0
    const out = await R.runWithReruns({ attempt: async () => (attempts++, 'x'), live: false, contractPending: () => true, sleep: async () => {} })
    check('rerun', 'untrashed run: one attempt, never waits', out.kind === 'done' && out.reruns === 0 && attempts === 1)
  }
}

// ---- whereAmI.ts source ----
const src = fs.readFileSync(wherePath, 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const fnBody = (name) => {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  const j = src.indexOf('\n}\n', i)
  return src.slice(i, j < 0 ? undefined : j)
}
// shared reader only
check('reader', 'no TesseractEngine in whereAmI.ts', !/TesseractEngine/.test(code))
check('reader', 'no tesseract.js / createWorker in whereAmI.ts', !/tesseract\.js|createWorker/.test(code))
check('reader', 'no own worker left (whereWorker / workerZone / setParameters)', !/whereWorker|workerZone|setParameters/.test(code))
check('reader', "imports readerRecognize from './ocrReader'", /import \{[^}]*\breaderRecognize\b[^}]*\} from '\.\/ocrReader'/.test(src))
const ocr = fnBody('ocrZone')
const zp = fnBody('zonePng')
check('reader', 'ocrZone found', ocr.length > 0)
check('reader', "ocrZone: readerRecognize(..., zone === 1 ? 'zone1' : 'zone2')", /readerRecognize\([^;]*zone === 1 \? 'zone1' : 'zone2'\)/.test(ocr))
check('reader', 'readerRecognize called once in whereAmI.ts', (code.match(/readerRecognize\(/g) ?? []).length === 1)
const inputs = zp || ocr
check('inputs', 'zone 2: prepForOcr under zone === 2 only', /if \(zone === 2\) \{[^}]*prepForOcr/.test(inputs) && (code.match(/prepForOcr\(/g) ?? []).length === 1)
check('inputs', 'zone 2: prepped picture kept for diagnostics', /lastCrops\.zone2Prepped = /.test(inputs))
check('inputs', 'zone 1: toUpscaledPng(cropped, 2), no other upscale', /toUpscaledPng\(cropped, 2\)/.test(inputs) && (code.match(/toUpscaledPng\(/g) ?? []).length === 1)
check('inputs', 'diagnostics crops + boxes kept', /lastCrops\.zone1 = cropped\.toPNG\(\)/.test(ocr) && /zoneBox\(img, crop, cropped\)/.test(ocr))
// trash / timeout handling
const dr = fnBody('doRun')
check('trash', 'doRun rethrows ReaderTrashedError from a zone read', /if \(e instanceof ReaderTrashedError\) throw e/.test(dr))
check('trash', 'other recognize errors (timeout included) fail that zone: continue', /'where: recognize failed'[\s\S]{0,80}continue/.test(dr) && !/ReaderTimeoutError/.test(code))
const run = fnBody('runWhere')
check('trash', 'runWhere uses runWithReruns with live = why live and contractPending', /runWithReruns/.test(run) && /live: why === 'live'/.test(run) && /\bcontractPending\b/.test(run))
check('trash', 'trashed attempt returns TRASHED', /instanceof ReaderTrashedError\) return TRASHED/.test(run))
const dropI = run.indexOf("out.kind === 'dropped'")
const dropBlock = dropI < 0 ? '' : run.slice(dropI, run.indexOf('\n    }', dropI))
check('trash', 'dropped live run returns before record/broadcast, error WHERE_TRASHED', dropI >= 0 && /return \{ ok: false, raw: \{\}, error: WHERE_TRASHED/.test(dropBlock) && dropI < run.indexOf('record(') && dropI < run.indexOf('broadcast(r)'))
check('trash', "failed after re-runs = WHERE_FAIL_MESSAGE", /out\.kind === 'failed'[\s\S]{0,200}error: WHERE_FAIL_MESSAGE/.test(run))
// busy unchanged
check('busy', 'runWhere: busy returns error busy', /if \(busy\) \{[\s\S]*?error: 'busy'/.test(run))
check('busy', 'runWhere: busy = true then false in finally (covers re-runs)', /busy = true[\s\S]*runWithReruns[\s\S]*finally \{[\s\S]*busy = false/.test(run))
const lw = fnBody('runLiveWhere')
check('live', 'live tick skips while busy, paused or the reader is busy', /if \(busy \|\| hotkeysPaused \|\| readerBusy\(\)\) \{\s*live\.skipped\+\+/.test(lw))
check('live', 'trashed live run counted skipped (failsInRow untouched)', /r\.error === WHERE_TRASHED\) \{\s*live\.skipped\+\+\s*return null/.test(lw))
// seam never touches the reader: ocrZone only on the non-seam branch
check('seam', 'seam text used instead of ocrZone', /if \(seam\) text = [\s\S]*?else \{[\s\S]*?ocrZone\(/.test(dr))

// ---- register.ts source ----
const reg = fs.readFileSync(registerPath, 'utf8')
check('register', 'setReaderTimeLimit(() => getSettings().ocrTimeLimitSec)', /setReaderTimeLimit\(\(\) => getSettings\(\)\.ocrTimeLimitSec\)/.test(reg))
const wq = reg.slice(reg.indexOf("app.on('will-quit'"), reg.indexOf('})', reg.indexOf("app.on('will-quit'")))
check('register', 'will-quit: void disposeReader()', reg.includes("app.on('will-quit'") && /void disposeReader\(\)/.test(wq))

console.log(`zonereader_checks: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
