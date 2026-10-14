/** Start-up notice: last game session ended without a clean quit; jobs were kept (Job rule 6). */
import React from 'react'
import { C, F, GLOW } from '@renderer/theme'
import { Btn } from '@renderer/components/ui'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import { useOtherJobs } from '../state/otherJobs'
import { miniBtn, outlineBtn } from '../pages/JobsPartsStyles'

type CrashSlice = { crashNotice?: { kept: number } | null; dismissCrashNotice?: () => void }

export default function CrashNotice(): React.ReactElement | null {
  // store fields land with the store agent; read loosely until then
  const notice = useOtherJobs((s) => (s as unknown as CrashSlice).crashNotice ?? null)
  if (!notice) return null
  const kept = notice.kept

  const dismiss = (): void => {
    ;(useOtherJobs.getState() as unknown as CrashSlice).dismissCrashNotice?.()
  }

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', justifyContent: 'center', padding: 16, zIndex: 55, pointerEvents: 'none' }}>
      <div style={{ width: 520, maxWidth: '100%', background: C.black, border: `1px solid ${C.accBorder}`, fontFamily: F.body, pointerEvents: 'auto', padding: '14px 18px' }}>
        <div style={{ fontFamily: F.display, fontSize: 14, letterSpacing: '0.08em', color: C.text, textShadow: GLOW, marginBottom: 6 }}>GAME CRASHED?</div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: C.textBody, lineHeight: 1.5, marginBottom: 12 }}>
          The game didn&apos;t quit cleanly last session. {kept} job{kept === 1 ? '' : 's'} kept.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn
            onClick={() => {
              dlog.info('other', 'crash notice: review', { kept })
              useStore.getState().setView('jobs' as 'manifest')
              dismiss()
            }}
            style={outlineBtn}
          >REVIEW</Btn>
          <Btn
            onClick={() => {
              dlog.info('other', 'crash notice: ok', { kept })
              dismiss()
            }}
            style={miniBtn}
          >OK</Btn>
        </div>
      </div>
    </div>
  )
}
