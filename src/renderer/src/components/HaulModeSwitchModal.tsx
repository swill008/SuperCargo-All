/** HAUL MODE AUTO LOGIC SWITCH — prompt UI. Does not replace haul CaptureModal. */
import React from 'react'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import { useHaulModeSwitch } from '../state/haulModeSwitch'
import { miniBtn, outlineBtn } from '../pages/JobsPartsStyles'

export default function HaulModeSwitchModal(): React.ReactElement | null {
  const pending = useHaulModeSwitch((s) => s.pending)
  const stayInOther = useHaulModeSwitch((s) => s.stayInOther)
  const switchToHaul = useHaulModeSwitch((s) => s.switchToHaul)
  if (pending.length === 0) return null

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div style={{ width: 520, maxWidth: '100%', background: C.black, border: '1px solid rgba(255,255,255,0.22)', fontFamily: F.body }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
          <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>HAULING CONTRACT</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 4 }}>Pack, grid, and route live in Haul mode (stock SuperCargo).</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontFamily: F.body, fontSize: 14, color: C.textBody, marginBottom: 12, lineHeight: 1.5 }}>
            {pending.length === 1
              ? 'A hauling mission was accepted while Other mode is on.'
              : `${pending.length} hauling missions were accepted while Other mode is on.`}
          </div>
          {pending.map((p) => (
            <div key={p.missionId} style={{ fontFamily: F.body, fontSize: 13, color: C.acc, marginBottom: 6 }}>{p.title}</div>
          ))}
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, margin: '14px 0 18px', lineHeight: 1.5 }}>
            Switch to Haul mode to track it on Manifest. Stay in Other mode to ignore it here (it will not be added to Jobs).
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn onClick={() => switchToHaul()} style={outlineBtn}>SWITCH TO HAUL MODE</Btn>
            <Btn onClick={() => stayInOther()} style={miniBtn}>STAY IN OTHER MODE</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
