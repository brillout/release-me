export { syncPackage }
export { getPackagesToSync }
export type { SyncContext }
export type { SyncPackage }

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import pc from '@brillout/picocolors'
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
import { assertUsage } from '../../../utils.ts'

// A package released by release-me. packageRootDir is absolute; changelogPath is relative to the repository root
// (e.g. `packages/vike/CHANGELOG.md`).
type SyncPackage = {
  packageName: string
  packageRootDir: string
  changelogPath: string
}

// The loop-invariant inputs of a sync run, built once in syncGitHubReleases() and shared across every package.
// owner/repo ride along so each package's changelog URL can be built (see getChangelogUrl); the client
// also binds them internally for its own API calls.
type SyncContext = {
  client: ReleasesClient
  owner: string
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
  await applyReleasePlan({ plan, client: context.client, defaultBranch: context.defaultBranch })
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
function getChangelogUrl(pkg: SyncPackage, { owner, repo, defaultBranch }: SyncContext): string {
  return `https://github.com/${owner}/${repo}/blob/${defaultBranch}/${pkg.changelogPath}`
}

// Which packages to sync, in priority order:
//  - the packages passed as arguments, if any — each a package name or directory (relative to cwd), or
//  - on push (CI): the packages whose CHANGELOG.md changed, or
//  - otherwise (manual workflow_dispatch, or a local run without arguments): every package.
function getPackagesToSync(
  allPackages: SyncPackage[],
  { packageArgs, cwd, pushedFiles }: { packageArgs: string[]; cwd: string; pushedFiles: string[] | null },
): SyncPackage[] {
  if (packageArgs.length > 0) {
    const selected = packageArgs.map((packageArg) => {
      const pkg = allPackages.find(
        (pkg) => pkg.packageName === packageArg || pkg.packageRootDir === path.resolve(cwd, packageArg),
      )
      assertUsage(
        pkg,
        `${pc.cyan(
          packageArg,
        )} isn't the name or directory of a package to sync (the packages released by release-me that have a CHANGELOG.md: ${allPackages
          .map((pkg) => pkg.packageName)
          .join(', ')})`,
      )
      return pkg
    })
    return [...new Set(selected)]
  }
  if (pushedFiles) return allPackages.filter((pkg) => pushedFiles.includes(pkg.changelogPath))
  return allPackages
}
