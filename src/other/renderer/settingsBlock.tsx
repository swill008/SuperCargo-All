/**
 * Other-only Settings rows. Re-tie: render after haul OCR Capture delay.
 */
import React, { useEffect, useState } from 'react'
import { Btn } from '@renderer/components/ui'
import OtherMapCalibrator from './components/OtherMapCalibrator'
import HotkeyRecorder from './components/HotkeyRecorder'
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

/** upstream debug-window hotkey (fixed) */
const DEBUG_HOTKEY = 'CommandOrControl+Shift+D'

/** single keys the AFK presser can send (no modifiers) */
const AFK_KEYS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
  'Escape',
  'Tab'
]

const selectStyle: React.CSSProperties = { ...numStyle, width: 110 }

const TOGGLES: { key: BoolKey; label: string; hint: string }[] = [
  { key: 'otherAutoTickObjectives', label: 'Auto-tick objectives', hint: 'Tick a step when the log says Objective Complete.' },
  { key: 'otherCrashNotice', label: 'Crash notice', hint: 'On start-up, say when the game did not quit cleanly and jobs were kept.' },
  { key: 'otherContractLimitToast', label: 'Contract-limit toast', hint: 'Show a toast when the game refuses a contract because you are at the limit.' },
  { key: 'otherShowRep', label: 'Show reputation', hint: 'Show the reputation from the contract title on each job.' },
  { key: 'otherSharedBadge', label: 'Shared badge', hint: 'Mark contracts a party member shared with you.' },
  { key: 'otherSessionSummary', label: 'Session summary', hint: 'Group History by game session with a per-session summary.' },
  { key: 'otherMarkerDistance', label: 'Distance from mission markers', hint: 'For a step with no named place, use its mission marker from the game log for the distance.' },
  { key: 'otherOverlayDistance', label: 'Distances on the overlay', hint: 'Show how far the current and next stop are on the overlay card.' }
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
  const whereHotkeySaved = otherSetting(settings, 'otherWhereHotkey')
  const [zonesOpen, setZonesOpen] = useState(false)
  useEffect(() => {
    if (!zonesOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZonesOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zonesOpen])
  if (resolveWorkMode(settings.workMode) !== 'other') return null

  const set = (patch: Partial<AppSettings>): void => {
    dlog.info('other', 'setting changed by user', patch as Record<string, unknown>)
    void updateSettings(patch)
  }
  const numSet = (key: 'otherHideShortLoopsSec' | 'otherHaulSwitchMinScu', raw: string): void => {
    const n = Math.max(0, Math.floor(Number(raw) || 0))
    set({ [key]: n })
  }
  // clamp on blur/commit so typing "4" on the way to "45" isn't rejected
  const rangeSet = (
    key: 'otherWhereLiveSec' | 'otherAfkIntervalSec' | 'otherAfkMaxMin',
    raw: string,
    min: number,
    max: number
  ): void => {
    const n = Math.floor(Number(raw))
    if (!Number.isFinite(n)) return
    const v = Math.min(max, Math.max(min, n))
    if (v !== otherSetting(settings, key)) set({ [key]: v })
  }
  const whereLive = otherSetting(settings, 'otherWhereLive')
  const afkWhereRead = otherSetting(settings, 'otherAfkWhereRead')
  const withdrawn = otherSetting(settings, 'otherWithdrawnSteps')
  const haulPrompt = otherSetting(settings, 'otherHaulSwitchPrompt')
  const startMode = otherSetting(settings, 'otherStartMode')
  const useZone2 = otherSetting(settings, 'otherWhereUseZone2')
  // ✓ = a box the user placed; otherwise the default box is used
  const zoneMark = (key: 'otherWhereZone1' | 'otherWhereZone2'): string => (settings[key] ? '\u2713' : 'default')
  const zoneStatus = `zone 1 ${zoneMark('otherWhereZone1')} \u00b7 zone 2 ${useZone2 ? zoneMark('otherWhereZone2') : 'off'}`

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
        {renderChoice(['grey', 'hide'] as const, withdrawn, (v) => set({ otherWithdrawnSteps: v }))}
      </div>
      {TOGGLES.slice(1).map((t) => renderToggle(t))}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Start mode
          <span style={hintStyle}>
            AUTO starts from what you type, then follows the newest location clue (ticks, objectives, inventory, WHERE AM I).
            FIXED always uses what you typed.
          </span>
        </span>
        {renderChoice(['auto', 'fixed'] as const, startMode, (v) => set({ otherStartMode: v }))}
      </div>
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
      <div style={sectionStyle}>WHERE AM I (MAP)</div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Hotkey
          <span style={hintStyle}>Reads your location from the map screen.</span>
        </span>
        <HotkeyRecorder
          value={whereHotkeySaved}
          onChange={(v) => {
            if (v !== whereHotkeySaved) set({ otherWhereHotkey: v })
          }}
          conflicts={[settings.ocrHotkey, DEBUG_HOTKEY]}
        />
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Use zone 2
          <span style={hintStyle}>r_DisplayInfo text, upper right of the map screen</span>
        </span>
        <Toggle on={useZone2} onClick={() => set({ otherWhereUseZone2: !useZone2 })} />
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Live position
          <span style={hintStyle}>
            Re-read the r_DisplayInfo panel every N s while it&apos;s on screen (about 5 s of OCR each time)
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle on={whereLive} onClick={() => set({ otherWhereLive: !whereLive })} />
          {renderNum('otherWhereLiveSec', 30, 120, 's', !whereLive)}
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Zones
          <span style={hintStyle}>Where on the map screen each text is read.</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Btn onClick={() => setZonesOpen(true)} style={choiceStyle(false)} hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text }}>
            SET UP ZONES
          </Btn>
          <span style={{ fontFamily: F.mono, fontSize: 12, color: C.body }}>{zoneStatus}</span>
        </div>
      </div>
      <div style={sectionStyle}>AFK</div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          AFK key presser
          <span style={hintStyle}>
            Presses keys in Star Citizen for you. Check RSI&apos;s terms before using it; the game window is brought to the
            front every cycle.
          </span>
        </span>
        <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>Start and stop it with AFK on the overlay.</span>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Interval
          <span style={hintStyle}>Seconds between key presses (5{'\u2013'}120).</span>
        </span>
        {renderNum('otherAfkIntervalSec', 5, 120, 's')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          First key
          <span style={hintStyle}>Pressed on the first cycle (F2 = map).</span>
        </span>
        {renderKey('otherAfkFirstKey')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Cycle key
          <span style={hintStyle}>Pressed on every later cycle.</span>
        </span>
        {renderKey('otherAfkCycleKey')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Time limit
          <span style={hintStyle}>Stop AFK after this many minutes. 0 = no limit.</span>
        </span>
        {renderNum('otherAfkMaxMin', 0, 1440, 'min')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Read position while AFK
          <span style={hintStyle}>About once a minute, run a quiet WHERE AM I read after a key press.</span>
        </span>
        <Toggle on={afkWhereRead} onClick={() => set({ otherAfkWhereRead: !afkWhereRead })} />
      </div>
      {zonesOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            zIndex: 50
          }}
        >
          <div
            style={{
              width: 940,
              maxWidth: '100%',
              maxHeight: '100%',
              overflowY: 'auto',
              background: C.black,
              border: '1px solid rgba(255,255,255,0.22)',
              fontFamily: F.body
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: `1px solid ${C.lineStrong}`
              }}
            >
              <div style={{ fontFamily: F.display, fontSize: 16, letterSpacing: '0.08em', color: C.text }}>
                WHERE AM I {'\u00b7'} ZONES
              </div>
              <Btn onClick={() => setZonesOpen(false)} style={{ ...choiceStyle(false), border: 0 }}>
                CLOSE
              </Btn>
            </div>
            <div style={{ padding: 20 }}>
              <OtherMapCalibrator />
            </div>
          </div>
        </div>
      )}
    </>
  )

  function choiceStyle(on: boolean): React.CSSProperties {
    return {
      padding: '6px 14px',
      border: `1px solid ${on ? C.accBorder : C.lineStrong}`,
      background: on ? C.accFill : 'transparent',
      color: on ? C.acc : C.dim,
      fontFamily: F.display,
      fontSize: 12,
      letterSpacing: '0.08em',
      cursor: 'pointer'
    }
  }

  function renderNum(
    key: 'otherWhereLiveSec' | 'otherAfkIntervalSec' | 'otherAfkMaxMin',
    min: number,
    max: number,
    unit: string,
    disabled = false
  ): React.ReactElement {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          // keyed by the saved value so an outside change (or a clamp) refreshes the field
          key={`${key}:${otherSetting(settings, key)}`}
          type="number"
          min={min}
          max={max}
          disabled={disabled}
          defaultValue={otherSetting(settings, key)}
          onBlur={(e) => rangeSet(key, e.target.value, min, max)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          style={{ ...numStyle, opacity: disabled ? 0.45 : 1 }}
        />
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>{unit}</span>
      </div>
    )
  }

  function renderKey(key: 'otherAfkFirstKey' | 'otherAfkCycleKey'): React.ReactElement {
    const cur = otherSetting(settings, key)
    const opts = AFK_KEYS.includes(cur) ? AFK_KEYS : [cur, ...AFK_KEYS]
    return (
      <select value={cur} onChange={(e) => set({ [key]: e.target.value })} style={selectStyle}>
        {opts.map((k) => (
          <option key={k} value={k} style={{ background: C.black }}>
            {k}
          </option>
        ))}
      </select>
    )
  }

  function renderChoice<V extends string>(values: readonly V[], current: V, pick: (v: V) => void): React.ReactElement {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        {values.map((v) => (
          <button key={v} onClick={() => pick(v)} style={choiceStyle(current === v)}>
            {v.toUpperCase()}
          </button>
        ))}
      </div>
    )
  }

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
