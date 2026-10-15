/**
 * Settings → OTHER MODE tab: every Other-only setting, grouped in five sections with large headings
 * and a jump list. Re-tie: SettingsPage renders this as its OTHER MODE tab.
 */
import React, { useEffect, useState } from 'react'
import { Btn } from '@renderer/components/ui'
import OtherMapCalibrator from './components/OtherMapCalibrator'
import HotkeyRecorder from './components/HotkeyRecorder'
import { focusLearned } from './state/learnedFocus'
import DataSources from './components/DataSources'
import { C, F } from '@renderer/theme'
import { useStore } from '@renderer/state/store'
import { dlog } from '@renderer/state/log'
import type { AppSettings } from '@shared/types'
import { OTHER_SETTING_DEFAULTS, otherSetting, resolveWorkMode } from '../workMode'

type BoolKey = {
  [K in keyof typeof OTHER_SETTING_DEFAULTS]: (typeof OTHER_SETTING_DEFAULTS)[K] extends boolean ? K : never
}[keyof typeof OTHER_SETTING_DEFAULTS]

type ToggleDef = { key: BoolKey; label: string; hint: string }

const hintStyle: React.CSSProperties = { display: 'block', fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }

/** large section heading: clearly bigger than the GENERAL tab's 11px section titles */
const headingStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 20,
  fontWeight: 600,
  letterSpacing: '0.12em',
  color: C.acc,
  paddingBottom: 8,
  borderBottom: `2px solid ${C.accBorder}`,
  margin: '38px 0 0',
  scrollMarginTop: 12
}

const descStyle: React.CSSProperties = { fontFamily: F.body, fontSize: 13, color: C.dim, margin: '8px 0 4px' }

const subHeadingStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 14,
  letterSpacing: '0.16em',
  color: C.text,
  paddingBottom: 7,
  borderBottom: `1px solid ${C.lineStrong}`,
  margin: '22px 0 4px'
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

const selectStyle: React.CSSProperties = { ...numStyle, width: 110 }

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

