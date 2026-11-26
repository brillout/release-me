export { getReleasePlan }
export type { ReleasePlan }
export type { ReleaseToCreate }

import type { ReleaseBodyByVersion } from '../utils/changelog.ts'
import type { Release } from '../utils/github.ts'
import type { TagScheme } from './tag-scheme.ts'

type ReleasePlan = {
  releasesToCreate: ReleaseToCreate[]
  /** With their new body */
  releasesToUpdate: (Release & { body: string })[]
  releasesToDelete: Release[]
}
type ReleaseToCreate = {
  tag_name: string
  body: string
  // Carried for the apply step (apply-release-plan.ts): the raw version locates the release commit
  // when its tag is missing, and isLatest decides the GitHub "Latest" badge.
  version: string
  isLatest: boolean
}

function getReleasePlan({
  githubReleases,
  releaseBodyByVersion,
  tagScheme,
}: {
  githubReleases: Release[]
  releaseBodyByVersion: ReleaseBodyByVersion
  tagScheme: TagScheme
}): ReleasePlan {
  // Driven by the changelog: a release whose tag isn't in it (another package's, or one created manually) is never
  // updated
  const releaseByTag = new Map(githubReleases.map((release) => [release.tag_name, release]))
  const expectedTags = new Set<string>()
  const releasesToCreate: ReleaseToCreate[] = []
  const releasesToUpdate: ReleasePlan['releasesToUpdate'] = []

  // releaseBodyByVersion is newest-first; the newest version is the one eligible to be the repo's
  // "Latest". Capture it before reversing.
  const entries = Object.entries(releaseBodyByVersion)
  const latestVersion = entries[0]?.[0]

  // Iterate oldest-first so releases are created (and their notifications sent) in chronological
  // order. Which release is "Latest" is set explicitly (isLatest), not inferred from creation order.
  // (GitHub orders the releases list by tag semver regardless:
  // https://github.com/vikejs/vike/pull/3157#issuecomment-4406846257)
  for (const [version, body] of [...entries].reverse()) {
    const releaseTag = tagScheme.build(version)
    expectedTags.add(releaseTag)
    const existingRelease = releaseByTag.get(releaseTag)
    if (!existingRelease) {
      releasesToCreate.push({ tag_name: releaseTag, body, version, isLatest: version === latestVersion })
    } else if (existingRelease.body?.trim() !== body) {
      // GitHub can return the body padded with whitespace: without trim(), every sync would update it
      releasesToUpdate.push({ ...existingRelease, body })
    }
  }

  // Delete this package's releases whose version is no longer in the changelog (the source of truth).
  const releasesToDelete = githubReleases.filter(
    (release) => tagScheme.owns(release.tag_name) && !expectedTags.has(release.tag_name),
  )

  return { releasesToCreate, releasesToUpdate, releasesToDelete }
}
