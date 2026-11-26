export { parseChangelog }
export type { ReleaseNotesByVersion }

// By version (e.g. `0.4.257`, `0.1.0-beta.6`), newest first
type ReleaseNotesByVersion = Record<string, string>

// The notes of each version of a CHANGELOG.md
function parseChangelog(changelog: string): ReleaseNotesByVersion {
  // Match each version heading, ignoring any link release-me appends after the version
  // (`## [0.4.257](…)`) — only the version itself is captured.
  // TODO/after-merge: also match the headings without link (e.g. `## 0.1.0 (2023-05-24)`: conventional-changelog writes a package's first release like that). Such a version gets no GitHub Release, and its heading ends up in the notes of the next version. Then findReleaseCommit() should also find such a heading (it searches `[<version>](`): otherwise, if its tag is missing, the run fails.
  const matches = [...changelog.matchAll(/^##? \[(\d+\.\d+\.\d+[^\]]*)\](?:\([^)]+\))?/gm)]

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
