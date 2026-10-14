// WHERE AM I OCR bench: old pipeline (3x Lanczos upscale, psm 3 = the shared engine) vs new (ocrPrep.ts grey/invert/
// scale-by-resolution, own worker psm 6 + Sauvola; --threshold otsu tries the global Otsu cut) on real r_DisplayInfo
// panel crops, then parseDisplayInfo on both.
// Scores each field against parseDisplayInfo of a hand transcription of the same crop.
// Usage: node test/replay/ocr_bench.mjs --images <dir with 18.webp ...> --tessdata <dir with eng.traineddata(.gz)>
//        [--out <dir>] [--frame-h 2160] [crop names ...]
// Needs python3 + Pillow to decode the crops (webp/png). Not part of the unit suite (needs tessdata + real crops).

import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')

const argv = process.argv.slice(2)
const opt = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : d
}
const imagesDir = opt('--images')
const tessdata = opt('--tessdata')
const frameH = Number(opt('--frame-h', '2160'))
const outDir = opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ocr-bench-')))
const newPsm = opt('--psm')
const thrOpt = opt('--threshold', 'none')
const targetPx = Number(opt('--target', '30'))
const tmethod = opt('--tmethod')
const named = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
if (!imagesDir || !tessdata) {
  console.error('usage: node test/replay/ocr_bench.mjs --images <dir> --tessdata <dir> [--out <dir>] [crop ...]')
  process.exit(2)
}
fs.mkdirSync(outDir, { recursive: true })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ocr-bench-js-'))
const build = (entry, name) => {
  const outfile = path.join(tmp, name)
  esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    tsconfig: path.join(root, 'tsconfig.node.json'),
    alias: { '@shared': path.join(root, 'src/shared'), '@other': path.join(root, 'src/other') }
  })
  return import(pathToFileURL(outfile).href)
}
const W = await build('src/other/otherWhere.ts', 'otherWhere.mjs')
const P = await build('src/other/main/ocrPrep.ts', 'ocrPrep.mjs')

// hand transcriptions of the crops (only the lines parseDisplayInfo uses)
const TRUTH = {
  '18.webp': `Zone: OOC_Stanton_1_Hurston Pos: 743.1241km 15.3532km 671.0835km
Zone: SolarSystem_862321811808 Pos: 12850869.1299km -618.6232km 671.0835km
Zone: Root Pos: 12850869.1299km -618.6232km 671.0835km
ServerTime: Wed Oct 14 17:02:05 2026
UniverseTime: Mon Sep 20 06:12:35 2990
Current player location : Stanton1_DistributionCentre_Covalex_S1DC06  (LZ : Stanton1_DistributionCentre_Covalex_S1DC06)
Planet:OOC_Stanton_1_Hurston (working) (Load Complete)
Radius: 1000000.000000 ElevationUnderCam: 1383.937500 Altitude 26.150813
XYPos: 20660.303411 903057.099094 Page: 0 (+X)`,
  '9.webp': `Zone: MISC_Hull_B_881455961181 Pos: -0.94m 26.40m 0.52m
Zone: OOC_Stanton_1_Hurston Pos: -663.0188km -725.4411km -190.4883km
Zone: SolarSystem_862399811847 Pos: 12850255.8664km 961.9598km -190.4883km
Zone: Root Pos: 12850255.8664km 961.9598km -190.4883km
ServerTime: Wed Oct 14 14:05:05 2026
UniverseTime: Sun Sep 19 12:30:33 2990
Current player location : Stanton1
Planet:OOC_Stanton_1_Hurston (working) (Load Complete)
CamPos Planet Zone: -663018.807425 -725441.096333 -190488.315800
Radius: 1000000.000000 ElevationUnderCam: 1064.250000 Altitude 7.436596
XYPos: -913952.603423 -262582.740992 Page: 3 (-Y)`,
  '11.webp': `Zone: MISC_Hull_B_881455961181 Pos: -0.94m 26.40m 0.52m
Zone: SolarSystem_862399811847 Pos: 12472406.2780km 231654.0188km -233.7737km
Zone: Root Pos: 12472406.2780km 231654.0188km -233.7737km
ServerTime: Wed Oct 14 14:23:22 2026
UniverseTime: Sun Sep 19 14:20:16 2990
Current player location : StantonSolarSystem
Planet:OOC_Stanton_1_Hurston  (Load Complete)
CamPos Planet Zone: -284885066.755108 -339744759.870347 -233773.703463
Radius: 1000000.000000 ElevationUnderCam: 1348.062500 Altitude 442378915.108479
XYPos: -838526.776433 -688.086298 Page: 3 (-Y)`
}
const FIELDS = ['planetZone', 'body', 'planetPos', 'radiusM', 'altitudeM', 'solarPos', 'elevationM', 'xyPos', 'playerLocation']

const sameNum = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
const zoneKey = (s) => String(s).toUpperCase().replace(/0/g, 'O').replace(/[_\s]+/g, '_')
function same(a, b) {
  if (a === undefined || b === undefined || a === null || b === null) return a === b
  if (typeof b === 'number') return sameNum(a, b)
  // zone names: OCR reads OOC as 00C and _ as space; the parser treats them the same
  if (typeof b === 'string' && /_/.test(b)) return zoneKey(a) === zoneKey(b)
  if (typeof b === 'object') return Object.keys(b).every((k) => sameNum(a[k], b[k]))
  return a === b
}

