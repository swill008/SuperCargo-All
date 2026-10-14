/**
 * Position accuracy 0-10 shown as a colour: red (0) -> amber (5) -> green (10), from the theme.
 * Number and word are always shown, so colour is never the only signal.
 */
import React from 'react'
import { C, F } from '@renderer/theme'
import { accuracyWord } from '@other/otherWhere'

type RGB = [number, number, number]

/** '#rgb', '#rrggbb' or 'rgb(a)(r,g,b...)' -> [r,g,b]; black when unreadable */
function toRgb(c: string): RGB {
  const s = c.trim()
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('')
    const n = parseInt(h.slice(0, 6), 16)
    if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return [0, 0, 0]
}

const mix = (a: RGB, b: RGB, t: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ')})`

const clampScore = (score: number): number => Math.max(0, Math.min(10, Number.isFinite(score) ? score : 0))

/** smooth gradient: red at 0, amber at 5, green at 10 */
export function accuracyColor(score: number): string {
  const s = clampScore(score)
  return s <= 5 ? mix(toRgb(C.red), toRgb(C.amber), s / 5) : mix(toRgb(C.amber), toRgb(C.green), (s - 5) / 5)
}

const GRADIENT = `linear-gradient(90deg, ${C.red} 0%, ${C.amber} 50%, ${C.green} 100%)`

/** safe word: accuracyWord may not exist in a half-built tree */
function word(score: number): string {
  try {
    return accuracyWord(score)
  } catch {
    return ''
  }
}

/** compact overlay tag: "ACC 10" in its colour + a thin 10-segment bar */
export function AccTag({ score }: { score: number }): React.ReactElement {
  const s = Math.round(clampScore(score))
  const col = accuracyColor(s)
  const w = word(s)
  return (
    <span
      title={`Position accuracy ${s}/10${w ? ` (${w})` : ''}`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, flex: 'none', verticalAlign: 'middle' }}
    >
      <span style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.08em', color: col, lineHeight: 1 }}>
        ACC {s}
      </span>
      <span style={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ width: 3, height: 2, background: i < s ? col : 'rgba(255,255,255,0.15)' }} />
        ))}
      </span>
    </span>
  )
}

/** Next tab: gradient track with a marker at the score + "accuracy 10/10 exact" */
export function AccSlider({ score, word: w }: { score: number; word?: string }): React.ReactElement {
  const s = Math.round(clampScore(score))
  const label = w ?? word(s)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Position accuracy: how sure the start position is">
      <div style={{ position: 'relative', width: 90, height: 4, borderRadius: 2, background: GRADIENT, flex: 'none' }}>
        <span
          style={{
            position: 'absolute', left: `${s * 10}%`, top: -3, width: 4, height: 10, marginLeft: -2,
            background: C.text, border: `1px solid ${C.black}`, borderRadius: 1, boxSizing: 'border-box'
          }}
        />
      </div>
      <span style={{ fontFamily: F.body, fontSize: 11, color: accuracyColor(s) }}>
        {`accuracy ${s}/10${label ? ` ${label}` : ''}`}
      </span>
    </div>
  )
}

/** the job the game tracks (r_DisplayInfo "Tracked mission") */
export function TrackedTag(): React.ReactElement {
  return (
    <span
      title="Tracked in game"
      style={{
        fontFamily: F.display, fontSize: 9, letterSpacing: '0.14em', color: C.green,
        border: `1px solid ${C.green}`, padding: '1px 5px', flex: 'none', lineHeight: 1.3
      }}
    >
      TRACKED
    </span>
  )
}
