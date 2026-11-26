export { init }

// `$ pnpm exec release-me init` creates (or updates) .github/workflows/release.yml

import pc from '@brillout/picocolors'
import { getGitHubRepo, getRepositoryMismatch } from './githubAction.ts'
import { releaseWorkflowFileName, releaseWorkflowFilePath, writeReleaseWorkflowFile } from './releaseWorkflowFile.ts'
import {
  assertInstalledAtRoot,
  getFilesInsideDir,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  type ReleaseMePackage,
} from '../releaseMe.ts'
import { assertUsage, logTitle, run } from '../utils.ts'

async function init() {
  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)
  assertPackageManager(monorepoRootDir)
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))

  const status = writeReleaseWorkflowFile(monorepoRootDir)
  logTitle('GitHub Action', true)
  // The npm steps also when release.yml already exists: each package requires a trusted publisher on npm (e.g. also a package added since the previous init)
  if (status === 'up-to-date') {
    await logNpmSetup(monorepoRootDir, packages, "If you didn't already, go to")
    // Last: CLI output is read bottom to top
    console.log()
    console.log(`${pc.bold(releaseWorkflowFilePath)} is already up-to-date`)
    return
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} ${pc.bold(releaseWorkflowFilePath)}`)
  await commitReleaseWorkflowFile(monorepoRootDir, status)

  console.log()
  console.log('Next steps:')
  console.log(`1. Push the commit to the default branch ${pc.dim('$ git push')}`)
  await logNpmSetup(monorepoRootDir, packages, status === 'created' ? '2. Go to' : "2. If you didn't already, go to")
}

/** The GitHub Action installs the pnpm version of the root package.json (pnpm/action-setup reads it) */
function assertPackageManager(monorepoRootDir: string) {
  const { packageJson, packageJsonPath } = getPackageJson(monorepoRootDir)
  const { packageManager, devEngines } = packageJson
  assertUsage(
    packageManager?.startsWith('pnpm@') ||
      (devEngines?.packageManager?.name === 'pnpm' && !!devEngines.packageManager.version),
    `The GitHub Action installs the pnpm version of ${packageJsonPath}: set its ${pc.bold(
      'packageManager',
    )} (e.g. ${pc.bold('"packageManager": "pnpm@x.y.z"')}).`,
  )
}

async function commitReleaseWorkflowFile(monorepoRootDir: string, status: 'created' | 'updated') {
  const commitMessage =
    status === 'created' ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', releaseWorkflowFilePath], { cwd: monorepoRootDir })
  // Only commit the workflow file (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', releaseWorkflowFilePath], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
}

/** The steps to set up npm's trusted publishing, e.g. `intro` = `2. Go to` */
async function logNpmSetup(monorepoRootDir: string, packages: ReleaseMePackage[], intro: string) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  console.log(
    `${intro} ${packages.length === 1 ? "the package's" : "each package's"} ${pc.bold('Settings')} on npmjs.com:`,
  )
  for (const { packageName } of packages) {
    console.log(`   ${pc.underline(`https://www.npmjs.com/package/${packageName}/access`)}`)
  }
  console.log(
    `   and, under ${pc.bold('Trusted Publisher')}, press ${pc.bold('GitHub Actions')} to set up a connection:`,
  )
  // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases (see ./ci-publish.ts)
  console.log(
    `   - ${pc.bold(owner ?? '<owner>')} / ${pc.bold(repoName ?? '<repo>')}, workflow filename ${pc.bold(
      releaseWorkflowFileName,
    )}, ${pc.bold('Allow npm publish')} and ${pc.bold('Allow npm dist-tag')}`,
  )
  console.log(`   ${pc.dim("(A new connection expires if it isn't used within 2 days.)")}`)

  for (const { packageName, packageRootDir } of packages) {
    const { repository } = getPackageJson(packageRootDir).packageJson
    const repositoryMismatch = getRepositoryMismatch(packageName, repository, repo)
    if (!repositoryMismatch) continue
    console.log()
    console.log(pc.yellow(`Warning: ${repositoryMismatch}.`))
  }
}
