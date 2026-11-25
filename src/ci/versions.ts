export { getCommitReleaseVersion }
export { isCommitReleaseVersion }
export { parseReleaseTag }

// Release tags and commit release versions, used by both release-me's CLI and the GitHub Action.

/**
 * `v1.2.3` => `{ packageName: null, version: '1.2.3' }`
 * `some-package@1.2.3` => `{ packageName: 'some-package', version: '1.2.3' }`
 * `@some-scope/some-package@1.2.3` => `{ packageName: '@some-scope/some-package', version: '1.2.3' }`
 */
function parseReleaseTag(tag: string): { packageName: string | null; version: string } | null {
  // 1.2.3, 1.2.3-beta.1, ...
  const version = '(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.+-]+)?)'
  const single = new RegExp(`^v${version}$`).exec(tag)
  if (single) return { packageName: null, version: single[1]! }
  const monorepo = new RegExp(`^((?:@[\\w.~-]+/)?[\\w.~-]+)@${version}$`).exec(tag)
  if (monorepo) return { packageName: monorepo[1]!, version: monorepo[2]! }
  return null
}

/** `1.2.3` => `1.2.3-commit-1234567`: a pre-release version, so that semver ranges such as `^1.2.3` never match it */
function getCommitReleaseVersion(version: string, commitHash: string): string {
  // Align with GitHub: GitHub (always?) picks the first 7 characters.
  return `${version}-commit-${commitHash.slice(0, 7)}`
}
function isCommitReleaseVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-(?:[0-9A-Za-z.-]+-)?commit-[0-9a-f]{7}$/.test(version)
}
