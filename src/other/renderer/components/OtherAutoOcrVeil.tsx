/**
 * Main-window veil while Other auto-OCR waits / runs.
 * Esc cancels the pending shot so results are not applied.
 */
import React, { useEffect } from 'react'
import { C, F, GLOW } from '@renderer/theme'
import { useOtherCapture } from '../state/otherCapture'

export default function OtherAutoOcrVeil(): React.ReactElement | null {
  const autoBusy = useOtherCapture((s) => s.autoBusy)
  const cancelAuto = useOtherCapture((s) => s.cancelAuto)

  useEffect(() => {
    if (!autoBusy) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelAuto()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [autoBusy, cancelAuto])

  if (!autoBusy) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
      }}
    >
      <div
        style={{
          border: `1px solid ${C.lineStrong}`,
          background: C.black,
          padding: '28px 36px',
          textAlign: 'center'
        }}
      >
        <div
          style={{
            fontFamily: F.display,
            fontSize: 18,
            letterSpacing: '0.16em',
            color: C.text,
            textShadow: GLOW
          }}
        >
          AUTO OCR IN PROGRESS
        </div>
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 10 }}>
          Esc to cancel
        </div>
      </div>
    </div>
  )
}
