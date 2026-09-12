/** Session OCR picture: thumbnail → 2x → 3x → dismiss. */
import React, { useState } from 'react'
import { C } from '../theme'

export function OtherOcrShotView({ src, thumbMaxHeight = 220 }: {
  src: string
  thumbMaxHeight?: number
}): React.ReactElement {
  const [level, setLevel] = useState(0)
  const bump = (): void => setLevel((n) => (n >= 2 ? 0 : n + 1))
  const zoom = level === 1 ? 2 : 3

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
          onClick={bump}
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
