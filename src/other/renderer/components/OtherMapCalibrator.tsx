/**
 * WHERE AM I zone setup: one map-screen capture, two boxes (zone 1 map line,
 * zone 2 r_DisplayInfo text). Box move/resize copied from upstream OcrCalibrator.
 * Engine: window.supercargo.otherWhereCalPreview / otherWhereCalTest.
 */
import React, { useRef, useState } from 'react'
import { C, F, GLOW } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import type { CropRect } from '@shared/types'
import type { WhereRunResult } from '@other/otherWhere'
import { otherSetting } from '../../workMode'

type Zone = 1 | 2
type Drag = { zone: Zone; mode: 'move' | 'resize'; mx: number; my: number; crop: CropRect } | null

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const pct = (n: number): string => `${Math.round(n * 100)}%`

const ZONES: Record<Zone, { key: 'otherWhereZone1' | 'otherWhereZone2'; label: string; color: string }> = {
  1: { key: 'otherWhereZone1', label: 'ZONE 1 · MAP LINE', color: C.acc },
  2: { key: 'otherWhereZone2', label: 'ZONE 2 · DISPLAY INFO', color: C.amber }
}

export default function OtherMapCalibrator(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const useZone2 = otherSetting(settings, 'otherWhereUseZone2')

  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [captureErr, setCaptureErr] = useState('')
  // live crop while dragging; saved on pointer-up
  const [live, setLive] = useState<{ zone: Zone; crop: CropRect } | null>(null)
  const [tests, setTests] = useState<Partial<Record<Zone, WhereRunResult | { error: string }>>>({})
  const [testing, setTesting] = useState<Zone | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag>(null)

  const cropOf = (z: Zone): CropRect =>
    live && live.zone === z ? live.crop : otherSetting(settings, ZONES[z].key)

  const capture = async (): Promise<void> => {
    setLoading(true)
    setCaptureErr('')
    try {
      const url = await window.supercargo.otherWhereCalPreview()
      if (url) setPreview(url)
      else setCaptureErr('Capture failed. Check the capture source in OCR CAPTURE settings.')
    } catch (e) {
      setCaptureErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const runTest = async (z: Zone): Promise<void> => {
    setTesting(z)
    try {
      const r = await window.supercargo.otherWhereCalTest(z)
      dlog.info('other', 'where zone test', { zone: z, ok: r.ok, error: r.error ?? null })
      setTests((t) => ({ ...t, [z]: r }))
    } catch (e) {
      setTests((t) => ({ ...t, [z]: { error: e instanceof Error ? e.message : String(e) } }))
    } finally {
      setTesting(null)
    }
  }

  const onPointerDown = (zone: Zone, mode: 'move' | 'resize') => (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { zone, mode, mx: e.clientX, my: e.clientY, crop: cropOf(zone) }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    const wrap = wrapRef.current
    if (!d || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dx = (e.clientX - d.mx) / rect.width
    const dy = (e.clientY - d.my) / rect.height
    const next: CropRect =
      d.mode === 'move'
        ? {
            ...d.crop,
            x: clamp01(Math.min(d.crop.x + dx, 1 - d.crop.w)),
            y: clamp01(Math.min(d.crop.y + dy, 1 - d.crop.h))
          }
        : {
            ...d.crop,
            w: clamp01(Math.max(0.02, Math.min(d.crop.w + dx, 1 - d.crop.x))),
            h: clamp01(Math.max(0.02, Math.min(d.crop.h + dy, 1 - d.crop.y)))
          }
    setLive({ zone: d.zone, crop: next })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    if (live && live.zone === d.zone) {
      const patch = { [ZONES[d.zone].key]: live.crop }
      dlog.info('other', 'where zone moved', patch as Record<string, unknown>)
      void updateSettings(patch)
    }
    setLive(null)
  }

  const zones: Zone[] = useZone2 ? [1, 2] : [1]

  return (
    <div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, lineHeight: 1.6, marginBottom: 12 }}>
        Open the map in game (with r_DisplayInfo 3 on for zone 2), then CAPTURE. Drag each box over its text.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <CalBtn onClick={() => void capture()}>{loading ? 'CAPTURING...' : preview ? 'RECAPTURE' : 'CAPTURE'}</CalBtn>
        <CalBtn onClick={() => void runTest(1)}>{testing === 1 ? 'READING...' : 'TEST ZONE 1'}</CalBtn>
        <CalBtn onClick={() => void runTest(2)} disabled={!useZone2}>
          {testing === 2 ? 'READING...' : 'TEST ZONE 2'}
        </CalBtn>
        {zones.map((z) => {
          const c = cropOf(z)
          return (
            <span key={z} style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>
              z{z} {pct(c.x)},{pct(c.y)} {pct(c.w)}×{pct(c.h)}
            </span>
          )
        })}
      </div>
      {captureErr && <div style={{ fontFamily: F.body, fontSize: 12, color: C.red, marginBottom: 10 }}>{captureErr}</div>}

      {!preview ? (
        <div
          style={{
            border: `1px dashed ${C.lineStrong}`,
            padding: '28px 16px',
            textAlign: 'center',
            fontFamily: F.body,
            fontSize: 12,
            color: C.dim
          }}
        >
          No capture yet.
        </div>
      ) : (
        <div
          ref={wrapRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ position: 'relative', width: '100%', userSelect: 'none', border: `1px solid ${C.line}`, lineHeight: 0, overflow: 'hidden' }}
        >
          <img src={preview} alt="map screen capture" style={{ width: '100%', display: 'block' }} draggable={false} />
          {zones.map((z) => {
            const c = cropOf(z)
            const { color, label } = ZONES[z]
            return (
              <div
                key={z}
                data-testid={`where-zone-${z}`}
                onPointerDown={onPointerDown(z, 'move')}
                style={{
                  position: 'absolute',
                  left: pct(c.x),
                  top: pct(c.y),
                  width: pct(c.w),
                  height: pct(c.h),
                  border: `1.5px solid ${color}`,
                  background: 'rgba(0,0,0,0.15)',
                  cursor: 'move',
                  boxSizing: 'border-box'
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -1,
                    // label above the box, or inside when the box touches the top edge
                    ...(c.y < 0.04 ? { top: '100%' } : { bottom: '100%' }),
                    background: color,
                    color: '#000',
                    fontFamily: F.display,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    lineHeight: 1.4,
                    padding: '1px 5px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none'
                  }}
                >
                  {label}
                </span>
                <div
                  onPointerDown={onPointerDown(z, 'resize')}
                  style={{
                    position: 'absolute',
                    right: -7,
                    bottom: -7,
                    width: 14,
                    height: 14,
                    background: color,
                    border: '1px solid #000',
                    cursor: 'nwse-resize',
                    boxShadow: GLOW
                  }}
                />
              </div>
            )
          })}
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 8, fontFamily: F.body, fontSize: 11, color: C.dim }}>
          Drag a box to move it, its corner to resize. Saved when you let go.
        </div>
      )}

      {([1, 2] as Zone[]).map((z) => {
        const t = tests[z]
        if (!t) return null
        const r = 'raw' in t ? t : null
        const raw = r ? (z === 1 ? r.raw.zone1 : r.raw.zone2) : undefined
        return (
          <div key={z} style={{ marginTop: 12, border: `1px solid ${C.lineStrong}`, padding: 12 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: ZONES[z].color }}>
                TEST {ZONES[z].label}
              </span>
              {r && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>{r.ms} ms</span>}
            </div>
            {r?.ok && r.where ? (
              <div style={{ fontFamily: F.body, fontSize: 13, color: C.text, marginBottom: 6 }}>
                {r.where.label} <span style={{ color: C.dim, fontSize: 11 }}>({r.where.source})</span>
              </div>
            ) : (
              <div style={{ fontFamily: F.body, fontSize: 12, color: C.red, marginBottom: 6 }}>
                {t.error || "couldn't read the map, try again"}
              </div>
            )}
            <pre
              style={{
                margin: 0,
                fontFamily: F.mono,
                fontSize: 11,
                color: C.body,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'rgba(0,0,0,0.35)',
                padding: 8
              }}
            >
              {raw && raw.trim() ? raw : '(no text read)'}
            </pre>
          </div>
        )
      })}
    </div>
  )
}

function CalBtn({
  onClick,
  disabled,
  children
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Btn
      onClick={() => {
        if (!disabled) onClick()
      }}
      style={{
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.14em',
        padding: '6px 12px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flex: 'none'
      }}
      hoverStyle={disabled ? {} : { border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {children}
    </Btn>
  )
}
