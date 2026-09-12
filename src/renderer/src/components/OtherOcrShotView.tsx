/** Session OCR picture: thumbnail → fit → 2x zoom → dismiss. */
import React, { useState } from 'react'
import { C } from '../theme'

export function OtherOcrShotView({ src, thumbMaxHeight = 220 }: {
  src: string
  thumbMaxHeight?: number
}): React.ReactElement {
  const [level, setLevel] = useState(0)
  const bump = (): void => setLevel((n) => (n >= 2 ? 0 : n + 1))

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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: level >= 2 ? 'zoom-out' : 'zoom-in',
            padding: 16,
            overflow: 'auto'
          }}
        >
          <img
            src={src}
            alt="OCR capture zoom"
            style={{
              maxWidth: level === 1 ? '100%' : 'none',
              maxHeight: level === 1 ? '100%' : 'none',
              width: level === 2 ? '200%' : 'auto',
              objectFit: 'contain',
              border: `1px solid ${C.lineStrong}`
            }}
          />
        </div>
      )}
    </>
  )
}
