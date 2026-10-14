/**
 * Fork work-mode switch (swill008/SuperCargo-All, features branch).
 *
 * SuperCargo upstream is a hauling tool. This fork adds a second mode for
 * Delivery / Collection / mining turn-ins without rewriting packer, hold,
 * CargoGridPage, or the haul parser.
 *
 * Rules we locked with the user:
 * - Settings copy:
 *     Work mode
 *     * Haul  — cargo pickup, pack, deliver (original SuperCargo)
 *     * Other — deliveries, collections, mining turn-ins (New Functions)
 * - Default is Haul so a fresh install and an upstream merge still feel like
 *   stock SuperCargo.
 * - Modes are mutually exclusive. Haul mode must not ingest Other jobs;
 *   Other mode must not call the packer / haul route / cargo grid.
 * - Switching modes hides the other UI. It does NOT delete manifest.json
 *   or other-jobs.json.
 *
 * Edit this file when the labels or the default change.
 */

export type WorkMode = 'haul' | 'other'

export const WORK_MODE_LABELS: Record<WorkMode, { title: string; blurb: string }> = {
  haul: {
    title: 'Haul',
    blurb: 'cargo pickup, pack, deliver (original SuperCargo)'
  },
  other: {
    title: 'Other',
    blurb: 'deliveries, collections, mining turn-ins (New Functions)'
  }
}

/** Treat missing / unknown values as Haul so old settings.json stays valid. */
export function resolveWorkMode(value: string | undefined | null): WorkMode {
  return value === 'other' ? 'other' : 'haul'
}

// Merge onto upstream AppSettings without rewriting types.ts.
declare module '@shared/types' {
  interface AppSettings {
    workMode?: WorkMode
    /** After log accept, write parsed aUEC onto the job when reward is 0. */
    otherOcrIncludeAuec?: boolean
    /** Next + overlay list every objective on a job. Default off. */
    overlayShowAllObjectives?: boolean
    /** When showing all, drop done steps. Default on. */
    overlayHideCompletedObjectives?: boolean
    /** tick a step when the log says "Objective Complete" */
    otherAutoTickObjectives?: boolean
    /** what to do with a step the game withdrew */
    otherWithdrawnSteps?: 'grey' | 'hide'
    /** on start-up, say when the last game session crashed and jobs were kept */
    otherCrashNotice?: boolean
    /** toast when the game refuses a contract (contract limit) */
    otherContractLimitToast?: boolean
    /** show reputation on jobs */
    otherShowRep?: boolean
    /** badge on contracts a party member shared */
    otherSharedBadge?: boolean
    /** hide abandoned jobs that lasted less than this many seconds (party accept/drop loops); 0 = show all */
    otherHideShortLoopsSec?: number
    /** per-session summary in History */
    otherSessionSummary?: boolean
    /** offer to switch to Haul mode when a big haul is accepted in Other mode */
    otherHaulSwitchPrompt?: boolean
    /** total SCU at or above which the switch is offered */
    otherHaulSwitchMinScu?: number
    /** distance for steps with no UEX place, from the objective's CreateMarker position */
    otherMarkerDistance?: boolean
    /** STARTING AT: auto = the newest of the typed start and the latest location clue; fixed = the typed start only */
    otherStartMode?: 'auto' | 'fixed'
    /** global hotkey for WHERE AM I (reads the map screen) */
    otherWhereHotkey?: string
    /** WHERE AM I zone 1: the map's bottom location line (fractions of the captured screen) */
    otherWhereZone1?: import('@shared/types').CropRect
    /** WHERE AM I zone 2: the r_DisplayInfo text, upper right */
    otherWhereZone2?: import('@shared/types').CropRect
    /** read zone 2 first; off = zone 1 only */
    otherWhereUseZone2?: boolean
    /** re-read zone 2 (r_DisplayInfo panel) every otherWhereLiveSec seconds, no keypress */
    otherWhereLive?: boolean
    /** live re-read interval, seconds (30-120) */
    otherWhereLiveSec?: number
    /** AFK button: seconds between key presses */
    otherAfkIntervalSec?: number
    /** AFK: first key (opens the map) */
    otherAfkFirstKey?: string
    /** AFK: key pressed every cycle after the first */
    otherAfkCycleKey?: string
    /** AFK: stop by itself after this many minutes (0 = no limit) */
    otherAfkMaxMin?: number
    /** AFK: run a WHERE AM I read about once a minute while the map is open */
    otherAfkWhereRead?: boolean
    /** distances on the overlay card */
    otherOverlayDistance?: boolean
    /** data source: the bundled starmap positions (places UEX lacks + coords UEX lacks); UEX is always on */
    otherSourceStarmap?: boolean
  }
}

export const OTHER_SETTING_DEFAULTS = {
  otherAutoTickObjectives: true,
  otherWithdrawnSteps: 'grey' as 'grey' | 'hide',
  otherCrashNotice: true,
  otherContractLimitToast: true,
  otherShowRep: true,
  otherSharedBadge: true,
  otherHideShortLoopsSec: 10,
  otherSessionSummary: true,
  otherHaulSwitchPrompt: true,
  otherHaulSwitchMinScu: 100,
  otherMarkerDistance: true,
  otherStartMode: 'auto' as 'auto' | 'fixed',
  otherWhereHotkey: 'CommandOrControl+Shift+L',
  otherWhereZone1: { x: 0.15, y: 0.81, w: 0.4, h: 0.06 },
  otherWhereZone2: { x: 0.78, y: 0, w: 0.22, h: 0.24 },
  otherWhereUseZone2: true,
  otherWhereLive: false,
  otherWhereLiveSec: 45,
  otherAfkIntervalSec: 15,
  otherAfkFirstKey: 'F2',
  otherAfkCycleKey: 'F1',
  otherAfkMaxMin: 120,
  otherAfkWhereRead: true,
  otherOverlayDistance: true,
  otherSourceStarmap: true
}

type OtherSettingKey = keyof typeof OTHER_SETTING_DEFAULTS

/** a setting's value, falling back to its default when unset */
export function otherSetting<K extends OtherSettingKey>(
  settings: Partial<Record<OtherSettingKey, unknown>> | undefined,
  key: K
): (typeof OTHER_SETTING_DEFAULTS)[K] {
  const v = settings?.[key]
  return (v === undefined || v === null ? OTHER_SETTING_DEFAULTS[key] : v) as (typeof OTHER_SETTING_DEFAULTS)[K]
}
