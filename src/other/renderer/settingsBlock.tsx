/**
 * Other-only Settings rows. Re-tie: render after haul OCR Capture delay.
 */
import React from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { resolveWorkMode } from '../workMode'

export default function OtherSettingsBlock({
  rowStyle,
  keyStyle,
  Toggle
}: {
  rowStyle: React.CSSProperties
  keyStyle: React.CSSProperties
  Toggle: (props: { on: boolean; onClick: () => void }) => React.ReactElement
}): React.ReactElement | null {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  if (resolveWorkMode(settings.workMode) !== 'other') return null
  return (
    <div style={rowStyle}>
      <span style={keyStyle}>
        Include aUEC
        <span style={{ display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>
          On a log job that already has steps, auto-capture writes Reward only when the amount is greater than 0.
        </span>
      </span>
      <Toggle
        on={!!settings.otherOcrIncludeAuec}
        onClick={() => void updateSettings({ otherOcrIncludeAuec: !settings.otherOcrIncludeAuec })}
      />
    </div>
  )
}
