export { parseChangelog }
export type { ReleaseNotesByVersion }

// By version (e.g. `0.4.257`, `0.1.0-beta.6`), newest first
type ReleaseNotesByVersion = Record<string, string>

// The notes of each version of a CHANGELOG.md
function parseChangelog(changelog: string): ReleaseNotesByVersion {
  // Match each version heading, with or without link: `## [0.4.257](…) (2026-05-06)` (release-me), or
  // `## 0.1.0 (2023-05-24)` (conventional-changelog writes a package's first release like that). Only the version itself
  // is captured. findReleaseCommit() searches the same headings in the Git history.
  const matches = [...changelog.matchAll(/^##? \[?(\d+\.\d+\.\d+[^\]\s]*)/gm)]

  return Object.fromEntries(
    matches.map((match, index) => {
      const [, version] = match
      // A version's notes run from the end of its heading line to the start of the next heading.
      const headingLineEnd = changelog.indexOf('\n', match.index)
      // No line end: the heading is the last line
      const notesStart = headingLineEnd === -1 ? changelog.length : headingLineEnd
      const notesEnd = matches[index + 1]?.index ?? changelog.length
      const notes = changelog.slice(notesStart, notesEnd).trim()
      return [version, notes]
    }),
  )
}
