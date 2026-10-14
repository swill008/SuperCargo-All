import React from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import { releaseLabel, releasePageUrl } from '@shared/release'

// Small bars under the top bar: the "Updated — now R1 x" notice once after an update, the
// download running and "Update ready" after the Check for Updates window was closed with Later.
// The offer itself is the Check for Updates window (UpdateWindow), not a bar.
export default function UpdateBanner(): React.ReactElement | null {
  const update = useStore((s) => s.update)
  const windowOpen = useStore((s) => s.updateWindowOpen)
  const notice = useStore((s) => s.updatedNotice)
  const dismissNotice = useStore((s) => s.dismissUpdatedNotice)

  const bars: React.ReactElement[] = []

  if (notice) {
    bars.push(
      <Bar key="notice" tone="quiet">
        <Dot />
        <span data-testid="updated-notice" style={textStyle}>Updated — now {releaseLabel(notice.to)}</span>
        <a href={releasePageUrl(notice.to)} target="_blank" rel="noreferrer" style={linkStyle}>
          WHAT&apos;S NEW
        </a>
        <Btn onClick={dismissNotice} title="Close" aria-label="Close" style={quietBtn} hoverStyle={{ color: C.text }}>
          ✕
        </Btn>
      </Bar>
    )
  }

  if (update?.kind === 'ready' && !windowOpen) {
    bars.push(
      <Bar key="ready" tone="loud">
        <Dot />
        <span data-testid="update-ready-bar" style={textStyle}>Update ready ({releaseLabel(update.version)}) —</span>
        <Btn
          onClick={() => void window.supercargo.quitAndInstall()}
          style={{
            flex: 'none',
            border: `1px solid ${C.acc}`,
            background: C.accFillStrong,
            color: C.text,
            textShadow: GLOW,
            fontFamily: F.display,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.14em',
            padding: '7px 14px',
            cursor: 'pointer'
          }}
          hoverStyle={{ background: C.acc, color: C.black }}
        >
          INSTALL AND RESTART
        </Btn>
      </Bar>
    )
  }

  if (!bars.length) return null
  return <>{bars}</>
}

const linkStyle: React.CSSProperties = { flex: 'none', fontFamily: F.display, fontSize: 12, letterSpacing: '0.12em', color: C.acc }

const quietBtn: React.CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  color: C.dim,
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.12em',
  padding: '7px 8px',
  cursor: 'pointer'
}

const textStyle: React.CSSProperties = { flex: 1, fontFamily: F.body, fontSize: 14, color: C.text }

function Dot(): React.ReactElement {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.acc, boxShadow: GLOW, flex: 'none' }} />
}

function Bar({ tone, children }: { tone: 'loud' | 'quiet'; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: tone === 'loud' ? '10px 16px' : '7px 16px',
        background: tone === 'loud' ? C.accFillStrong : C.accFill,
        borderBottom: `1px solid ${tone === 'loud' ? C.acc : C.accBorder}`
      }}
    >
      {children}
    </div>
  )
}
