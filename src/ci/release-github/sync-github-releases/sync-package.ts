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

// The loop-invariant inputs of a sync run, built once in githubReleaseSync() and shared across every package.
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
    // A CHANGELOG.md that parses to zero versions points at a parser/format drift, not an
    // intentional removal — so skip the package (loudly) rather than reconcile against an empty version
    // set, which getReleasePlan() would read as "every release is gone from the changelog: delete them all".
    console.warn(`No versions parsed from ${pkg.changelogPath} — skipping it.`)
    return
  }
  const changelogUrl = getChangelogUrl(pkg, context)
  const releaseBodyByVersion = buildReleaseBodies(changelogNotes, { tagScheme, changelogUrl })
  const githubReleases = await context.client.list()
  const plan = getReleasePlan({ githubReleases, releaseBodyByVersion, tagScheme })
  await applyReleasePlan({ plan, client: context.client })
}

// Turn each version's parsed changelog notes into the release body we publish (buildReleaseBody()). Separate
// from the parsing (parseChangelog()) because each body is stamped with the version's release date,
// which is resolved from git (getReleaseDate()) — something the pure changelog parsing knows nothing of.
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
