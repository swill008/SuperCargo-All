/**
 * Other-only Settings rows. Re-tie: render after haul OCR Capture delay.
 */
import React from 'react'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import type { AppSettings } from '@shared/types'
import { OTHER_SETTING_DEFAULTS, otherSetting, resolveWorkMode } from '../workMode'

type BoolKey = {
  [K in keyof typeof OTHER_SETTING_DEFAULTS]: (typeof OTHER_SETTING_DEFAULTS)[K] extends boolean ? K : never
}[keyof typeof OTHER_SETTING_DEFAULTS]

const hintStyle: React.CSSProperties = { display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }

const sectionStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.acc,
  paddingBottom: 9,
  borderBottom: `1px solid ${C.lineStrong}`,
  margin: '30px 0 6px'
}

const numStyle: React.CSSProperties = {
  width: 90,
  background: 'rgba(0,0,0,0.4)',
  border: `1px solid ${C.lineStrong}`,
  color: C.text,
  fontFamily: F.mono,
  fontSize: 13,
  padding: '6px 8px'
}

const TOGGLES: { key: BoolKey; label: string; hint: string }[] = [
  { key: 'otherAutoTickObjectives', label: 'Auto-tick objectives', hint: 'Tick a step when the log says Objective Complete.' },
  { key: 'otherCrashNotice', label: 'Crash notice', hint: 'On start-up, say when the game did not quit cleanly and jobs were kept.' },
  { key: 'otherContractLimitToast', label: 'Contract-limit toast', hint: 'Show a toast when the game refuses a contract because you are at the limit.' },
  { key: 'otherShowRep', label: 'Show reputation', hint: 'Show the reputation from the contract title on each job.' },
  { key: 'otherSharedBadge', label: 'Shared badge', hint: 'Mark contracts a party member shared with you.' },
  { key: 'otherSessionSummary', label: 'Session summary', hint: 'Group History by game session with a per-session summary.' },
  { key: 'otherMarkerDistance', label: 'Distance from mission markers', hint: 'For a step with no named place, use its mission marker from the game log for the distance.' }
]

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

  const set = (patch: Partial<AppSettings>): void => {
    dlog.info('other', 'setting changed by user', patch as Record<string, unknown>)
    void updateSettings(patch)
  }
  const numSet = (key: 'otherHideShortLoopsSec' | 'otherHaulSwitchMinScu', raw: string): void => {
    const n = Math.max(0, Math.floor(Number(raw) || 0))
    set({ [key]: n })
  }
  const withdrawn = otherSetting(settings, 'otherWithdrawnSteps')
  const haulPrompt = otherSetting(settings, 'otherHaulSwitchPrompt')

  return (
    <>
      <div style={sectionStyle}>OTHER MODE</div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Include aUEC
          <span style={hintStyle}>
            On a log job that already has steps, auto-capture writes Reward only when the amount is greater than 0.
          </span>
        </span>
        <Toggle
          on={!!settings.otherOcrIncludeAuec}
          onClick={() => set({ otherOcrIncludeAuec: !settings.otherOcrIncludeAuec })}
        />
      </div>
      {TOGGLES.slice(0, 1).map((t) => renderToggle(t))}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Withdrawn steps
          <span style={hintStyle}>A step the game withdrew: grey it out or hide it.</span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['grey', 'hide'] as const).map((v) => {
            const on = withdrawn === v
            return (
              <button
                key={v}
                onClick={() => set({ otherWithdrawnSteps: v })}
                style={{
                  padding: '6px 14px',
                  border: `1px solid ${on ? C.accBorder : C.lineStrong}`,
                  background: on ? C.accFill : 'transparent',
                  color: on ? C.acc : C.dim,
                  fontFamily: F.display,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  cursor: 'pointer'
                }}
              >
                {v.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>
      {TOGGLES.slice(1).map((t) => renderToggle(t))}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Hide short accept/drop loops
          <span style={hintStyle}>Hide abandoned jobs that lasted less than this many seconds. 0 = show all.</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            value={otherSetting(settings, 'otherHideShortLoopsSec')}
            onChange={(e) => numSet('otherHideShortLoopsSec', e.target.value)}
            style={numStyle}
          />
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>s</span>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Haul-switch prompt
          <span style={hintStyle}>Offer to switch to Haul mode when a hauling contract at or above this SCU is accepted.</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle on={haulPrompt} onClick={() => set({ otherHaulSwitchPrompt: !haulPrompt })} />
          <input
            type="number"
            min={0}
            disabled={!haulPrompt}
            value={otherSetting(settings, 'otherHaulSwitchMinScu')}
            onChange={(e) => numSet('otherHaulSwitchMinScu', e.target.value)}
            style={{ ...numStyle, opacity: haulPrompt ? 1 : 0.45 }}
          />
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>SCU min</span>
        </div>
      </div>
    </>
  )

  function renderToggle(t: { key: BoolKey; label: string; hint: string }): React.ReactElement {
    const on = otherSetting(settings, t.key)
    return (
      <div key={t.key} style={rowStyle}>
        <span style={keyStyle}>
          {t.label}
          <span style={hintStyle}>{t.hint}</span>
        </span>
        <Toggle on={on} onClick={() => set({ [t.key]: !on })} />
      </div>
    )
  }
}
