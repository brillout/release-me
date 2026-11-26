// Paths are relative to the repository root (the current working directory, see githubReleaseSync())

export { gitTagExists }
export { findReleaseCommit }
export { getReleaseDate }
export { getChangedFiles }

import { execFileSync } from 'node:child_process'

// Any CHANGELOG.md (in a pathspec, `*` also matches `/`), not only the package's: a changelog entry may have been added
// before its CHANGELOG.md was moved
// TODO/after-merge: only search the package's CHANGELOG.md, following its renames (`$ git log --follow`): with several packages, another package's CHANGELOG.md may have added `[<version>](` first, and the missing tag would then be created at that package's release commit
const CHANGELOG_PATHSPEC = '*CHANGELOG.md'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function gitLines(args: string[]): string[] {
  return git(args).split('\n').filter(Boolean)
}

// The files that changed between two commits — used to scope a push to the packages it touched (see getPushedFiles())
function getChangedFiles(beforeSha: string, headSha: string): string[] {
  return gitLines(['diff', '--name-only', beforeSha, headSha])
}

// A release tag's fully-qualified ref. The `refs/tags/` prefix pins it to a tag, so git can't resolve
// a like-named branch (or any other ref) instead.
function tagRef(releaseTag: string): string {
  return `refs/tags/${releaseTag}`
}

function gitTagExists(releaseTag: string): boolean {
  // `rev-parse --verify` exits non-zero (so git() throws) when the tag is missing.
  try {
    git(['rev-parse', '-q', '--verify', tagRef(releaseTag)])
    return true
  } catch {
    return false
  }
}

// The commit that introduced this version's changelog entry — i.e. the release commit, which is where
// its tag belongs. Pickaxe (`-S`, a literal-string search) the changelog history for the heading's
// link opener `[<version>](`; the oldest commit that changed its count is the one that added it.
function findReleaseCommit(version: string): string | null {
  return gitLines(['log', '--reverse', '--format=%H', `-S[${version}](`, '--', CHANGELOG_PATHSPEC])[0] ?? null
}

// The release date (`YYYY-MM-DD`): the committer date of the release commit — the Git tag's, or else the one deduced
// from the changelog history (the one apply-release-plan.ts tags). null if there's neither. (GitHub's `created_at` of
// a release is also its commit's date.)
function getReleaseDate(releaseTag: string, version: string): string | null {
  const commitish = gitTagExists(releaseTag) ? tagRef(releaseTag) : findReleaseCommit(version)
  if (!commitish) return null
  // %cs is the committer date in short form (YYYY-MM-DD).
  return git(['log', '-1', '--format=%cs', commitish]).trim()
}
