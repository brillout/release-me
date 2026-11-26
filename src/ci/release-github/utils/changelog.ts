export { parseChangelog }
export type { ReleaseNotesByVersion }

// By version (e.g. `0.4.257`, `0.1.0-beta.6`), newest first
type ReleaseNotesByVersion = Record<string, string>

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
