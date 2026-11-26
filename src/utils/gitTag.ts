export { getGitTagPrefix }
export type { GitTag }
export type { GitTagPrefix }

type GitTagPrefix = `v` | `${string}@`
type GitTag = `${GitTagPrefix}${string}`

/** The release tags are `v1.2.3`, or `some-package@1.2.3` if the repository has several packages (they share its tags) */
function getGitTagPrefix(packageName: string, hasMultiplePackages: boolean): GitTagPrefix {
  return hasMultiplePackages ? `${packageName}@` : 'v'
}
