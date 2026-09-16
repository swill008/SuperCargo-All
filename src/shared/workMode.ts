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

export const DEFAULT_WORK_MODE: WorkMode = 'haul'

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

export function isHaulMode(value: string | undefined | null): boolean {
  return resolveWorkMode(value) === 'haul'
}

export function isOtherMode(value: string | undefined | null): boolean {
  return resolveWorkMode(value) === 'other'
}

// Merge onto upstream AppSettings without rewriting types.ts.
declare module './types' {
  interface AppSettings {
    workMode?: WorkMode
    /** @deprecated Other auto-OCR uses settings.ocrAutoCapture */
    otherAutoOcrOnImport?: boolean
    /** After log accept, write parsed aUEC onto the job when reward is 0. */
    otherOcrIncludeAuec?: boolean
    /** Next + overlay list every objective on a job. Default off. */
    overlayShowAllObjectives?: boolean
    /** When showing all, drop done steps. Default on. */
    overlayHideCompletedObjectives?: boolean
  }
}
