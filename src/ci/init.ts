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

  // CLI output is read bottom to top: release.yml last
  logTitle('npm trusted publisher', true)
  await logNpmSetup(monorepoRootDir, packages, status === 'created' ? 'Set up' : "If you didn't already, set up")

  logTitle('GitHub Action')
  if (status === 'up-to-date') {
    console.log(`${pc.bold(releaseWorkflowFilePath)} is up-to-date`)
    return
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} ${pc.bold(releaseWorkflowFilePath)}`)
  await commitReleaseWorkflowFile(monorepoRootDir, status)
  console.log(`Push the commit to the default branch ${pc.dim('$ git push')}`)
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

/** The steps to set up npm's trusted publishing, e.g. `intro` = `Set up` */
async function logNpmSetup(monorepoRootDir: string, packages: ReleaseMePackage[], intro: string) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  console.log(`${intro} ${packages.length === 1 ? "the package's" : "each package's"} trusted publisher on npmjs.com:`)
  for (const { packageName } of packages) {
    console.log(`   ${pc.underline(`https://www.npmjs.com/package/${packageName}/access`)}`)
  }
  console.log(`   Under ${pc.bold('Trusted Publisher')}, press ${pc.bold('GitHub Actions')} and fill in:`)
  // The fields of npm's form
  const fields = [
    ['Organization or user', owner ?? '<owner>'],
    ['Repository', repoName ?? '<repo>'],
    ['Workflow filename', releaseWorkflowFileName],
    ['Allow npm publish', '✓'],
    // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases (see ./ci-publish.ts)
    ['Allow npm dist-tag', '✓'],
  ] as const
  for (const [label, value] of fields) {
    console.log(`     ${label.padEnd(22)}${pc.bold(value)}`)
  }
  console.log(`   ${pc.dim("(A new connection expires if it isn't used within 2 days.)")}`)

  for (const { packageName, packageRootDir } of packages) {
    const { repository } = getPackageJson(packageRootDir).packageJson
    const repositoryMismatch = getRepositoryMismatch(packageName, repository, repo)
    if (!repositoryMismatch) continue
    console.log()
    console.log(pc.yellow(`Warning: ${repositoryMismatch}.`))
  }
}
