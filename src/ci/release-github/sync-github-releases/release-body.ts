export { buildReleaseBodies }
export { buildReleaseBody }
export type { ReleaseBodyByVersion }

import type { ReleaseNotesByVersion } from '../utils/changelog.ts'
import { getReleaseDate } from '../utils/git.ts'
import type { TagScheme } from './tag-scheme.ts'

// By version, newest first (like ReleaseNotesByVersion)
type ReleaseBodyByVersion = Record<string, string>

// The release body of each version, with its release date read from git (see getReleaseDate())
function buildReleaseBodies(
  changelogNotes: ReleaseNotesByVersion,
  { tagScheme, changelogUrl }: { tagScheme: TagScheme; changelogUrl: string },
): ReleaseBodyByVersion {
  return Object.fromEntries(
    Object.entries(changelogNotes).map(([version, notes]) => [
      version,
      buildReleaseBody(notes, { releaseDate: getReleaseDate(tagScheme.build(version), version), changelogUrl }),
    ]),
  )
}

// The release body of a version: its notes, with
//  - the release date on top, when known (see getReleaseDate()): a GitHub Release otherwise shows when it was synced
//    (its `published_at`), not when the version was released, and
//  - a footer linking to CHANGELOG.md, to discourage editing the GitHub Release (the next sync overwrites it).
function buildReleaseBody(
  notes: string,
  { releaseDate, changelogUrl }: { releaseDate: string | null; changelogUrl: string },
): string {
  const dateLine = releaseDate ? `_${formatReleaseDate(releaseDate)}_\n\n` : ''
  const footer = `<sub>Automatically synced from [\`CHANGELOG.md\`](${changelogUrl})</sub>`
  return `${dateLine}${notes}\n\n${footer}`
}

// Render an ISO date (`2026-05-06`) in a human-friendly long form (`May 6, 2026`). Formatted in UTC so
// the day matches getReleaseDate()'s committer date regardless of the runner's timezone.
const releaseDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})
function formatReleaseDate(isoDate: string): string {
  return releaseDateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}
