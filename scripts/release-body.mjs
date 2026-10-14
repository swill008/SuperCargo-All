// Builds a GitHub release's text from release-notes/<version>.md (like Gremlin's
// tools/release_body.py): the notes file, then "## How to install".
// Usage: node scripts/release-body.mjs <version> [--out FILE]
// Exits 1 when the notes file is missing, doesn't start with "## What's new in R1 <version>",
// has no "### New|Changed|Fixed" section with a "- " bullet, still holds a placeholder, or is the
// same as the previous version's notes (checkNotes). Used by .github/workflows/release-win.yml.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_LINE = 'R1'
const NOTES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'release-notes')

export function fileBase(version) {
  return `SuperCargo-OtherModes-${RELEASE_LINE}-${version}`
}

export function installText(version) {
  const name = fileBase(version)
  return [
    '## How to install',
    '',
    `- Installer: run ${name}-Setup.exe. It installs for your Windows user only (no administrator rights),` +
      ' lets you choose the folder, and installed copies update themselves. The desktop shortcut is optional.',
    `- Portable: unzip ${name}-Portable.zip anywhere (Documents, Desktop, etc), not in Program Files, and run` +
      ' SuperCargo-OtherModes.exe. A portable copy tells you about new versions but does not update itself.',
    '- Your data is in %USERPROFILE%\\SuperCargo-OtherModes; uninstalling never removes it.',
    '- Unsigned build: SmartScreen may warn on first run (More info -> Run anyway).',
    ''
  ].join('\n')
}

const readNotes = (file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')

// the notes without their first (heading) line, whitespace-normalised, for the "same as last time" rule
const afterHeading = (notes) =>
  notes.replace(/^\n+/, '').split('\n').slice(1).map((l) => l.trimEnd()).join('\n').trim()

const semverParts = (v) => v.split('.').map(Number)
function semverLess(a, b) {
  const [x, y] = [semverParts(a), semverParts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

// The newest notes file in notesDir older than version, or null.
export function previousVersion(version, notesDir = NOTES_DIR) {
  if (!fs.existsSync(notesDir)) return null
  return (
    fs
      .readdirSync(notesDir)
      .map((f) => /^(\d+\.\d+\.\d+)\.md$/.exec(f)?.[1])
      .filter((v) => v && semverLess(v, version))
      .sort((a, b) => (semverLess(a, b) ? 1 : -1))[0] ?? null
  )
}

const SECTION = /^### (New|Changed|Fixed)\s*$/
const PLACEHOLDERS = [
  [/\b(TODO|TBD|FIXME)\b/, (m) => `placeholder '${m[0]}'`],
  [/^\s*[-*]\s*(…|\.\.\.)\s*$/m, () => "a bullet that is only '…' or '...'"],
  [/</, () => "a '<' (unfilled <placeholder>)"],
  [/lorem/i, () => "placeholder text 'lorem'"]
]

// Content rules for a version's notes (N1). Returns a list of problems (empty = fine).
export function checkNotes(version, notes, notesDir = NOTES_DIR) {
  const problems = []
  const lines = notes.split('\n')
  let section = null
  const filled = new Set()
  for (const line of lines) {
    if (/^#/.test(line)) section = SECTION.exec(line)?.[1] ?? null
    else if (section && /^- \S/.test(line)) filled.add(section)
  }
  if (!filled.size) {
    problems.push("needs at least one '### New', '### Changed' or '### Fixed' section with a '- ' bullet under it")
  }
  for (const [re, say] of PLACEHOLDERS) {
    const m = re.exec(notes)
    if (m) {
      const at = notes.slice(0, m.index).split('\n').length
      problems.push(`still holds ${say(m)} on line ${at}; write the real text`)
    }
  }
  const prev = previousVersion(version, notesDir)
  if (prev) {
    const prevNotes = readNotes(path.join(notesDir, `${prev}.md`))
    if (afterHeading(prevNotes) === afterHeading(notes)) {
      problems.push(`is the same as release-notes/${prev}.md (after the heading); write what changed in ${version}`)
    }
  }
  return problems
}

export function buildBody(version, notesDir = NOTES_DIR) {
  const file = path.join(notesDir, `${version}.md`)
  if (!fs.existsSync(file)) {
    throw new Error(`No release notes for ${version}: add release-notes/${version}.md (looked for ${file}).`)
  }
  const notes = readNotes(file)
  const heading = `## What's new in ${RELEASE_LINE} ${version}`
  const first = notes.replace(/^\n+/, '').split('\n', 1)[0].trimEnd()
  if (first !== heading) {
    throw new Error(`release-notes/${version}.md must start with '${heading}' (found '${first}').`)
  }
  const problems = checkNotes(version, notes, notesDir)
  if (problems.length) {
    throw new Error(
      `release-notes/${version}.md can't be released yet:\n` + problems.map((p) => `  - it ${p}`).join('\n')
    )
  }
  return notes.trim() + '\n\n' + installText(version)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const version = args[0]
  const outAt = args.indexOf('--out')
  if (!version) {
    console.error('usage: node scripts/release-body.mjs <version> [--out FILE]')
    process.exit(2)
  }
  try {
    const body = buildBody(version)
    if (outAt >= 0 && args[outAt + 1]) fs.writeFileSync(args[outAt + 1], body, 'utf8')
    else process.stdout.write(body)
  } catch (e) {
    console.error(`error: ${e.message}`)
    process.exit(1)
  }
}
