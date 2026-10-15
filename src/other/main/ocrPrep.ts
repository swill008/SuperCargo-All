/**
 * WHERE AM I OCR pre-processing (pure, no electron): BGRA bitmap in, BGRA bitmap out.
 * grey -> invert when the text is light on dark -> scale so text is ~TARGET_TEXT_PX high (-> optional Otsu).
 * The scale comes from the game frame height (r_DisplayInfo text grows with the resolution), not a fixed factor.
 */

/** r_DisplayInfo digit/cap height measured on a 2160 px high frame */
export const TEXT_PX_AT_2160 = 14
/** text height tesseract reads best */
export const TARGET_TEXT_PX = 30
/** output cap (pixels) so a big crop doesn't make OCR slow */
export const MAX_OUT_PX = 4_000_000
export const MAX_SCALE = 4

/**
 * Tesseract parameters for the WHERE AM I worker, which reads both zones (full set applied on every zone switch).
 * Zone 2 (r_DisplayInfo, prepForOcr input): psm 6 = one block, thresholding 2 = Sauvola.
 * Zone 1 (map bottom line, 2x upscale, no prep): the 1.0.1 shared-engine settings, psm 3 = auto, thresholding 0 = Otsu.
 */
export const OCR_PARAMS = { preserve_interword_spaces: '1', thresholding_method: '2' } as const
export const ZONE_PSM = { 1: '3', 2: '6' } as const
export const ZONE_PARAMS = {
  1: { tessedit_pageseg_mode: ZONE_PSM[1], preserve_interword_spaces: '1', thresholding_method: '0' },
  2: { tessedit_pageseg_mode: ZONE_PSM[2], ...OCR_PARAMS }
} as const

/** full tesseract parameter set for a zone (a fresh copy, safe to hand to setParameters) */
export function zoneParams(zone: 1 | 2): Record<string, string> {
  return { ...ZONE_PARAMS[zone] }
}

export interface Bitmap {
  /** BGRA, 4 bytes per pixel, rows packed */
  data: Uint8Array
  width: number
  height: number
}

export interface PrepResult extends Bitmap {
  scale: number
  inverted: boolean
  threshold: number
}

/** upscale factor for a crop of cropW x cropH taken from a frame frameH px high */
export function prepScale(cropW: number, cropH: number, frameH: number, targetPx = TARGET_TEXT_PX): number {
  const textPx = TEXT_PX_AT_2160 * (frameH > 0 ? frameH / 2160 : 1)
  let s = Math.min(MAX_SCALE, Math.max(1, targetPx / textPx))
  const px = cropW * cropH
  if (px > 0 && px * s * s > MAX_OUT_PX) s = Math.sqrt(MAX_OUT_PX / px)
  return s
}

function toGrey(b: Bitmap): Uint8Array {
  const n = b.width * b.height
  const g = new Uint8Array(n)
  const d = b.data
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (0.114 * d[j] + 0.587 * d[j + 1] + 0.299 * d[j + 2] + 0.5) | 0
  return g
}

/** bilinear resize of a grey plane */
function resize(g: Uint8Array, w: number, h: number, ow: number, oh: number): Uint8Array {
  if (ow === w && oh === h) return g
  const out = new Uint8Array(ow * oh)
  const sx = w / ow
  const sy = h / oh
  for (let y = 0; y < oh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = fy | 0
    const y1 = Math.min(h - 1, y0 + 1)
    const wy = fy - y0
    const r0 = y0 * w
    const r1 = y1 * w
    for (let x = 0; x < ow; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = fx | 0
      const x1 = Math.min(w - 1, x0 + 1)
      const wx = fx - x0
      const top = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * wx
      const bot = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * wx
      out[y * ow + x] = (top + (bot - top) * wy + 0.5) | 0
    }
  }
  return out
}

/** Otsu threshold of a grey plane */
export function otsu(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  const total = g.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      thr = t
    }
  }
  return thr
}

export interface PrepOptions {
  /**
   * 'none' (default) = grey; the worker binarises locally (Sauvola, OCR_PARAMS). 'otsu' = one global cut: the bench
   * (test/replay/ocr_bench.mjs) showed it wipes text over bright sky / glare, so it's kept only for comparison.
   */
  threshold?: 'otsu' | 'none'
  /** text height to aim for (px) */
  targetPx?: number
}

/** grey, invert (dark text on light), scale for ~TARGET_TEXT_PX text, optional Otsu black/white */
export function prepForOcr(b: Bitmap, frameH: number, o: PrepOptions = {}): PrepResult {
  let g = toGrey(b)
  // light text on a dark scene: mean is dark
  let mean = 0
  for (let i = 0; i < g.length; i++) mean += g[i]
  mean /= g.length || 1
  const inverted = mean < 128
  if (inverted) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]
  const scale = prepScale(b.width, b.height, frameH, o.targetPx)
  const ow = Math.max(1, Math.round(b.width * scale))
  const oh = Math.max(1, Math.round(b.height * scale))
  g = resize(g, b.width, b.height, ow, oh)
  const threshold = o.threshold === 'none' ? -1 : otsu(g)
  const data = new Uint8Array(ow * oh * 4)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const v = threshold < 0 ? g[i] : g[i] > threshold ? 255 : 0
    data[j] = data[j + 1] = data[j + 2] = v
    data[j + 3] = 255
  }
  return { data, width: ow, height: oh, scale, inverted, threshold }
}
