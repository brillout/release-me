// Paths are relative to the repository root (the current working directory, see githubReleaseSync())

export { gitTagExists }
export { findReleaseCommit }
export { getReleaseDate }
export { getChangedFiles }

import { execFileSync } from 'node:child_process'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function gitLines(args: string[]): string[] {
  return git(args).split('\n').filter(Boolean)
}

// The files that changed between two commits — used to scope a push to the packages it touched (see getPushedFiles()).
// null if the first commit is missing, e.g. after a force-push (no ref reaches the overwritten commit anymore).
function getChangedFiles(beforeSha: string, headSha: string): string[] | null {
  if (!gitRevExists(`${beforeSha}^{commit}`)) return null
  return gitLines(['diff', '--name-only', beforeSha, headSha])
}

// A release tag's fully-qualified ref. The `refs/tags/` prefix pins it to a tag, so git can't resolve
// a like-named branch (or any other ref) instead.
function tagRef(releaseTag: string): string {
  return `refs/tags/${releaseTag}`
}

function gitTagExists(releaseTag: string): boolean {
  return gitRevExists(tagRef(releaseTag))
}
function gitRevExists(rev: string): boolean {
  // `rev-parse --verify` exits non-zero (so git() throws) when the rev is missing.
  try {
    git(['rev-parse', '-q', '--verify', rev])
    return true
  } catch {
    return false
  }
}

// The commit that introduced this version's changelog entry — i.e. the release commit, which is where
// its tag belongs. Among the commits of the package's CHANGELOG.md that add or remove (`-G`) the version's heading, the
// oldest is the one that added it. The history follows the renames of CHANGELOG.md: its entry may have been added
// before it was moved (e.g. from the repository root to the package's directory).
function findReleaseCommit(version: string, changelogPath: string): string | null {
  // The version's heading, with or without link, like parseChangelog(): `## [0.4.257](…)` or `## 0.1.0 (…)`. A POSIX
  // extended regex, where the version ends at `]`, a space, or the line end (`0.1.1` mustn't match `0.1.10`).
  const headingRegex = `^##? \\[?${escapeRegex(version)}(]| |$)`
  // Newest first: `--follow` doesn't work with `--reverse`
  return gitLines(['log', '--follow', '--format=%H', `-G${headingRegex}`, '--', changelogPath]).at(-1) ?? null
}

// Escape the special characters of a POSIX extended regex
function escapeRegex(text: string): string {
  return text.replace(/[\\.[()*+?{|^$]/g, '\\$&')
}

// The release date (`YYYY-MM-DD`): the committer date of the release commit — the Git tag's, or else the one deduced
// from the changelog history (the one apply-release-plan.ts tags). null if there's neither. (GitHub's `created_at` of
// a release is also its commit's date.)
function getReleaseDate(
  releaseTag: string,
  { version, changelogPath }: { version: string; changelogPath: string },
): string | null {
  const commitish = gitTagExists(releaseTag) ? tagRef(releaseTag) : findReleaseCommit(version, changelogPath)
  if (!commitish) return null
  // %cs is the committer date in short form (YYYY-MM-DD).
  return git(['log', '-1', '--format=%cs', commitish]).trim()
}
