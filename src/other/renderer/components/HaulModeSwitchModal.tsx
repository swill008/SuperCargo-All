/** Big-haul prompt: offer Haul mode for a large hauling job (see state/haulModeSwitch). */
import React from 'react'
import { C, F, GLOW } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { useHaulModeSwitch } from '../state/haulModeSwitch'
import { miniBtn, outlineBtn } from '../pages/JobsPartsStyles'

export default function HaulModeSwitchModal(): React.ReactElement | null {
  const pending = useHaulModeSwitch((s) => s.pending)
  const stayInOther = useHaulModeSwitch((s) => s.stayInOther)
  const switchToHaul = useHaulModeSwitch((s) => s.switchToHaul)
  if (pending.length === 0) return null
  const total = pending.reduce((sum, p) => sum + p.scu, 0)

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 60 }}>
      <div style={{ width: 520, maxWidth: '100%', background: C.black, border: '1px solid rgba(255,255,255,0.22)', fontFamily: F.body }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
          <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>BIG HAUL</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 4 }}>Manifest, pack and load plan live in Haul mode.</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontFamily: F.body, fontSize: 14, color: C.textBody, marginBottom: 12, lineHeight: 1.5 }}>
            Big haul ({total} SCU): switch to Haul mode for the manifest and load plan?
          </div>
          {pending.map((p) => (
            <div key={p.missionId} style={{ fontFamily: F.body, fontSize: 13, color: C.acc, marginBottom: 6 }}>{p.title} {'\u00b7'} {p.scu} SCU</div>
          ))}
          <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, margin: '14px 0 18px', lineHeight: 1.5 }}>
            Stay keeps it as a job here. Switching does not delete Other jobs.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn onClick={() => switchToHaul()} style={outlineBtn}>SWITCH</Btn>
            <Btn onClick={() => stayInOther()} style={miniBtn}>STAY</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
