export { syncGitHubReleases }

// `$ pnpm exec release-me github-release-sync` keeps GitHub Releases in sync with CHANGELOG.md, see https://github.com/brillout/release-me#github-release
// - It creates any missing release, rewrites any whose notes have drifted from the changelog, and deletes any whose version is no longer in the changelog.
// - CHANGELOG.md is the source of truth: GitHub Releases are completely derived from it.
// - Run by the GitHub Action .github/workflows/release-github.yml (see ../../releaseWorkflowFile.ts), or locally (e.g. with --dry-run).

import * as fs from 'node:fs'
import * as path from 'node:path'
import pc from '@brillout/picocolors'
import {
  getPackagesToSync,
  syncPackage,
  type SyncContext,
  type SyncPackage,
} from '../sync-github-releases/sync-package.ts'
import { createReleasesClientFromEnv, getDefaultBranch, getPushedFiles } from '../utils/github-env.ts'
import { isWorkflowFileUpToDate, syncWorkflowFile } from '../../releaseWorkflowFile.ts'
import { getChangelogPath, getFilesInsideDir, getMonorepoRootDir, getReleaseMePackages } from '../../../releaseMe.ts'

async function syncGitHubReleases({ packageArgs, dryRun }: { packageArgs: string[]; dryRun: boolean }): Promise<void> {
  // The directories passed as arguments are relative to where the command is run
  const cwd = process.cwd()
  const monorepoRootDir = await getMonorepoRootDir()
  // The git commands below resolve their paths against the current working directory
  process.chdir(monorepoRootDir)
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (process.env.GITHUB_ACTIONS && !isWorkflowFileUpToDate(monorepoRootDir, syncWorkflowFile)) {
    // Annotations don't render colors (picocolors enables them in CI)
    console.log(`::error::${pc.rm(syncWorkflowFile.outdated)}`)
    process.exit(1)
  }

  // The packages released by release-me. When there are several, they share the repository's tags, so their release
  // tags are qualified with the package name (see getTagScheme()).
  const releaseMePackages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))
  const hasMultiplePackages = releaseMePackages.length > 1
  const allPackages: SyncPackage[] = releaseMePackages.flatMap(({ packageName, packageRootDir }) => {
    const { changeLogFilePath } = getChangelogPath(packageRootDir, monorepoRootDir, hasMultiplePackages)
    // Not released yet
    if (!fs.existsSync(changeLogFilePath)) return []
    // git reports forward-slash paths on every OS
    const changelogPath = path.relative(monorepoRootDir, changeLogFilePath).split(path.sep).join('/')
    return [{ packageName, packageRootDir: path.resolve(packageRootDir), changelogPath }]
  })

  const packagesToSync = getPackagesToSync(allPackages, { packageArgs, cwd, pushedFiles: getPushedFiles() })
  if (packagesToSync.length === 0) {
    console.log('No CHANGELOG.md changes detected — nothing to sync.')
    return
  }

  const { client, owner, repo } = await createReleasesClientFromEnv(dryRun)
  const context: SyncContext = {
    client,
    owner,
    repo,
    defaultBranch: getDefaultBranch(),
    hasMultiplePackages,
  }

  for (const pkg of packagesToSync) {
    console.log(`Syncing GitHub releases of ${pkg.packageName} (${pkg.changelogPath})`)
    await syncPackage(pkg, context)
  }
}
