/** Session OCR picture: thumbnail → 2x → 3x → dismiss. Edge-follow scroll while zoomed. */
import React, { useEffect, useRef, useState } from 'react'
import { C } from '@renderer/theme'

const EDGE = 0.2
const MAX_PX = 22

export function OtherOcrShotView({ src, thumbMaxHeight = 220 }: {
  src: string
  thumbMaxHeight?: number
}): React.ReactElement {
  const [level, setLevel] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const vel = useRef({ x: 0, y: 0 })
  const bump = (): void => setLevel((n) => (n >= 2 ? 0 : n + 1))
  const zoom = level === 1 ? 2 : 3

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    const y = (e.clientY - r.top) / Math.max(1, r.height)
    vel.current = {
      x: x < EDGE ? -((EDGE - x) / EDGE) : x > 1 - EDGE ? ((x - (1 - EDGE)) / EDGE) : 0,
      y: y < EDGE ? -((EDGE - y) / EDGE) : y > 1 - EDGE ? ((y - (1 - EDGE)) / EDGE) : 0
    }
  }

  useEffect(() => {
    if (level === 0) {
      vel.current = { x: 0, y: 0 }
      return
    }
    let id = 0
    const tick = (): void => {
      const box = boxRef.current
      if (box) {
        box.scrollLeft += vel.current.x * MAX_PX
        box.scrollTop += vel.current.y * MAX_PX
      }
      id = window.requestAnimationFrame(tick)
    }
    id = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(id)
  }, [level])

  return (
    <>
      <img
        src={src}
        alt="OCR capture"
        onClick={bump}
        style={{
          maxWidth: '100%',
          maxHeight: thumbMaxHeight,
          objectFit: 'contain',
          border: `1px solid ${C.lineStrong}`,
          cursor: 'zoom-in'
        }}
      />
      {level > 0 && (
        <div
          ref={boxRef}
          onClick={bump}
          onMouseMove={onMove}
          onMouseLeave={() => { vel.current = { x: 0, y: 0 } }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 80,
            cursor: level >= 2 ? 'zoom-out' : 'zoom-in',
            overflow: 'auto',
            padding: 16
          }}
        >
          <img
            src={src}
            alt="OCR capture zoom"
            style={{
              width: `${zoom * 100}%`,
              height: 'auto',
              display: 'block',
              margin: '0 auto',
              border: `1px solid ${C.lineStrong}`
            }}
          />
        </div>
      )}
    </>
  )
}
