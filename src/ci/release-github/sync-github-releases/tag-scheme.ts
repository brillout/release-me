export { getTagScheme }
export type { TagScheme }

import { getGitTagPrefix } from '../../../utils/gitTag.ts'

// The release tags of a package, see getGitTagPrefix() (e.g. `v0.4.259`, or `create-vike-core@0.0.391` if the repository
// has several packages). `owns` tells whether a release is the package's, i.e. deleted once its version is removed from
// CHANGELOG.md — never another package's release, nor a tag release-me doesn't create (e.g. `nightly`).
type TagScheme = {
  build(version: string): string
  owns(releaseTag: string): boolean
}
function getTagScheme(packageName: string, hasMultiplePackages: boolean): TagScheme {
  const tagPrefix = getGitTagPrefix(packageName, hasMultiplePackages)
  return {
    build: (version) => `${tagPrefix}${version}`,
    owns: (releaseTag) => releaseTag.startsWith(tagPrefix) && /^\d+\.\d+\.\d+/.test(releaseTag.slice(tagPrefix.length)),
  }
}
