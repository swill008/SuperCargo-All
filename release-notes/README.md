# Release notes

Each version's notes live here as `<version>.md`, e.g. `1.0.0.md`, where `<version>` is the `version` in
`package.json` (plain semver; electron-updater compares it). The file starts with
`## What's new in R1 <version>` ("R1" is the release line), then `### New`, `### Changed` and `### Fixed`
sections as needed, each a list of `- ` bullets in plain user words.

**Audience: the general public** (user, 2026-10-15: "when we build notes, its for the general public. remember that
when generating them. keep them straight to the point an professional."). One short line per bullet: what the user
gets, in professional plain English. No internal names (readers, workers, files, settings keys, batch numbers), no
test or CI details, no hedging or asides.

## Writing notes as we go

Rule: each batch commit adds its lines to release-notes/<next version>.md. The next version is the one after
the latest release (create the file with its heading if it isn't there yet). A batch that changes nothing a user
would notice adds nothing. That way the notes are written while the work is fresh, not at release time.

## What a release checks

`node scripts/release-body.mjs <version>` builds the release text and refuses notes that:

- are missing, or don't start with `## What's new in R1 <version>`;
- have no `### New`, `### Changed` or `### Fixed` section with at least one `- ` bullet;
- still hold a placeholder: TODO, TBD, FIXME, a bullet that is only `…` or `...`, a `<` (an unfilled
  `<placeholder>`) or "lorem";
- are the same (after the heading) as the previous version's file.

The release workflow (`.github/workflows/release-win.yml`, run by hand from the Actions tab) runs it before
building, and `npm run test:release` (`test/replay/release_checks.mjs`) runs the same rules for the version in
`package.json`; `test/replay/run_all.mjs` runs `release_checks.mjs` too, so a full test run fails when that
version's notes are missing or empty. The release text on GitHub is the file followed by a "How to install"
section; the workflow also writes it to the run's summary page.

## Release steps

1. Set the version: `npm version <x.y.z> --no-git-tag-version` (updates `package.json` and
   `package-lock.json`).
2. Check `release-notes/<x.y.z>.md` holds every batch's lines since the last release; tidy the wording.
3. `node scripts/release-body.mjs <x.y.z>` and `npm run test:release` pass.
4. Commit and push.
5. Actions → "Release Windows (Setup + Portable)" → Run workflow (publish on). It stops before building when the
   tag `SuperCargo-OtherModes-R1-<x.y.z>` already exists (the version is already released: raise it).
6. Read the release text on the run's summary page and on the GitHub release.
7. Actions → "Build Linux release" for the same version.
8. Start a new `release-notes/<next version>.md` with its heading for the next batches.

## Where releases go

Releases are published to `swill008/SuperCargo-All` with the tag `SuperCargo-OtherModes-R1-<version>` and the
title `SuperCargo-OtherModes R1 <version>`. Files:

- `SuperCargo-OtherModes-R1-<version>-Setup.exe` (installer, updates itself) plus `latest.yml` and its
  `.blockmap`, which the in-app updater reads;
- `SuperCargo-OtherModes-R1-<version>-Portable.zip` (unzip and run; tells you about new versions only);
- `SuperCargo-OtherModes-R1-<version>.AppImage` plus `latest-linux.yml` (from `release-linux.yml`, run after
  the Windows release for the same version).

Publish the release as a normal release (not a draft or prerelease): the updater looks at the repo's latest
release.
