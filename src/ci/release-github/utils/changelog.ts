export { parseChangelog }
export { buildReleaseBody }

// By version (e.g. `0.4.257`, `0.1.0-beta.6`), newest first: the notes parsed from CHANGELOG.md, and the release bodies
// built from them (see buildReleaseBody())
export type ReleaseNotesByVersion = Record<string, string>
export type ReleaseBodyByVersion = Record<string, string>

// The notes of each version of a CHANGELOG.md
function parseChangelog(changelog: string): ReleaseNotesByVersion {
  // Match each version heading, ignoring any link release-me appends after the version
  // (`## [0.4.257](…)`) — only the version itself is captured.
  const matches = [...changelog.matchAll(/^##? \[(\d+\.\d+\.\d+[^\]]*)\](?:\([^)]+\))?/gm)]

  return Object.fromEntries(
    matches.map((match, index) => {
      const [, version] = match
      // A version's notes run from the end of its heading line to the start of the next heading.
      const notesStart = changelog.indexOf('\n', match.index)
      const notesEnd = matches[index + 1]?.index ?? changelog.length
      const notes = changelog.slice(notesStart, notesEnd).trim()
      return [version, notes]
    }),
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
