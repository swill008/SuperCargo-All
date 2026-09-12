import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useNarrow } from '../state/useViewport'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import Typeahead from './Typeahead'
import { shipCapacity } from '@shared/shipModules'
import { hasGridMarkup } from '@shared/cargoGrids'
import { DISCORD_URL } from '@shared/legal'

function useOutsideClose<T extends HTMLElement>(): {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  ref: React.MutableRefObject<T | null>
} {
  const [open, setOpen] = useState(false)
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return { open, setOpen, ref }
}

const labelStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.dim
}

export default function TopBar(): React.ReactElement {
  const openCapture = useStore((s) => s.openCapture)
  const openCompact = useStore((s) => s.openCompact)
  const closeCompact = useStore((s) => s.closeCompact)
  const compactOpen = useStore((s) => s.compactOpen)
  const appVersion = useStore((s) => s.appVersion)
  const reviewCount = useStore((s) => s.scanQueue.length)
  const openScanReview = useStore((s) => s.openScanReview)
  const narrow = useNarrow(960)

  return (
    <div className="drag" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 54, padding: '0 18px 0 22px', borderBottom: `1px solid ${C.line}`, flex: 'none', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 'none' }}>
          <Logo />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: F.display, fontWeight: 600, fontSize: 17, letterSpacing: '0.14em', color: C.text, textShadow: GLOW, lineHeight: 1 }}>
              SUPER<span style={{ color: C.acc }}>CARGO</span>
            </div>
            {appVersion && !narrow && (
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.1em', color: C.faint, marginTop: 3 }}>v{appVersion}</div>
            )}
          </div>
        </div>
        {!narrow && <RunChip />}
        <ShipPicker narrow={narrow} />
      </div>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        {reviewCount > 0 && <ReviewPill count={reviewCount} onClick={() => openScanReview()} />}
        <ChromeButton onClick={() => openCapture()} icon={<ScanIcon />} label="SCAN CONTRACT" compact={narrow} />
        <ChromeButton onClick={() => (compactOpen ? closeCompact() : openCompact())} icon={<CompactIcon active={compactOpen} />} label="OVERLAY" compact={narrow} active={compactOpen} />
        <DiscordLink />
        <WindowControls />
      </div>
    </div>
  )
}
