// Release naming, shared by the updater, the version line and test/replay/release_checks.mjs.
// package.json "version" stays plain semver (electron-updater compares it); the release
// line "R1" goes in front of it on the tag, the title, the file names and the About line.

export const RELEASE_LINE = 'R1'
export const RELEASE_PRODUCT = 'SuperCargo-OtherModes'
export const RELEASE_OWNER = 'swill008'
export const RELEASE_REPO = 'SuperCargo-All'

/** "R1 1.0.0": what the app shows as its version. */
export function releaseLabel(version: string): string {
  return `${RELEASE_LINE} ${version}`
}

/** GitHub tag of a release: "SuperCargo-OtherModes-R1-1.0.0". */
export function releaseTag(version: string): string {
  return `${RELEASE_PRODUCT}-${RELEASE_LINE}-${version}`
}

/** The release page a portable copy points to for a new version. */
export function releasePageUrl(version: string): string {
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/tag/${releaseTag(version)}`
}