// decode with Pillow: raw RGBA + the old pipeline's 3x Lanczos PNG (electron resize 'best' stand-in) + the 1x PNG
function decode(file) {
  const base = path.join(outDir, path.basename(file).replace(/\.[^.]+$/, ''))
  const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
open(sys.argv[2] + '.rgba', 'wb').write(im.tobytes())
im.resize((im.width * 3, im.height * 3), Image.LANCZOS).save(sys.argv[2] + '-old3x.png')
print(im.width, im.height)
`
  const r = spawnSync('python3', ['-I', '-c', py, file, base], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`)
  const [width, height] = r.stdout.trim().split(' ').map(Number)
  const rgba = fs.readFileSync(base + '.rgba')
  const bgra = new Uint8Array(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    bgra[i] = rgba[i + 2]
    bgra[i + 1] = rgba[i + 1]
    bgra[i + 2] = rgba[i]
    bgra[i + 3] = rgba[i + 3]
  }
  return { base, width, height, bgra, oldPng: fs.readFileSync(base + '-old3x.png') }
}

// minimal 8-bit grey PNG (bench only; the app uses nativeImage)
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function greyPng(b) {
  const raw = Buffer.alloc((b.width + 1) * b.height)
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) raw[y * (b.width + 1) + 1 + x] = b.data[(y * b.width + x) * 4]
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(b.width, 0)
  ihdr.writeUInt32BE(b.height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const { createWorker } = require('tesseract.js')
const mk = async (psm, extra = {}) => {
  const w = await createWorker('eng', 1, { langPath: tessdata, cachePath: tessdata, gzip: fs.existsSync(path.join(tessdata, 'eng.traineddata.gz')) })
  await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: String(psm), ...extra })
  return w
}
const oldW = await mk(3)
// new = the app's own WHERE AM I worker settings (ocrPrep.ts OCR_PARAMS + zone 2 psm); flags override for experiments
const newW = await mk(newPsm ?? P.ZONE_PSM[2], { ...P.OCR_PARAMS, ...(tmethod ? { thresholding_method: tmethod } : {}) })

function score(text, truth) {
  const got = W.parseDisplayInfo(text) ?? {}
  const want = W.parseDisplayInfo(truth)
  const res = {}
  for (const f of FIELDS) if (want[f] !== undefined) res[f] = same(got[f], want[f])
  return res
}

const crops = (named.length ? named : Object.keys(TRUTH)).filter((n) => fs.existsSync(path.join(imagesDir, n)))
const totals = { old: { ms: 0, ok: 0, n: 0 }, new: { ms: 0, ok: 0, n: 0 } }
for (const name of crops) {
  const img = decode(path.join(imagesDir, name))
  const t0 = Date.now()
  const oldText = (await oldW.recognize(img.oldPng)).data.text
  const oldMs = Date.now() - t0
  const t1 = Date.now()
  const prep = P.prepForOcr({ data: img.bgra, width: img.width, height: img.height }, frameH, { threshold: thrOpt, targetPx })
  const prepMs = Date.now() - t1
  const png = greyPng(prep)
  fs.writeFileSync(img.base + '-new.png', png)
  const t2 = Date.now()
  const newText = (await newW.recognize(png)).data.text
  const newMs = Date.now() - t2 + prepMs
  fs.writeFileSync(img.base + '-old.txt', oldText)
  fs.writeFileSync(img.base + '-new.txt', newText)
  const truth = TRUTH[name]
  const so = truth ? score(oldText, truth) : {}
  const sn = truth ? score(newText, truth) : {}
  const cnt = (s) => Object.values(s).filter(Boolean).length
  const n = Object.keys(sn).length
  totals.old.ms += oldMs
  totals.new.ms += newMs
  totals.old.ok += cnt(so)
  totals.new.ok += cnt(sn)
  totals.old.n += n
  totals.new.n += n
  console.log(`\n${name} ${img.width}x${img.height}  new: scale ${prep.scale.toFixed(2)} -> ${prep.width}x${prep.height}, inverted ${prep.inverted}, otsu ${prep.threshold}, prep ${prepMs} ms`)
  console.log(`  old (3x, psm 3): ${oldMs} ms, fields ${cnt(so)}/${n}`)
  console.log(`  new (prep, psm ${newPsm ?? P.ZONE_PSM[2]}, threshold ${thrOpt}, target ${targetPx}, tmethod ${tmethod ?? P.OCR_PARAMS.thresholding_method}): ${newMs} ms, fields ${cnt(sn)}/${n}`)
  for (const f of Object.keys(sn)) console.log(`    ${f.padEnd(15)} old ${so[f] ? 'ok ' : 'BAD'}  new ${sn[f] ? 'ok ' : 'BAD'}`)
}
await oldW.terminate()
await newW.terminate()
console.log(`\nTOTAL old: ${totals.old.ms} ms, ${totals.old.ok}/${totals.old.n} fields | new: ${totals.new.ms} ms, ${totals.new.ok}/${totals.new.n} fields`)
console.log(`texts + images under ${outDir}`)
process.exit(totals.new.ok >= totals.old.ok ? 0 : 1)
