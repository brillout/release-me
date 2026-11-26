export { applyReleasePlan }

import type { ReleasePlan, ReleaseToCreate } from './release-plan.ts'
import { findReleaseCommit, gitTagExists } from '../utils/git.ts'
import { GitHubApiError, type NewRelease, type ReleasesClient } from '../utils/github.ts'

// Apply the plan of getReleasePlan(). The target commits are resolved here, before calling the client (which skips the
// writes under --dry-run): a dry run also shows a missing tag's failure or warning.
/** @returns The tags of the releases it skipped, because the token isn't allowed to create their git tag (see isTagCreationForbidden()) */
async function applyReleasePlan({
  plan,
  client,
  changelogPath,
}: { plan: ReleasePlan; client: ReleasesClient; changelogPath: string }): Promise<string[]> {
  const skippedReleaseTags: string[] = []
  for (const release of plan.releasesToCreate) {
    const targetCommitish = resolveTargetCommitish(release, changelogPath)
    try {
      await client.create(buildNewRelease(release, targetCommitish))
    } catch (err) {
      // Only a missing tag (`targetCommitish` is set) is created by the request
      if (targetCommitish === undefined || !isTagCreationForbidden(err)) throw err
      // Skip it, so that the other releases are still synced (the caller then warns about the skipped ones)
      console.warn(`Skipped release ${release.tag_name}: the token isn't allowed to create its git tag`)
      skippedReleaseTags.push(release.tag_name)
    }
  }

  for (const release of plan.releasesToUpdate) await client.update(release)

  for (const release of plan.releasesToDelete) await client.delete(release)

  return skippedReleaseTags
}

// GitHub refuses (403) to let a token without the `workflows` permission create a git tag at a commit whose
// .github/workflows/ differs from the current one — typically the old commit of a backfilled release. The GitHub
// Action's GITHUB_TOKEN can't get that permission.
function isTagCreationForbidden(err: unknown): boolean {
  // GitHub's secondary rate limit also answers 403
  return err instanceof GitHubApiError && err.status === 403 && !/rate limit/i.test(err.responseBody)
}

// The commit a to-be-created release is tagged at (its GitHub `target_commitish`):
//  - Tag already exists: none — GitHub uses the tag (and ignores target_commitish).
//  - Tag missing on the latest release: hard fail. The just-released version must already be tagged;
//    tagging it now would point at the default branch's HEAD (the wrong commit).
//  - Tag missing on an older (backfilled) release: tag the commit deduced from the changelog history,
//    or hard fail if it couldn't be deduced — never silently tag the wrong commit.
function resolveTargetCommitish(release: ReleaseToCreate, changelogPath: string): string | undefined {
  const { tag_name: releaseTag, version, isLatest } = release
  if (gitTagExists(releaseTag)) return undefined
  const refusal = `Refusing to create release ${releaseTag}: its git tag is missing`
  if (isLatest) {
    throw new Error(
      `${refusal}. The latest release must already be tagged — creating it now would tag the wrong commit (the default branch's HEAD).`,
    )
  }
  const commit = findReleaseCommit(version, changelogPath)
  if (!commit) {
    throw new Error(`${refusal} and its release commit couldn't be deduced from the changelog history.`)
  }
  console.warn(`Tag ${releaseTag} is missing — creating its release at deduced commit ${commit}`)
  return commit
}

// The create-release payload of a planned release
function buildNewRelease(release: ReleaseToCreate, targetCommitish: string | undefined): NewRelease {
  return {
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    target_commitish: targetCommitish,
    // Only the newest version may be "Latest": make_latest defaults to true, so a backfilled older release would
    // otherwise become "Latest"
    make_latest: release.isLatest ? 'true' : 'false',
  }
}
