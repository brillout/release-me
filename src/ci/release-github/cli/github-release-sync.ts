export { githubReleaseSync }

// `$ pnpm exec release-me github-release-sync` keeps GitHub Releases in sync with CHANGELOG.md, see https://github.com/brillout/release-me#github-release
// - It creates any missing release, rewrites any whose notes have drifted from the changelog, and deletes any whose version is no longer in the changelog.
// - CHANGELOG.md is the source of truth: GitHub Releases are completely derived from it.
// - Run by the GitHub Action .github/workflows/release-github.yml (see ../../releaseWorkflowFile.ts), or locally (e.g. with --dry-run).

import { getPackages, getPackagesToSync } from '../sync-github-releases/packages.ts'
import { syncPackage, type SyncContext } from '../sync-github-releases/sync-package.ts'
import { createReleasesClientFromEnv, getDefaultBranch, getPushedFiles } from '../utils/github-env.ts'
import { isWorkflowFileUpToDate, releaseGitHubWorkflowFile } from '../../releaseWorkflowFile.ts'
import { fail } from '../../fail.ts'
import { getMonorepoRootDir } from '../../../releaseMe.ts'

async function githubReleaseSync({ packageArgs, dryRun }: { packageArgs: string[]; dryRun: boolean }): Promise<void> {
  // The directories passed as arguments are relative to where the command is run
  const cwd = process.cwd()
  const monorepoRootDir = await getMonorepoRootDir()
  // The paths of the CHANGELOG.md files (read from disk, and passed to git) are relative to the repository root
  process.chdir(monorepoRootDir)
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (process.env.GITHUB_ACTIONS && !isWorkflowFileUpToDate(monorepoRootDir, releaseGitHubWorkflowFile)) {
    fail(releaseGitHubWorkflowFile.outdated)
  }

  const { packages, hasMultiplePackages } = await getPackages(monorepoRootDir)
  const packagesToSync = getPackagesToSync(packages, { packageArgs, cwd, pushedFiles: getPushedFiles() })
  if (packagesToSync.length === 0) {
    console.log('No CHANGELOG.md changes detected — nothing to sync.')
    return
  }

  const { client, repo } = await createReleasesClientFromEnv(dryRun)
  const context: SyncContext = { client, repo, defaultBranch: getDefaultBranch(), hasMultiplePackages }

  for (const pkg of packagesToSync) await syncPackage(pkg, context)
}
