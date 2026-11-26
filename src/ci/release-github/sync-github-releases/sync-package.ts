export { syncPackage }
export type { SyncContext }

import { readFile } from 'node:fs/promises'
import { applyReleasePlan } from './apply-release-plan.ts'
import { getReleasePlan } from './release-plan.ts'
import { getTagScheme, type TagScheme } from './tag-scheme.ts'
import {
  buildReleaseBody,
  parseChangelog,
  type ReleaseBodyByVersion,
  type ReleaseNotesByVersion,
} from '../utils/changelog.ts'
import { getReleaseDate } from '../utils/git.ts'
import type { ReleasesClient } from '../utils/github.ts'
import type { SyncPackage } from './packages.ts'

// The inputs shared by all packages
type SyncContext = {
  client: ReleasesClient
  /** The repository, e.g. `vikejs/vike` */
  repo: string
  defaultBranch: string
  hasMultiplePackages: boolean
}

// Sync one package: derive its expected releases from CHANGELOG.md (the source of truth), reconcile
// them against the package's existing GitHub Releases into a plan, then apply that plan.
async function syncPackage(pkg: SyncPackage, context: SyncContext): Promise<void> {
  const tagScheme = getTagScheme(pkg.packageName, context.hasMultiplePackages)
  const changelogNotes = parseChangelog(await readFile(pkg.changelogPath, 'utf8'))
  if (Object.keys(changelogNotes).length === 0) {
    // Zero versions means a CHANGELOG.md format that parseChangelog() doesn't support, not that all versions were
    // removed: getReleasePlan() would delete all the package's releases.
    console.warn(`No versions parsed from ${pkg.changelogPath} — skipping it.`)
    return
  }
  const changelogUrl = getChangelogUrl(pkg, context)
  const releaseBodyByVersion = buildReleaseBodies(changelogNotes, { tagScheme, changelogUrl })
  const githubReleases = await context.client.list()
  const plan = getReleasePlan({ githubReleases, releaseBodyByVersion, tagScheme })
  await applyReleasePlan({ plan, client: context.client })
}

// The release body of each version, with its release date read from git (see getReleaseDate())
function buildReleaseBodies(
  changelogNotes: ReleaseNotesByVersion,
  { tagScheme, changelogUrl }: { tagScheme: TagScheme; changelogUrl: string },
): ReleaseBodyByVersion {
  return Object.fromEntries(
    Object.entries(changelogNotes).map(([version, notes]) => [
      version,
      buildReleaseBody(notes, { releaseDate: getReleaseDate(tagScheme.build(version), version), changelogUrl }),
    ]),
  )
}

// The GitHub web (blob) URL of the package's CHANGELOG.md, which each release body's footer links back to.
function getChangelogUrl(pkg: SyncPackage, { repo, defaultBranch }: SyncContext): string {
  return `https://github.com/${repo}/blob/${defaultBranch}/${pkg.changelogPath}`
}
