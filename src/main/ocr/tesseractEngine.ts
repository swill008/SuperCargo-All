// contract reads go through the one shared OCR reader (src/other/main/ocrReader.ts, batch 15)

import type { OcrWord } from '@shared/types'
import type { OcrEngine, OcrRecognition } from './engine'
import {
  ReaderTimeoutError,
  readerAssetsReady,
  readerAvailable,
  readerRecognize
} from '../../other/main/ocrReader'

export class TesseractEngine implements OcrEngine {
  readonly id = 'tesseract'
  readonly label = 'Tesseract (tesseract.js)'

  async isAvailable(): Promise<boolean> {
    return readerAvailable()
  }

  async assetsReady(): Promise<boolean> {
    return readerAssetsReady()
  }

  async recognize(png: Buffer): Promise<OcrRecognition> {
    let data: Awaited<ReturnType<typeof readerRecognize>>
    try {
      data = await readerRecognize(png, 'contract')
    } catch (e) {
      if (e instanceof ReaderTimeoutError) throw new Error('OCR time limit reached')
      if (await readerAvailable()) throw e
      throw new Error('tesseract engine is unavailable') // as 1.0.1 when the reader can't load
    }
    const words: OcrWord[] = []
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const line of para.lines ?? [])
          for (const w of line.words ?? [])
            if (w.text.trim())
              words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
    return { text: data.text ?? '', confidence: data.confidence ?? 0, words }
  }

  async dispose(): Promise<void> {
    // no-op: the reader is shared with WHERE AM I; disposeReader() ends it at app quit
  }
}
