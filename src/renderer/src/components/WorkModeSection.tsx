/** Settings control for the fork Work mode switch. */
import React from 'react'
import { C, F } from '../theme'
import { Btn } from './ui'
import { useStore } from '../state/store'
import { WORK_MODE_LABELS, resolveWorkMode, type WorkMode } from '@shared/workMode'

export default function WorkModeSection(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  return (
    <div style={{ padding: '12px 0 8px', borderBottom: `1px solid ${C.lineSoft}` }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.acc, paddingBottom: 9, borderBottom: `1px solid ${C.lineStrong}`, margin: '0 0 12px' }}>
        WORK MODE
      </div>
      {(['haul', 'other'] as WorkMode[]).map((mode) => {
        const on = resolveWorkMode(settings.workMode) === mode
        const copy = WORK_MODE_LABELS[mode]
        return (
          <Btn
            key={mode}
            onClick={() => void updateSettings({ workMode: mode })}
            style={{
              display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, padding: '12px 14px',
              border: `1px solid ${on ? C.accBorder : C.lineStrong}`, background: on ? C.accFill : 'transparent',
              color: on ? C.text : C.body, cursor: 'pointer', fontFamily: F.body, fontSize: 14
            }}
          >
            <span style={{ fontFamily: F.display, letterSpacing: '0.08em', color: on ? C.acc : C.dim }}>
              {on ? '●' : '○'} {copy.title}
            </span>
            <span style={{ color: C.dim }}> — {copy.blurb}</span>
          </Btn>
        )
      })}
      <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 4 }}>
        Only one mode is active. Switching does not delete the other mode's saved jobs.
      </div>
    </div>
  )
}
