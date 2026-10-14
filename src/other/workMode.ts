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
    /** use the player's current station from the log as STARTING AT until one is typed */
    otherAutoStart?: boolean
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
  otherAutoStart: true
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