/** section ids, headings, one-line descriptions and jump-list labels, in page order */
const SECTIONS = [
  { id: 'jobs', jump: 'Jobs', title: 'Jobs & Objectives', desc: 'How contracts from the game log show up as jobs and get ticked off.' },
  { id: 'distances', jump: 'Distances', title: 'Distances & Route', desc: 'How far away each stop is, and where the route is measured from.' },
  {
    id: 'where',
    jump: 'Where Am I',
    title: 'Where Am I (position reading)',
    desc: 'Reads your position from the game screen, so distances start from where you really are.'
  },
  { id: 'places', jump: 'Places', title: 'Places & Matching', desc: 'Where place names come from.' },
  { id: 'afk', jump: 'AFK', title: 'AFK', desc: 'Presses a key in the game at a set interval while you are away.' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const sectionDomId = (id: SectionId): string => `other-settings-${id}`

const JOB_TOGGLES_A: ToggleDef[] = [
  { key: 'otherAutoTickObjectives', label: 'Auto-tick objectives', hint: 'Tick off a step when the game says Objective Complete for it.' }
]

const JOB_TOGGLES_B: ToggleDef[] = [
  {
    key: 'otherCrashNotice',
    label: 'Crash notice',
    hint: 'If the game crashed or closed without quitting, say so on the next start and that your jobs were kept.'
  },
  {
    key: 'otherContractLimitToast',
    label: 'Contract-limit toast',
    hint: 'Pop up a message when the game refuses a contract because you already hold the most you can.'
  },
  { key: 'otherShowRep', label: 'Show reputation', hint: 'Show the reputation named in the contract title on each job.' },
  { key: 'otherSharedBadge', label: 'Shared badge', hint: 'Mark contracts that a party member shared with you.' },
  { key: 'otherSessionSummary', label: 'Session summary', hint: 'In History, group jobs by game session with a summary for each session.' }
]

const DISTANCE_TOGGLES: ToggleDef[] = [
  {
    key: 'otherMarkerDistance',
    label: 'Distance from mission markers',
    hint: 'When a step names no place, use its mission marker from the game log to work out the distance.'
  },
  {
    key: 'otherOverlayDistance',
    label: 'Distances on the overlay',
    hint: 'Show how far the current and next stop are on the in-game overlay card.'
  },
  {
    key: 'otherRouteOptimize',
    label: 'Route optimization',
    hint: 'Shortens the ROUTE order. Off = nearest stop next, as before.'
  }
]

export default function OtherSettingsPage({
  rowStyle,
  keyStyle,
  Toggle
}: {
  rowStyle: React.CSSProperties
  keyStyle: React.CSSProperties
  Toggle: (props: { on: boolean; onClick: () => void }) => React.ReactElement
}): React.ReactElement {
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
  const isOther = resolveWorkMode(settings.workMode) === 'other'

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
  const jumpTo = (id: SectionId): void => {
    document.getElementById(sectionDomId(id))?.scrollIntoView({ block: 'start' })
  }
  const whereLive = otherSetting(settings, 'otherWhereLive')
  const withdrawn = otherSetting(settings, 'otherWithdrawnSteps')
  const haulPrompt = otherSetting(settings, 'otherHaulSwitchPrompt')
  const startMode = otherSetting(settings, 'otherStartMode')
  const useZone2 = otherSetting(settings, 'otherWhereUseZone2')
  // ✓ = a box the user placed; otherwise the default box is used
  const zoneMark = (key: 'otherWhereZone1' | 'otherWhereZone2'): string => (settings[key] ? '✓' : 'default')
  const zoneStatus = `zone 1 ${zoneMark('otherWhereZone1')} · zone 2 ${useZone2 ? zoneMark('otherWhereZone2') : 'off'}`

  return (
    <>
      {!isOther && (
        <div
          data-other-settings-note
          style={{
            fontFamily: F.body,
            fontSize: 13,
            color: C.text,
            padding: '10px 14px',
            margin: '18px 0 0',
            border: `1px solid ${C.accBorder}`,
            background: C.accFill
          }}
        >
          These settings apply when Work mode is Other.
        </div>
      )}
      <nav
        data-other-settings-jump
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '18px 0 0' }}
      >
        {SECTIONS.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 && <span style={{ color: C.dim, fontFamily: F.display, fontSize: 13 }}>{'·'}</span>}
            <Btn
              onClick={() => jumpTo(s.id)}
              style={{
                padding: '4px 8px',
                border: '1px solid transparent',
                background: 'transparent',
                color: C.dim,
                fontFamily: F.display,
                fontSize: 13,
                letterSpacing: '0.08em',
                cursor: 'pointer'
              }}
              hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text }}
            >
              {s.jump}
            </Btn>
          </React.Fragment>
        ))}
      </nav>

      {renderHeading('jobs')}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Include aUEC
          <span style={hintStyle}>
            When a job from the game log already has its steps, the automatic contract scan still fills in its aUEC reward
            (if the job has none yet and the scan finds an amount above 0).
          </span>
        </span>
        <Toggle
          on={!!settings.otherOcrIncludeAuec}
          onClick={() => set({ otherOcrIncludeAuec: !settings.otherOcrIncludeAuec })}
        />
      </div>
      {JOB_TOGGLES_A.map((t) => renderToggle(t))}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Withdrawn steps
          <span style={hintStyle}>When the game withdraws a step from a contract: GREY shows it faded, HIDE removes it.</span>
        </span>
        {renderChoice(['grey', 'hide'] as const, withdrawn, (v) => set({ otherWithdrawnSteps: v }))}
      </div>
      {JOB_TOGGLES_B.map((t) => renderToggle(t))}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Hide short accept/drop loops
          <span style={hintStyle}>
            Hide abandoned jobs you accepted and dropped within this many seconds (e.g. while looking for a good contract). 0 =
            show all.
          </span>
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
          <span style={hintStyle}>
            When you accept a hauling contract of at least this many SCU, offer to switch to Haul mode.
          </span>
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

      {renderHeading('distances')}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Start mode
          <span style={hintStyle}>
            Where distances are measured from. AUTO starts from the place you type, then follows your newest known position
            (ticked steps, objectives, inventory, WHERE AM I). FIXED always uses the place you typed.
          </span>
        </span>
        {renderChoice(['auto', 'fixed'] as const, startMode, (v) => set({ otherStartMode: v }))}
      </div>
      {DISTANCE_TOGGLES.map((t) => renderToggle(t))}

      {renderHeading('where')}
      <div style={rowStyle}>
        <span style={keyStyle}>
          Hotkey
          <span style={hintStyle}>Press this in game with the map screen open to read where you are.</span>
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
          Zones
          <span style={hintStyle}>
            Choose where on the map screen each piece of text is read. Default boxes are used until you set your own.
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Btn onClick={() => setZonesOpen(true)} style={choiceStyle(false)} hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text }}>
            SET UP ZONES
          </Btn>
          <span style={{ fontFamily: F.mono, fontSize: 12, color: C.body }}>{zoneStatus}</span>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Use zone 2
          <span style={hintStyle}>Also read the r_DisplayInfo text in the upper right of the map screen.</span>
        </span>
        <Toggle on={useZone2} onClick={() => set({ otherWhereUseZone2: !useZone2 })} />
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Live position
          <span style={hintStyle}>
            While the r_DisplayInfo text is on screen, re-read your position every N seconds (each read takes about 5 s).
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle on={whereLive} onClick={() => set({ otherWhereLive: !whereLive })} />
          {renderNum('otherWhereLiveSec', 30, 120, 's', !whereLive)}
        </div>
      </div>

      {renderHeading('places')}
      <div style={subHeadingStyle}>Data Sources</div>
      <div style={descStyle}>Turn each list of place names on or off.</div>
      <DataSources rowStyle={rowStyle} keyStyle={keyStyle} Toggle={Toggle} />
      <div style={rowStyle}>
        <span style={keyStyle}>Learned places are on the LEARNED DATA tab.</span>
        <Btn onClick={() => focusLearned()} style={choiceStyle(false)} hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text }}>
          OPEN LEARNED DATA
        </Btn>
      </div>

      {renderHeading('afk')}
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
          <span style={hintStyle}>Seconds between key presses (5{'–'}120).</span>
        </span>
        {renderNum('otherAfkIntervalSec', 5, 120, 's')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          First key
          <span style={hintStyle}>Key pressed on the first cycle (F2 opens the map).</span>
        </span>
        {renderKey('otherAfkFirstKey')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Cycle key
          <span style={hintStyle}>Key pressed on every cycle after the first.</span>
        </span>
        {renderKey('otherAfkCycleKey')}
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>
          Time limit
          <span style={hintStyle}>Stop pressing keys after this many minutes. 0 = no limit.</span>
        </span>
        {renderNum('otherAfkMaxMin', 0, 1440, 'min')}
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
                WHERE AM I {'·'} ZONES
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

  function renderHeading(id: SectionId): React.ReactElement {
    const s = SECTIONS.find((x) => x.id === id)!
    return (
      <>
        <h2 id={sectionDomId(id)} data-other-section={id} style={headingStyle}>
          {s.title}
        </h2>
        <div style={descStyle}>{s.desc}</div>
      </>
    )
  }

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

  function renderToggle(t: ToggleDef): React.ReactElement {
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
