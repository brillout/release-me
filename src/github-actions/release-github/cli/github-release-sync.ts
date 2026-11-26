export { githubReleaseSync }

// `$ pnpm exec release-me github-release-sync` keeps GitHub Releases in sync with CHANGELOG.md, see https://github.com/brillout/release-me#github-release
// - It creates any missing release, rewrites any whose notes have drifted from the changelog, and deletes any whose version is no longer in the changelog.
// - CHANGELOG.md is the source of truth: GitHub Releases are completely derived from it.
// - Run by the GitHub Action .github/workflows/release-github.yml (see ../../workflowFiles.ts), or locally (e.g. with --dry-run).

import pc from '@brillout/picocolors'
import { getPackages, getPackagesToSync } from '../sync-github-releases/packages.ts'
import { syncPackage, type SyncContext } from '../sync-github-releases/sync-package.ts'
import {
  createReleasesClientFromEnv,
  getDefaultBranch,
  getGitHubToken,
  getPushedFiles,
  getRepo,
} from '../utils/github-env.ts'
import { isWorkflowFileUpToDate, releaseGitHubWorkflowFile } from '../../workflowFiles.ts'
import { fail } from '../../utils/fail.ts'
import { getRunWorkflowCta, getWorkflowLink } from '../../utils/workflowLink.ts'
import { getMonorepoRootDir } from '../../../releaseMe.ts'
import { logDetail } from '../../../utils.ts'

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

  // Locally, without token: the GitHub Action can sync instead
  if (
    !dryRun &&
    !process.env.GITHUB_ACTIONS &&
    isWorkflowFileUpToDate(monorepoRootDir, releaseGitHubWorkflowFile) &&
    !(await getGitHubToken())
  ) {
    await logRunWorkflow(packageArgs)
    return
  }

  const { client, repo } = await createReleasesClientFromEnv(dryRun)
  const context: SyncContext = { client, repo, defaultBranch: getDefaultBranch(), hasMultiplePackages }

  for (const pkg of packagesToSync) await syncPackage(pkg, context)
}

async function logRunWorkflow(packageArgs: string[]) {
  const { fileName, filePath } = releaseGitHubWorkflowFile
  const runWorkflow = getRunWorkflowCta(getWorkflowLink(releaseGitHubWorkflowFile, await getRepo()))
  console.log(
    `The environment variable ${pc.bold('GITHUB_TOKEN')} isn't set and the GitHub CLI ${pc.cyan(
      'gh',
    )} isn't logged in ${logDetail('$ gh auth login')}, so release-me can't sync GitHub Releases from your machine.`,
  )
  console.log(
    `To let the GitHub Action ${pc.bold(fileName)} sync them${
      packageArgs.length > 0 ? ' (it syncs all packages)' : ''
    }, push ${pc.bold(filePath)} (if it isn't on GitHub yet), then ${runWorkflow}.`,
  )
}
