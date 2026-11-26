export { getTagScheme }
export type { TagScheme }

import { getGitTagPrefix } from '../../../utils/gitTag.ts'

// A package's release-tag scheme, defined in one place so building a tag and recognizing one can't
// drift apart. `build` turns a version into its tag; `owns` reports whether a release tag is this
// package's — i.e. a candidate for deletion once its changelog entry is gone, never another package's
// release nor a tag we don't create (e.g. `nightly`).
//
// The tags are the ones release-me creates (see getGitTagPrefix()): a single package has bare `vX.Y.Z` tags,
// whereas several packages share the repo's tag namespace, so their tags are qualified with the package name
// (e.g. `create-vike-core@0.0.391`) to avoid collisions.
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
