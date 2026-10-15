// WHERE AM I zone reader check: zones 1 and 2 share the app's own WHERE AM I tesseract.js worker (approved 2026-10-15).
// Bundles src/other/main/ocrPrep.ts (pure) and checks each zone's full parameter set, then source-checks
// src/other/main/whereAmI.ts: own worker for both zones, zone 1 = 2x upscale without prep, TesseractEngine only in the
// worker-failed fallback, full-set switch per zone (never psm only), busy handling unchanged.
// Usage: node test/replay/zonereader_checks.mjs [whereAmI.ts] [ocrPrep.ts]   (optional paths point at old copies)

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const wherePath = path.resolve(process.argv[2] ?? path.join(root, 'src/other/main/whereAmI.ts'))
const prepPath = path.resolve(process.argv[3] ?? path.join(root, 'src/other/main/ocrPrep.ts'))

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-zonereader-'))
const outfile = path.join(tmp, 'ocrPrep.mjs')
esbuild.buildSync({ entryPoints: [prepPath], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' })
const P = await import(pathToFileURL(outfile).href)
fs.rmSync(tmp, { recursive: true, force: true })

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

// ---- whereAmI.ts source ----
const src = fs.readFileSync(wherePath, 'utf8')
const fnBody = (name) => {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  const j = src.indexOf('\n}\n', i)
  return src.slice(i, j < 0 ? undefined : j)
}
const ocr = fnBody('ocrZone')
check('reader', 'ocrZone found', ocr.length > 0)
check('reader', 'own worker asked for every zone (no zone === 2 gate)', /const w = await whereWorker\(\)/.test(ocr) && !/zone === 2 \? await whereWorker\(\)/.test(ocr))
const wBlock = ocr.slice(ocr.indexOf('if (w) {'), ocr.indexOf('engine ??='))
check('reader', 'worker path: zone 1 uses toUpscaledPng(cropped, 2)', /toUpscaledPng\(cropped, 2\)/.test(wBlock))
check('reader', 'worker path: prepForOcr only under zone === 2', /if \(zone === 2\) \{[^}]*prepForOcr/.test(wBlock) && (wBlock.match(/prepForOcr/g) ?? []).length === 1)
check('reader', 'worker path: zone 1 has no prep', /\} else \{[\s\S]*?toUpscaledPng\(cropped, 2\)[\s\S]*?\}/.test(wBlock) && !/else \{[^}]*prepForOcr/.test(wBlock))
check('reader', 'worker path returns before the fallback', /return \(await w\.recognize\(png\)\)/.test(wBlock))
// TesseractEngine only in the fallback
check('fallback', 'exactly one new TesseractEngine() in whereAmI.ts', (src.match(/new TesseractEngine\(\)/g) ?? []).length === 1)
check('fallback', 'new TesseractEngine() comes after the worker block in ocrZone', ocr.indexOf('engine ??= new TesseractEngine()') > ocr.indexOf('if (w) {') && ocr.indexOf('if (w) {') >= 0)
check('fallback', 'fallback keeps 3x zone 2 / 2x zone 1', /toUpscaledPng\(cropped, zone === 2 \? 3 : 2\)/.test(ocr.slice(ocr.indexOf('engine ??=') - 300)))
check('fallback', 'worker load failure sets workerFailed', /workerFailed = true/.test(fnBody('whereWorker')))
// parameter switching
check('switch', 'no workerPsm left', !/workerPsm/.test(src))
check('switch', 'full set applied: setParameters(zoneParams(zone))', /setParameters\(zoneParams\(zone\)\)/.test(ocr))
check('switch', 'switch keyed on zone', /if \(workerZone !== zone\)/.test(ocr))
const sw = ocr.slice(ocr.indexOf('if (workerZone !== zone)'))
check('switch', 'key reset before the call, set after', /workerZone = 0[\s\S]*?setParameters\(zoneParams\(zone\)\)[\s\S]*?workerZone = zone/.test(sw))
check('switch', "switch time logged at debug ('where: ocr params switch')", /logger\.debug\('other', 'where: ocr params switch', \{ zone, ms:/.test(ocr))
check('switch', 'no psm-only setParameters anywhere', !/setParameters\(\{\s*tessedit_pageseg_mode:[^,}]*\}\)/.test(src))
// busy unchanged
const run = fnBody('runWhere')
check('busy', 'runWhere: busy returns error busy', /if \(busy\) \{[\s\S]*?error: 'busy'/.test(run))
check('busy', 'runWhere: busy = true then false in finally', /busy = true[\s\S]*finally \{[\s\S]*busy = false/.test(run))
check('busy', 'live tick skips while busy', /if \(busy \|\| hotkeysPaused\)/.test(fnBody('runLiveWhere')))

console.log(`zonereader_checks: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
