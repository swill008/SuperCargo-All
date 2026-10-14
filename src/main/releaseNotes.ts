// Release notes for the Check for Updates window, and the updater's pure rules (skip, updated notice).
// No electron imports: test/replay/update_checks.mjs bundles this file on its own.

import type { ReleaseNote, UpdatedNotice } from '@shared/types'
import { RELEASE_LINE, RELEASE_OWNER, RELEASE_PRODUCT, RELEASE_REPO } from '@shared/release'

export const RELEASES_API = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases?per_page=100`
const FETCH_TIMEOUT_MS = 10_000

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The What's new part of a release text: what follows "## What's new in R1 <version>" (or "## What's new in
 *  <version>") up to the next "#" / "##" heading, trimmed; null when there is none. */
export function whatsNew(body: string | null | undefined, version: string): string | null {
  if (typeof body !== 'string' || !body) return null
  const text = body.replace(/\r\n?/g, '\n')
  const v = escapeRe(version)
  const head = new RegExp(
    `^##[ \\t]+What['’]s new in[ \\t]+(?:${escapeRe(RELEASE_LINE)}[ \\t]+)?v?${v}[ \\t]*$`,
    'im'
  )
  const m = head.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const end = /^#{1,2}[ \t]/m.exec(rest)
  const out = (end ? rest.slice(0, end.index) : rest).trim()
  return out || null
}

/** Version of a release tag: "SuperCargo-OtherModes-R1-1.2.0" or "v1.2.0" / "1.2.0"; null for anything else. */
export function versionFromTag(tag: string): string | null {
  const prefix = `${RELEASE_PRODUCT}-${RELEASE_LINE}-`
  const raw = tag.startsWith(prefix) ? tag.slice(prefix.length) : tag.replace(/^v/i, '')
  return /^\d+(\.\d+)*$/.test(raw) ? raw : null
}

function parts(v: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(v)) return null
  return v.split('.').map((p) => Number(p))
}

/** a > b: 1, a < b: -1, equal: 0 (missing parts count as 0); null when either isn't a plain version. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return null
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function isNewer(version: string, than: string): boolean {
  return compareVersions(version, than) === 1
}

interface ReleaseDoc {
  tag_name?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

/** What's new of every release with current < version <= offered, newest first, from a GitHub releases list.
 *  Drafts, pre-releases and releases without a What's new part are left out. */
export function notesFromReleases(docs: unknown, current: string, offered: string): ReleaseNote[] {
  if (!Array.isArray(docs)) return []
  const found = new Map<string, ReleaseNote>()
  for (const d of docs as ReleaseDoc[]) {
    if (!d || typeof d !== 'object' || d.draft || d.prerelease) continue
    const version = versionFromTag(typeof d.tag_name === 'string' ? d.tag_name : '')
    if (!version || !isNewer(version, current) || isNewer(version, offered)) continue
    if (found.has(version)) continue
    const markdown = whatsNew(typeof d.body === 'string' ? d.body : null, version)
    if (markdown) found.set(version, { version, markdown })
  }
  return [...found.values()].sort((a, b) => compareVersions(b.version, a.version) ?? 0)
}

/** The notes for the update window. Reads the GitHub releases list (10 s timeout); falls back to the offered
 *  release's own text (fallbackBody, e.g. electron-updater's releaseNotes); null when nothing is found. */
export async function fetchNotes(
  current: string,
  offered: string,
  fallbackBody?: string | null,
  fetchFn: typeof fetch = fetch
): Promise<ReleaseNote[] | null> {
  let notes: ReleaseNote[] = []
  try {
    const res = await fetchFn(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (res.ok) notes = notesFromReleases(await res.json(), current, offered)
  } catch {
    notes = []
  }
  if (notes.length) return notes
  const own = whatsNew(fallbackBody, offered)
  return own ? [{ version: offered, markdown: own }] : null
}

/** electron-updater's releaseNotes as one text (string, or a list of {version, note}). */
export function releaseNotesText(notes: unknown, version: string): string | null {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    const hit = notes.find((n) => n && typeof n === 'object' && (n as { version?: unknown }).version === version)
    const note = hit ? (hit as { note?: unknown }).note : null
    return typeof note === 'string' ? note : null
  }
  return null
}

/** Skip This Version: only the start-up check stays quiet, and only for exactly the skipped version. */
export function isSkipped(version: string, skipped: string | undefined, byHand: boolean): boolean {
  return !byHand && !!skipped && version === skipped
}

/** "Updated — now R1 x": when the last run was an older version. Not on a first run (no lastRunVersion). */
export function updatedNoticeFor(lastRunVersion: string | undefined, current: string): UpdatedNotice | null {
  if (!lastRunVersion || !isNewer(current, lastRunVersion)) return null
  return { from: lastRunVersion, to: current }
}
